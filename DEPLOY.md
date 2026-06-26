# Guía de deploy — Chatbot Futsal

## Sección 1 — Subir el código a GitHub

> **Antes de empezar:** verificá que `.env` y cualquier archivo `*.json`
> de credenciales **no** estén trackeados. El `.gitignore` ya los excluye,
> pero un `git status` rápido lo confirma.

```bash
# Desde la raíz del proyecto
git init
git add .
git status          # Confirmá que .env y service-account.json NO aparecen
git commit -m "Initial commit"

# Creá el repo en GitHub (vacío, sin README) y luego:
git remote add origin https://github.com/<tu-usuario>/<tu-repo>.git
git branch -M main
git push -u origin main
```

---

## Sección 2 — Deploy en Railway

### Conectar el repositorio

1. Entrá a [railway.app](https://railway.app) y creá un proyecto nuevo.
2. Elegí **"Deploy from GitHub repo"** y seleccioná tu repositorio.
3. Railway detecta automáticamente Node.js y ejecuta `npm install && npm start`.

### Variables de entorno

En el panel de Railway: proyecto → **Variables** → agregá una por una:

| Variable | Valor |
|---|---|
| `PORT` | *(Railway lo inyecta automáticamente — no hace falta definirlo)* |
| `TWILIO_ACCOUNT_SID` | Tu Account SID de Twilio |
| `TWILIO_AUTH_TOKEN` | Tu Auth Token de Twilio |
| `TWILIO_WHATSAPP_FROM` | `whatsapp:+14155238886` |
| `GOOGLE_SHEETS_ID` | ID de tu Google Sheet (parte de la URL) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Email de la Service Account |
| `GOOGLE_PRIVATE_KEY` | Clave privada completa (ver abajo) |

### Cómo pegar la GOOGLE_PRIVATE_KEY

En el archivo JSON de la Service Account hay un campo `"private_key"` con
este formato:

```
"-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n"
```

Copiá **el valor completo** incluyendo los `\n` literales y pegalo tal cual
en Railway. Railway interpreta la variable como string plano; el código ya
se encarga de convertir `\n` en saltos de línea reales al usarla.

---

## Sección 3 — Configurar el webhook en Twilio

Una vez que Railway despliega el proyecto te asigna una URL pública del tipo:

```
https://tu-app.railway.app
```

### Pasos en la consola de Twilio

1. Entrá a [console.twilio.com](https://console.twilio.com).
2. Navegá a **Messaging → Try it out → Send a WhatsApp message**.
3. En la sección **Sandbox Settings** buscá el campo
   **"When a message comes in"**.
4. Pegá la URL completa del webhook:
   ```
   https://tu-app.railway.app/webhook
   ```
5. Asegurate de que el método esté en **HTTP POST**.
6. Guardá los cambios.

---

## Sección 4 — Probar en producción

### Verificar que el servidor está activo

Abrí en el navegador (o con curl):

```
https://tu-app.railway.app/health
```

Debería devolver:

```json
{ "status": "ok" }
```

Si ves esa respuesta, el servidor está corriendo y el webhook está listo.

### Enviar el primer mensaje de prueba

1. En la consola de Twilio (Messaging → Try it out → Send a WhatsApp message)
   encontrás el **código de join** del sandbox, algo como `join <palabra>-<palabra>`.
2. Desde tu WhatsApp enviá ese mensaje al número del sandbox
   (`+1 415 523 8886`).
3. Una vez unido, escribí cualquier mensaje (por ejemplo `hola`) — el bot
   debería responderte con el menú de opciones.
4. Probá las tres opciones: `1` (stock), `2` (cuotas), `3` (partidos).

### Revisar logs en Railway

En el panel de Railway: proyecto → **Deployments** → clic en el deploy activo
→ pestaña **Logs**. Cada mensaje entrante queda registrado con el prefijo
`[webhook]` y cada envío con `[twilio]`.
