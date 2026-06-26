# Chatbot Futsal — WhatsApp Bot

Bot de WhatsApp para gestión de consultas de un club de futsal: stock de ropa, cuotas adeudadas y días de partido.

## Stack

- **Runtime:** Node.js
- **Framework:** Express
- **WhatsApp:** Twilio
- **Base de datos:** Google Sheets (vía googleapis)

## Instalación

```bash
npm install
```

## Configuración

1. Copiá el archivo de ejemplo y completá los valores reales:

```bash
cp .env.example .env
```

2. Editá `.env` con tus credenciales de Twilio y Google Sheets.

## Correr en local

```bash
npm run dev
```

El servidor levanta en `http://localhost:3000` (o el puerto definido en `PORT`).

### Endpoints disponibles

| Método | Ruta       | Descripción                        |
|--------|------------|------------------------------------|
| GET    | /health    | Verificación de estado del servidor |
| POST   | /webhook   | Entrada de mensajes de Twilio       |

## Exponer el webhook localmente (para pruebas)

Para que Twilio pueda alcanzar tu servidor local, usá [ngrok](https://ngrok.com/):

```bash
ngrok http 3000
```

Copiá la URL HTTPS generada y configurala en la consola de Twilio como webhook URL: `https://<tu-subdominio>.ngrok.io/webhook`.
