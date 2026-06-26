const { getStock, getCuotasPendientes, getProximosPartidos } = require('./sheets');
const { sendTextMessage, sendMenuMessage } = require('./twilio');

const ERROR_MSG =
  'Ocurrió un error, por favor intentá de nuevo en unos minutos.';

// ─── Estado de conversación ───────────────────────────────────────────────────
// Clave: `from` (whatsapp:+549...), valor: { esperandoDNI: true }
const conversationState = {};

// ─── Detección de intención ───────────────────────────────────────────────────

function detectIntent(text) {
  if (/\b(stock|ropa|camiseta|talle|indumentaria)\b/.test(text)) return 'stock';
  if (/\b(cuota|cuotas|debe|deuda|pago|estado)\b/.test(text))    return 'cuotas';
  if (/\b(partido|partidos|juego|jugamos|fixture)\b/.test(text)) return 'partidos';
  return 'menu';
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleStock(from) {
  const items = await getStock();

  if (!items.length) {
    return sendTextMessage(from, 'Por el momento no hay stock disponible.');
  }

  const lineas = items.map(
    (i) => `👕 *${i.producto}* - Talle ${i.talle} - ${i.cantidad} unidades - $${i.precio}`
  );
  return sendTextMessage(from, `📦 *Stock disponible:*\n\n${lineas.join('\n')}`);
}

async function handleCuotasConDNI(from, dni) {
  const resultado = await getCuotasPendientes(dni);
  delete conversationState[from];

  if (!resultado.encontrado) {
    return sendTextMessage(
      from,
      'No encontré ese DNI en el sistema. Verificá el número o hablá con el administrador.'
    );
  }

  if (!resultado.cuotas.length) {
    return sendTextMessage(from, `✅ ¡${resultado.nombre} está al día con todas sus cuotas!`);
  }

  const ICONOS = { Social: '🏛️', Futsal: '⚽', Otra: '📋' };

  const porTipo = resultado.cuotas.reduce((acc, c) => {
    const tipo = c.tipo || 'Otra';
    if (!acc[tipo]) acc[tipo] = [];
    acc[tipo].push(c);
    return acc;
  }, {});

  const secciones = Object.entries(porTipo).map(([tipo, cuotas]) => {
    const icono = ICONOS[tipo] || '📋';
    const lineas = cuotas.map((c) => `  • ${c.mes}: $${c.monto.toLocaleString('es-AR')}`);
    return `${icono} *Cuota ${tipo}:*\n${lineas.join('\n')}`;
  });

  const resumen =
    `💳 *Cuotas pendientes de ${resultado.nombre}:*\n\n` +
    secciones.join('\n\n') +
    `\n\n*Total adeudado: $${resultado.totalMonto.toLocaleString('es-AR')}*`;

  return sendTextMessage(from, resumen);
}

async function handlePartidos(from) {
  const partidos = await getProximosPartidos(3);

  if (!partidos.length) {
    return sendTextMessage(from, 'No hay partidos programados por el momento.');
  }

  const lineas = partidos.map(
    (p) => `⚽ *${p.rival}* | 📅 ${p.fecha} | 🕐 ${p.hora} | 📍 ${p.lugar}${p.categoria ? ` | ${p.categoria}` : ''}`
  );
  return sendTextMessage(from, `🗓️ *Próximos partidos:*\n\n${lineas.join('\n')}`);
}

// ─── Función principal ────────────────────────────────────────────────────────

async function handleIncomingMessage(from, body) {
  const text = body.trim().toLowerCase();

  try {
    // Si estamos esperando el DNI de este usuario, procesarlo directamente
    if (conversationState[from]?.esperandoDNI) {
      const dni = body.trim();
      console.log(`[botLogic] from=${from} estado=esperandoDNI dni="${dni}"`);
      return await handleCuotasConDNI(from, dni);
    }

    const intent = detectIntent(text);
    console.log(`[botLogic] from=${from} intent=${intent} body="${body}"`);

    if (intent === 'stock') return await handleStock(from);

    if (intent === 'cuotas') {
      conversationState[from] = { esperandoDNI: true };
      return await sendTextMessage(from, '¿Cuál es tu DNI?');
    }

    if (intent === 'partidos') return await handlePartidos(from);

    return await sendMenuMessage(from);
  } catch (err) {
    console.error('[botLogic] Error no controlado:', err.message);
    delete conversationState[from];
    await sendTextMessage(from, ERROR_MSG);
  }
}

module.exports = { handleIncomingMessage };
