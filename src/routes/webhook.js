const express = require('express');
const router = express.Router();
const { handleIncomingMessage } = require('../services/botLogic');

// POST /webhook — punto de entrada de mensajes entrantes de Twilio
router.post('/', (req, res) => {
  res.status(200).end(); // Twilio queda satisfecho de inmediato (sin body para que no lo reenvíe)

  const from      = req.body.From;
  const body      = req.body.Body || '';
  const numMedia  = parseInt(req.body.NumMedia || '0', 10);
  const mediaUrl  = req.body.MediaUrl0  || null;
  const mediaType = req.body.MediaContentType0 || null;

  if (!from) return;

  console.log(`[webhook] Mensaje de ${from}: "${body}" | media=${numMedia}`);

  handleIncomingMessage(from, body, { numMedia, mediaUrl, mediaType })
    .catch((err) => console.error('[webhook] Error no manejado en handleIncomingMessage:', err));
});

module.exports = router;

// ─── Configuración en Twilio Sandbox ────────────────────────────────────────
// En la consola de Twilio (Messaging → Try it out → Send a WhatsApp message)
// pegá esta URL en el campo "When a message comes in":
//
//   https://<tu-dominio>/webhook
//
// Para pruebas locales exponé el servidor con ngrok:
//   ngrok http 3000
// y usá la URL HTTPS que genera: https://<subdominio>.ngrok-free.app/webhook
