const twilio = require('twilio');

function getClient() {
  return twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
}

const MENU_TEXT =
  'Hola 👋 Puedo ayudarte con:\n\n' +
  '• Estado de tus cuotas\n' +
  '• Stock de indumentaria\n' +
  '• Próximos partidos\n\n' +
  '¿Sobre qué querés consultar?';

const NOT_UNDERSTOOD_TEXT =
  'No entendí tu consulta 🤔 ¿Podés escribirlo de otra manera?\n\n' +
  'Puedo ayudarte con:\n\n' +
  '• *Cuotas* — escribí algo como "cuánto debo" o "mis cuotas"\n' +
  '• *Indumentaria* — escribí algo como "stock" o "ropa"\n' +
  '• *Partidos* — escribí algo como "próximos partidos" o "fixture"\n\n' +
  '¿Sobre qué querés consultar?';

async function sendTextMessage(to, body) {
  try {
    const message = await getClient().messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to,
      body,
    });
    console.log(`[twilio] Mensaje enviado a ${to} — SID: ${message.sid}`);
    return message;
  } catch (err) {
    console.error('[twilio] Error en sendTextMessage:', err.message);
    throw err;
  }
}

async function sendMediaMessage(to, mediaUrl, body) {
  try {
    const message = await getClient().messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to,
      body,
      mediaUrl: [mediaUrl],
    });
    console.log(`[twilio] Media enviada a ${to} — SID: ${message.sid}`);
    return message;
  } catch (err) {
    console.error('[twilio] Error en sendMediaMessage:', err.message);
    throw err;
  }
}

async function sendMenuMessage(to) {
  return sendTextMessage(to, MENU_TEXT);
}

async function sendNotUnderstoodMessage(to) {
  return sendTextMessage(to, NOT_UNDERSTOOD_TEXT);
}

module.exports = { sendTextMessage, sendMediaMessage, sendMenuMessage, sendNotUnderstoodMessage };
