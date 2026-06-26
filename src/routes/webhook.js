const express = require('express');
const router = express.Router();
const { handleIncomingMessage } = require('../services/botLogic');

// POST /webhook — punto de entrada de mensajes entrantes de Twilio
router.post('/', (req, res) => {
  res.sendStatus(200); // Twilio queda satisfecho de inmediato

  const from = req.body.From;
  const body = req.body.Body;

  if (!from || !body) return;

  console.log(`[webhook] Mensaje recibido de ${from}: "${body}"`);

  handleIncomingMessage(from, body)
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
