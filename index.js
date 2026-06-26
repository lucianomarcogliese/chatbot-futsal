require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Webhook de WhatsApp/Twilio (se implementa después)
const webhookRouter = require('./src/routes/webhook');
app.use('/webhook', webhookRouter);

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
