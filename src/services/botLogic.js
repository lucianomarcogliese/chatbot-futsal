'use strict';
const { getStock, getCuotasPendientes, getProximosPartidos, guardarReserva, registrarPago, decrementarStock } = require('./sheets');
const { sendTextMessage, sendMediaMessage } = require('./twilio');
const { generateResponse, validateComprobante } = require('./ai');

const ERROR_MSG = 'Ocurrió un error, por favor intentá de nuevo en unos minutos.';
const DNI_REGEX = /^\d{7,8}$/;
const CONFIRMACION_RESERVA = /\b(s[ií]|dale|quiero|reserv[ao]|confirmo|sip|va|obvio|comprar|llev[ao])\b/i;
const RECHAZO_RESERVA = /\b(no|nel|nop)\b/i;
const EFECTIVO_REGEX = /\b(efectivo|cash|en\s+mano)\b/i;

const conversationState = {};
const pendingMessages = {};
const DEBOUNCE_MS = 6000;

function detectIntent(text) {
  if (/\b(hola|buenas|buen\s?d[ií]a|buenas\s?tardes|buenas\s?noches|hey|saludos|como\s+and[aá]s|c[oó]mo\s+est[aá]s|qu[eé]\s+tal|buen[ao]s\s+d[ií]as)\b/.test(text)) return 'saludo';
  if (/\b(stock|ropa|camiseta|talle|indumentaria|comprar|llevar)\b/.test(text)) return 'stock';
  if (/\b(c[oó]mo\s+(se\s+)?pag[ao]|pagar|abonar|transferencia|cbu|alias|efectivo|secretar[ií]a|medio[s]?\s+de\s+pago|forma[s]?\s+de\s+pago)\b/.test(text)) return 'pago';
  if (/\b(cu[aá]nto\s+(sale|cuesta|cobran|es|vale|son|hay\s+que\s+pagar)|valor\s+(de\s+(la\s+)?)?cuota|precio\s+(de\s+(la\s+)?)?cuota|importe|cu[aá]nto\s+es\s+la\s+cuota|valores?\s+de\s+cuota)\b/.test(text)) return 'valor_cuotas';
  if (/\b(cuota|cuotas|deb[eo]|deuda|pago|estado|adeud)\b/.test(text)) return 'cuotas';
  if (/\b(partido|partidos|juego|jugamos|fixture)\b/.test(text)) return 'partidos';
  if (/\b(ok|okay|perfecto|gracias|dale|genial|buen[ií]simo|b[áa]rbaro|copado|re\s+copado|entendido|listo|joya|todo\s+bien|ten[eé]s\s+raz[oó]n|exacto|claro|s[íi])\b/.test(text)) return 'cierre';
  return 'desconocido';
}

// ─── Stock ───────────────────────────────────────────────────────────────────

async function handleStock(from, userMessage) {
  const items = await getStock();

  if (!items.length) {
    const text = await generateResponse('stock', [], userMessage);
    return sendTextMessage(from, text);
  }

  const porProducto = new Map();
  for (const item of items) {
    if (!porProducto.has(item.producto)) {
      porProducto.set(item.producto, { imagenUrl: '', talles: [] });
    }
    const entry = porProducto.get(item.producto);
    if (!entry.imagenUrl && item.imagenUrl) entry.imagenUrl = item.imagenUrl;
    entry.talles.push({ talle: item.talle, cantidad: item.cantidad, precio: item.precio });
  }

  const catalogo = [...porProducto.entries()].map(([nombre, data], i) => ({
    numero: i + 1,
    nombre,
    imagenUrl: data.imagenUrl,
    talles: data.talles,
  }));

  conversationState[from] = { ...conversationState[from], esperandoProducto: true, catalogo };

  const text = await generateResponse('stock_lista', catalogo, userMessage);
  return sendTextMessage(from, text);
}

async function handleProductoSeleccionado(from, input) {
  const { catalogo } = conversationState[from];

  // Match por número
  const numero = parseInt(input.trim(), 10);
  let producto = !isNaN(numero) ? catalogo.find((p) => p.numero === numero) : null;

  // Match por nombre parcial (palabra a palabra)
  if (!producto) {
    const STOPWORDS = new Set([
      'que', 'tenes', 'tiene', 'hay', 'de', 'la', 'el', 'los', 'las',
      'un', 'una', 'me', 'te', 'se', 'por', 'para', 'con', 'como',
      'quiero', 'ver', 'dame', 'mostrar', 'del', 'sobre', 'info',
      'talle', 'talles', 'precio', 'stock',
    ]);
    const palabras = input.trim().toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));
    if (palabras.length) {
      producto = catalogo.find((p) =>
        palabras.some((w) => {
          const nombre = p.nombre.toLowerCase();
          return nombre.includes(w) || (w.endsWith('s') && nombre.includes(w.slice(0, -1)));
        })
      );
    }
  }

  if (!producto) {
    const intent = detectIntent(input.trim().toLowerCase());
    // No re-despachar 'stock': el usuario ya está en modo catálogo
    if (intent !== 'desconocido' && intent !== 'stock') {
      const { lastDni } = conversationState[from];
      conversationState[from] = lastDni ? { lastDni } : {};
      return await dispatchIntent(from, intent, input);
    }
    const msg = await generateResponse('stock_no_encontrado', catalogo, input);
    return sendTextMessage(from, msg);
  }

  const { lastDni } = conversationState[from];

  const lineas = producto.talles
    .map((t) => {
      const precio = String(t.precio).replace(/^\$+\s*/, '');
      return `• Talle ${t.talle} — ${t.cantidad} uds — $${precio}`;
    })
    .join('\n');
  const caption = `👕 *${producto.nombre}*\n${lineas}`;

  if (producto.imagenUrl) {
    await sendMediaMessage(from, producto.imagenUrl, caption);
  } else {
    await sendTextMessage(from, caption);
  }

  // Ofrecer reserva
  const oferta = await generateResponse('reserva_oferta', { nombre: producto.nombre }, input);
  await sendTextMessage(from, oferta);

  // Transicionar a estado de reserva (guardar talles para consultas de precio)
  conversationState[from] = {
    esperandoRespuestaReserva: true,
    productoReserva: producto.nombre,
    productoTalles: producto.talles,
    catalogo,
    ...(lastDni ? { lastDni } : {}),
  };
}

// ─── Flujo de reserva ─────────────────────────────────────────────────────────

async function handleRespuestaReserva(from, body) {
  const text = body.trim().toLowerCase();
  const { catalogo, productoReserva, productoTalles, lastDni } = conversationState[from];

  // Confirmación → pedir talle
  if (CONFIRMACION_RESERVA.test(text)) {
    conversationState[from] = { esperandoTalleReserva: true, productoReserva, productoTalles, catalogo, ...(lastDni ? { lastDni } : {}) };
    const msg = await generateResponse('reserva_pedir_talle', { producto: productoReserva, talles: productoTalles }, body);
    return sendTextMessage(from, msg);
  }

  // Intentar match con otro producto del catálogo
  const numero = parseInt(text.trim(), 10);
  let otroProd = !isNaN(numero) ? catalogo.find((p) => p.numero === numero) : null;
  if (!otroProd) {
    const STOPWORDS = new Set(['que', 'de', 'la', 'el', 'los', 'las', 'un', 'una', 'me', 'ver', 'quiero', 'del']);
    const palabras = text.split(/\W+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
    if (palabras.length) {
      otroProd = catalogo.find((p) => palabras.some((w) => p.nombre.toLowerCase().includes(w)));
    }
  }
  if (otroProd) {
    // Mostrar el otro producto y preguntar de nuevo
    conversationState[from] = { esperandoProducto: true, catalogo, ...(lastDni ? { lastDni } : {}) };
    return await handleProductoSeleccionado(from, body);
  }

  // Rechazo → volver a ver productos
  if (RECHAZO_RESERVA.test(text)) {
    conversationState[from] = { esperandoProducto: true, catalogo, ...(lastDni ? { lastDni } : {}) };
    const msg = await generateResponse('reserva_rechazada', null, body);
    return sendTextMessage(from, msg);
  }

  // Intent conocido → salir del modo stock
  const intent = detectIntent(text);
  if (intent !== 'desconocido' && intent !== 'cierre') {
    conversationState[from] = lastDni ? { lastDni } : {};
    return await dispatchIntent(from, intent, body);
  }

  // Respuesta ambigua → re-preguntar
  const msg = await generateResponse('reserva_oferta', { nombre: productoReserva }, body);
  return sendTextMessage(from, msg);
}

async function handleTalleReserva(from, body) {
  const { productoReserva, productoTalles, catalogo, lastDni } = conversationState[from];
  const input = body.trim().toUpperCase();
  const talleElegido = productoTalles.find(
    (t) => t.talle.toUpperCase() === input && t.cantidad > 0
  );
  if (!talleElegido) {
    const msg = await generateResponse('reserva_talle_invalido', { talles: productoTalles }, body);
    return sendTextMessage(from, msg);
  }
  conversationState[from] = {
    esperandoNombreReserva: true,
    talleReserva: talleElegido.talle,
    productoReserva, productoTalles, catalogo,
    ...(lastDni ? { lastDni } : {}),
  };
  const msg = await generateResponse('reserva_pedir_nombre', { producto: productoReserva }, body);
  return sendTextMessage(from, msg);
}

async function handleNombreReserva(from, body) {
  const nombre = body.trim();
  const { productoReserva, productoTalles, talleReserva, catalogo, lastDni } = conversationState[from];
  conversationState[from] = { esperandoApellidoReserva: true, nombre, talleReserva, productoReserva, productoTalles, catalogo, ...(lastDni ? { lastDni } : {}) };
  const msg = await generateResponse('reserva_pedir_apellido', { nombre }, body);
  return sendTextMessage(from, msg);
}

async function handleApellidoReserva(from, body) {
  const apellido = body.trim();
  const { nombre, talleReserva, productoReserva, productoTalles, catalogo, lastDni } = conversationState[from];
  conversationState[from] = { esperandoCelularReserva: true, nombre, apellido, talleReserva, productoReserva, productoTalles, catalogo, ...(lastDni ? { lastDni } : {}) };
  const msg = await generateResponse('reserva_pedir_celular', { nombre, apellido }, body);
  return sendTextMessage(from, msg);
}

async function handleCelularReserva(from, body) {
  const celular = body.trim().replace(/[\s\-().]/g, '');
  if (!/\d{8,}/.test(celular)) {
    const msg = await generateResponse('reserva_celular_invalido', null, body);
    return sendTextMessage(from, msg);
  }

  const { nombre, apellido, talleReserva, productoReserva, productoTalles, lastDni } = conversationState[from];
  const fecha = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

  await guardarReserva({ nombre, apellido, celular, producto: productoReserva, talle: talleReserva, fecha, estado: 'Pendiente', comprobanteUrl: '' });
  await decrementarStock(productoReserva, talleReserva);

  conversationState[from] = { esperandoComprobante: true, nombre, apellido, celular, talleReserva, productoReserva, productoTalles, ...(lastDni ? { lastDni } : {}) };

  const msg = await generateResponse('reserva_instrucciones_pago', { nombre, producto: productoReserva, talles: productoTalles }, body);
  return sendTextMessage(from, msg);
}

const PRECIO_QUERY = /\b(cu[aá]nto|precio|cuesta|sale|monto|importe|valor|cuanto\s+es|cuanto\s+sale)\b/i;

async function handleComprobante(from, body, media = {}) {
  const { nombre, apellido, celular, productoReserva, productoTalles, lastDni } = conversationState[from];

  // Usuario pregunta el precio
  if (PRECIO_QUERY.test(body) && productoTalles?.length) {
    const msg = await generateResponse('reserva_instrucciones_pago', { nombre, producto: productoReserva, talles: productoTalles }, body);
    return sendTextMessage(from, msg);
  }

  // Usuario elige efectivo
  if (EFECTIVO_REGEX.test(body.trim().toLowerCase())) {
    await registrarPago(celular, '', 'Efectivo - pendiente');
    conversationState[from] = lastDni ? { lastDni } : {};
    const msg = await generateResponse('reserva_efectivo_ok', { nombre, producto: productoReserva }, body);
    return sendTextMessage(from, msg);
  }

  // Usuario manda imagen
  if (media.numMedia > 0 && media.mediaUrl) {
    try {
      const valido = await validateComprobante(media.mediaUrl);
      if (valido) {
        await registrarPago(celular, media.mediaUrl, 'Pagado - transferencia');
        conversationState[from] = lastDni ? { lastDni } : {};
        const msg = await generateResponse('reserva_comprobante_valido', { nombre, producto: productoReserva }, body);
        return sendTextMessage(from, msg);
      } else {
        const msg = await generateResponse('reserva_comprobante_invalido', null, body);
        return sendTextMessage(from, msg);
      }
    } catch (err) {
      console.error('[botLogic] Error validando comprobante:', err.message);
      const msg = await generateResponse('reserva_comprobante_invalido', null, body);
      return sendTextMessage(from, msg);
    }
  }

  // Sin imagen ni "efectivo" → recordatorio
  const msg = await generateResponse('reserva_comprobante_recordatorio', { nombre }, body);
  return sendTextMessage(from, msg);
}

// ─── Cuotas ───────────────────────────────────────────────────────────────────

async function handleCuotasConDNI(from, dni) {
  const resultado = await getCuotasPendientes(dni);
  conversationState[from] = { lastDni: dni };
  const text = await generateResponse('cuotas', resultado, dni);
  return sendTextMessage(from, text);
}

// ─── Partidos ─────────────────────────────────────────────────────────────────

function groupByJornada(partidos, maxJornadas = 3) {
  const map = new Map();
  for (const p of partidos) {
    const key = `${p.fecha}||${p.rival}`;
    if (!map.has(key)) {
      map.set(key, { fecha: p.fecha, rival: p.rival, lugar: p.lugar, categorias: [] });
    }
    map.get(key).categorias.push({ categoria: p.categoria, hora: p.hora });
  }
  return [...map.values()]
    .slice(0, maxJornadas)
    .map((j) => ({
      ...j,
      categorias: j.categorias.sort((a, b) => (a.hora > b.hora ? 1 : -1)),
    }));
}

async function handlePartidos(from, userMessage) {
  const partidos = await getProximosPartidos(50);
  const jornadas = groupByJornada(partidos, 3);
  const text = await generateResponse('partidos', jornadas, userMessage);
  return sendTextMessage(from, text);
}

async function handlePago(from, userMessage) {
  const text = await generateResponse('pago', null, userMessage);
  return sendTextMessage(from, text);
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

async function dispatchIntent(from, intent, body) {
  if (intent === 'saludo') {
    const msg = await generateResponse('menu', null, body);
    return sendTextMessage(from, msg);
  }
  if (intent === 'stock')        return await handleStock(from, body);
  if (intent === 'partidos')     return await handlePartidos(from, body);
  if (intent === 'pago')         return await handlePago(from, body);
  if (intent === 'valor_cuotas') {
    const msg = await generateResponse('valor_cuotas', null, body);
    return sendTextMessage(from, msg);
  }
  if (intent === 'cierre') {
    const msg = await generateResponse('cierre', null, body);
    return sendTextMessage(from, msg);
  }
  if (intent === 'cuotas') {
    if (conversationState[from]?.lastDni) {
      console.log(`[botLogic] from=${from} re-usando lastDni="${conversationState[from].lastDni}"`);
      return await handleCuotasConDNI(from, conversationState[from].lastDni);
    }
    conversationState[from] = { esperandoDNI: true };
    const msg = await generateResponse('pedir_dni', null, body);
    return sendTextMessage(from, msg);
  }
  const msg = await generateResponse('no_entendido', null, body);
  return sendTextMessage(from, msg);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function _processMessage(from, body, media = {}) {
  const text = body.trim().toLowerCase();

  try {
    // Estados de reserva (mayor precedencia)
    if (conversationState[from]?.esperandoComprobante)      { console.log(`[botLogic] ${from} estado=esperandoComprobante`);     return await handleComprobante(from, body, media); }
    if (conversationState[from]?.esperandoCelularReserva)   { console.log(`[botLogic] ${from} estado=esperandoCelularReserva`);  return await handleCelularReserva(from, body); }
    if (conversationState[from]?.esperandoApellidoReserva)  { console.log(`[botLogic] ${from} estado=esperandoApellidoReserva`); return await handleApellidoReserva(from, body); }
    if (conversationState[from]?.esperandoTalleReserva)     { console.log(`[botLogic] ${from} estado=esperandoTalleReserva`);    return await handleTalleReserva(from, body); }
    if (conversationState[from]?.esperandoNombreReserva)    { console.log(`[botLogic] ${from} estado=esperandoNombreReserva`);   return await handleNombreReserva(from, body); }
    if (conversationState[from]?.esperandoRespuestaReserva) { console.log(`[botLogic] ${from} estado=esperandoRespuestaReserva`); return await handleRespuestaReserva(from, body); }

    // Estado de selección de producto
    if (conversationState[from]?.esperandoProducto) {
      console.log(`[botLogic] ${from} estado=esperandoProducto input="${body}"`);
      return await handleProductoSeleccionado(from, body);
    }

    // Estado de DNI
    if (conversationState[from]?.esperandoDNI) {
      const dni = body.trim();
      if (!DNI_REGEX.test(dni)) {
        console.log(`[botLogic] ${from} estado=esperandoDNI input_invalido="${dni}"`);
        const msg = await generateResponse('pedir_dni_invalido', null, body);
        return sendTextMessage(from, msg);
      }
      console.log(`[botLogic] ${from} estado=esperandoDNI dni="${dni}"`);
      return await handleCuotasConDNI(from, dni);
    }

    const intent = detectIntent(text);
    console.log(`[botLogic] ${from} intent=${intent} body="${body}"`);
    return await dispatchIntent(from, intent, body);

  } catch (err) {
    console.error('[botLogic] Error no controlado:', err.message);
    delete conversationState[from];
    await sendTextMessage(from, ERROR_MSG);
  }
}

async function handleIncomingMessage(from, body, media = {}) {
  if (pendingMessages[from]) {
    clearTimeout(pendingMessages[from].timer);
    const combinedText = (pendingMessages[from].text + ' ' + body).trim();
    const combinedMedia = pendingMessages[from].media.numMedia > 0
      ? pendingMessages[from].media
      : media;
    pendingMessages[from].text = combinedText;
    pendingMessages[from].media = combinedMedia;
  } else {
    pendingMessages[from] = { text: body, media };
  }

  pendingMessages[from].timer = setTimeout(async () => {
    const { text, media: m } = pendingMessages[from];
    delete pendingMessages[from];
    await _processMessage(from, text, m);
  }, DEBOUNCE_MS);
}

module.exports = { handleIncomingMessage };
