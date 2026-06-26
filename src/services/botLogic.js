'use strict';
const { getStock, getCuotasPendientes, getProximosPartidos } = require('./sheets');
const { sendTextMessage, sendMediaMessage } = require('./twilio');
const { generateResponse } = require('./ai');

const ERROR_MSG = 'Ocurrió un error, por favor intentá de nuevo en unos minutos.';
const DNI_REGEX = /^\d{7,8}$/;

const conversationState = {};

function detectIntent(text) {
  if (/\b(hola|buenas|buen\s?d[ií]a|buenas\s?tardes|buenas\s?noches|hey|saludos)\b/.test(text)) return 'saludo';
  if (/\b(stock|ropa|camiseta|talle|indumentaria)\b/.test(text)) return 'stock';
  if (/\b(c[oó]mo\s+(se\s+)?pag[ao]|pagar|abonar|transferencia|cbu|alias|efectivo|secretar[ií]a|medio[s]?\s+de\s+pago|forma[s]?\s+de\s+pago)\b/.test(text)) return 'pago';
  if (/\b(cuota|cuotas|deb[eo]|deuda|pago|estado|adeud)\b/.test(text)) return 'cuotas';
  if (/\b(partido|partidos|juego|jugamos|fixture)\b/.test(text)) return 'partidos';
  if (/\b(ok|okay|perfecto|gracias|dale|genial|buen[ií]simo|b[áa]rbaro|copado|re\s+copado|entendido|listo|joya|todo\s+bien|ten[eé]s\s+raz[oó]n|exacto|claro|s[íi])\b/.test(text)) return 'cierre';
  return 'desconocido';
}

async function handleStock(from, userMessage) {
  const items = await getStock();

  if (!items.length) {
    const text = await generateResponse('stock', [], userMessage);
    return sendTextMessage(from, text);
  }

  // Agrupar por producto
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

  // Guardar estado esperando selección de producto
  conversationState[from] = { ...conversationState[from], esperandoProducto: true, catalogo };

  const text = await generateResponse('stock_lista', catalogo, userMessage);
  return sendTextMessage(from, text);
}

async function handleProductoSeleccionado(from, input) {
  const { catalogo } = conversationState[from];

  // Match por número
  const numero = parseInt(input.trim(), 10);
  let producto = !isNaN(numero) ? catalogo.find((p) => p.numero === numero) : null;

  // Match por nombre parcial
  if (!producto) {
    const lower = input.trim().toLowerCase();
    producto = catalogo.find((p) => p.nombre.toLowerCase().includes(lower));
  }

  if (!producto) {
    const msg = await generateResponse('stock_no_encontrado', catalogo, input);
    return sendTextMessage(from, msg);
  }

  // Limpiar estado preservando lastDni si existe
  const { lastDni } = conversationState[from];
  conversationState[from] = lastDni ? { lastDni } : {};

  const lineas = producto.talles
    .map((t) => `• Talle ${t.talle} — ${t.cantidad} uds — $${t.precio}`)
    .join('\n');
  const caption = `👕 *${producto.nombre}*\n${lineas}`;

  if (producto.imagenUrl) {
    return sendMediaMessage(from, producto.imagenUrl, caption);
  }
  return sendTextMessage(from, caption);
}

async function handleCuotasConDNI(from, dni) {
  const resultado = await getCuotasPendientes(dni);
  conversationState[from] = { lastDni: dni };
  const text = await generateResponse('cuotas', resultado, dni);
  return sendTextMessage(from, text);
}

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

async function handleIncomingMessage(from, body) {
  const text = body.trim().toLowerCase();

  try {
    if (conversationState[from]?.esperandoProducto) {
      console.log(`[botLogic] from=${from} estado=esperandoProducto input="${body}"`);
      return await handleProductoSeleccionado(from, body);
    }

    if (conversationState[from]?.esperandoDNI) {
      const dni = body.trim();
      if (!DNI_REGEX.test(dni)) {
        console.log(`[botLogic] from=${from} estado=esperandoDNI input_invalido="${dni}"`);
        const msg = await generateResponse('pedir_dni_invalido', null, body);
        return sendTextMessage(from, msg);
      }
      console.log(`[botLogic] from=${from} estado=esperandoDNI dni="${dni}"`);
      return await handleCuotasConDNI(from, dni);
    }

    const intent = detectIntent(text);
    console.log(`[botLogic] from=${from} intent=${intent} body="${body}"`);

    if (intent === 'saludo') {
      const msg = await generateResponse('menu', null, body);
      return sendTextMessage(from, msg);
    }

    if (intent === 'stock')    return await handleStock(from, body);
    if (intent === 'partidos') return await handlePartidos(from, body);
    if (intent === 'pago')     return await handlePago(from, body);

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
  } catch (err) {
    console.error('[botLogic] Error no controlado:', err.message);
    delete conversationState[from];
    await sendTextMessage(from, ERROR_MSG);
  }
}

module.exports = { handleIncomingMessage };
