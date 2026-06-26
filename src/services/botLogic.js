'use strict';
const { getStock, getCuotasPendientes, getProximosPartidos } = require('./sheets');
const { sendTextMessage } = require('./twilio');
const { generateResponse } = require('./ai');

const ERROR_MSG = 'Ocurrió un error, por favor intentá de nuevo en unos minutos.';

const conversationState = {};

function detectIntent(text) {
  if (/\b(hola|buenas|buen\s?d[ií]a|buenas\s?tardes|buenas\s?noches|hey|saludos)\b/.test(text)) return 'saludo';
  if (/\b(stock|ropa|camiseta|talle|indumentaria)\b/.test(text)) return 'stock';
  if (/\b(c[oó]mo\s+(se\s+)?pag[ao]|pagar|abonar|transferencia|cbu|alias|efectivo|secretar[ií]a|medio[s]?\s+de\s+pago|forma[s]?\s+de\s+pago)\b/.test(text)) return 'pago';
  if (/\b(cuota|cuotas|deb[eo]|deuda|pago|estado|adeud)\b/.test(text)) return 'cuotas';
  if (/\b(partido|partidos|juego|jugamos|fixture)\b/.test(text)) return 'partidos';
  return 'desconocido';
}

async function handleStock(from, userMessage) {
  const items = await getStock();
  const text = await generateResponse('stock', items, userMessage);
  return sendTextMessage(from, text);
}

async function handleCuotasConDNI(from, dni) {
  const resultado = await getCuotasPendientes(dni);
  delete conversationState[from];
  const text = await generateResponse('cuotas', resultado, dni);
  return sendTextMessage(from, text);
}

async function handlePartidos(from, userMessage) {
  const partidos = await getProximosPartidos(3);
  const text = await generateResponse('partidos', partidos, userMessage);
  return sendTextMessage(from, text);
}

async function handlePago(from, userMessage) {
  const text = await generateResponse('pago', null, userMessage);
  return sendTextMessage(from, text);
}

async function handleIncomingMessage(from, body) {
  const text = body.trim().toLowerCase();

  try {
    if (conversationState[from]?.esperandoDNI) {
      const dni = body.trim();
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

    if (intent === 'cuotas') {
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
