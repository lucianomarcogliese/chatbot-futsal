'use strict';
const https = require('https');

const SYSTEM_PROMPT =
  'Sos el asistente de WhatsApp de un club de fútbol sala (futsal). ' +
  'Respondés siempre en español rioplatense (Argentina): tuteo, "querés", "podés", "tenés". ' +
  'Usás emojis con moderación y formateás para WhatsApp usando *negrita* con asteriscos. ' +
  'Sos amigable, conciso y claro. Nunca inventás datos: solo usás la información que te proveen. ' +
  'Hablás de forma NATURAL y conversacional, como lo haría una persona real. ' +
  'Nunca das instrucciones tipo "escribí X para consultar Y". ' +
  'En vez de listar comandos, contás lo que podés hacer y preguntás qué le interesa.';

// ─── HTTP helper genérico hacia la API de Anthropic ──────────────────────────

function callAnthropicApi(bodyStr) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) return reject(new Error(`Anthropic: ${parsed.error.message}`));
          resolve(parsed.content[0].text.trim());
        } catch (e) {
          reject(new Error(`Error parseando respuesta de Claude: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function callClaude(prompt) {
  const body = JSON.stringify({
    model: 'claude-haiku-4-5',
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });
  return callAnthropicApi(body);
}

// ─── Descarga media de Twilio (sigue redirección al CDN) ─────────────────────

function downloadTwilioMedia(url) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(
      `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
    ).toString('base64');

    function fetchUrl(targetUrl, withAuth) {
      const parsed = new URL(targetUrl);
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + (parsed.search || ''),
        method: 'GET',
        headers: withAuth ? { Authorization: `Basic ${auth}` } : {},
      };
      const req = https.request(options, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          fetchUrl(res.headers.location, false);
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
      });
      req.on('error', reject);
      req.end();
    }

    fetchUrl(url, true);
  });
}

// ─── Validación de comprobante con Claude vision ──────────────────────────────

async function validateComprobante(mediaUrl) {
  const imageBase64 = await downloadTwilioMedia(mediaUrl);

  const body = JSON.stringify({
    model: 'claude-haiku-4-5',
    max_tokens: 80,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
        },
        {
          type: 'text',
          text: '¿Esta imagen es un comprobante válido de transferencia bancaria (captura de pago, recibo de CBU, alias, CVU, billetera virtual)? ' +
                'Respondé únicamente VALIDO o INVALIDO.',
        },
      ],
    }],
  });

  const result = await callAnthropicApi(body);
  return result.toUpperCase().startsWith('VALIDO');
}

// ─── Generación de respuestas de texto ───────────────────────────────────────

async function generateResponse(intent, data, userMessage) {
  let prompt;

  switch (intent) {
    case 'menu':
      prompt =
        `El usuario mandó: "${userMessage}". ` +
        'Saludalo de forma natural y contale brevemente que podés ayudarlo con ' +
        'sus cuotas del club, el stock de indumentaria, los próximos partidos ' +
        'y las formas de pago. ' +
        'No listes comandos ni digas cómo escribir cada consulta. ' +
        'Presentate como si fueras un colaborador del club charlando por WhatsApp. ' +
        'Terminá con una pregunta natural sobre qué necesita.';
      break;

    case 'pedir_dni':
      prompt = 'El usuario quiere consultar sus cuotas pendientes. Pedile su DNI para buscar su información.';
      break;

    case 'pedir_dni_invalido':
      prompt =
        `El usuario mandó "${userMessage}" cuando el bot le estaba pidiendo su DNI. ` +
        'Eso no parece un DNI válido. Pedile amigablemente que ingrese solo los números de su DNI (7 u 8 dígitos), sin puntos ni espacios.';
      break;

    case 'stock':
      prompt = 'No hay stock de indumentaria disponible en este momento. Informale de forma amigable.';
      break;

    case 'stock_lista': {
      const lista = data.map((p) => `${p.numero}. ${p.nombre}`).join('\n');
      prompt =
        `El usuario preguntó por stock de indumentaria. Los productos disponibles son:\n${lista}\n\n` +
        'Presentá el listado de forma atractiva MANTENIENDO exactamente la numeración original de cada producto. ' +
        'Los números son importantes, no los quites ni los reorganices en categorías. ' +
        'Preguntale de forma natural cuál le interesa, algo como "¿alguno te llama la atención?" ' +
        'o "decime cuál querés ver y te mando los detalles".';
      break;
    }

    case 'stock_no_encontrado': {
      const opciones = data.map((p) => `${p.numero}. ${p.nombre}`).join('\n');
      prompt =
        `El usuario respondió "${userMessage}" pero no coincide con ningún producto del catálogo.\n` +
        `Los productos disponibles son:\n${opciones}\n\n` +
        'Avisale amigablemente que no entendiste y pedile que elija un número de la lista.';
      break;
    }

    case 'cuotas':
      if (!data.encontrado) {
        prompt =
          'El usuario ingresó un DNI que no existe en el sistema. ' +
          'Avisale que no lo encontraste y que verifique el número o se contacte con el administrador del club.';
      } else if (!data.cuotas.length) {
        prompt = `El socio ${data.nombre} no tiene cuotas pendientes, está al día con todo. Felicitalo de forma positiva.`;
      } else {
        const porTipo = data.cuotas.reduce((acc, c) => {
          const tipo = c.tipo || 'Otra';
          if (!acc[tipo]) acc[tipo] = [];
          acc[tipo].push(c);
          return acc;
        }, {});
        const detalle = Object.entries(porTipo)
          .map(([tipo, cuotas]) => {
            const lineas = cuotas
              .map((c) => `${c.mes}: $${c.monto.toLocaleString('es-AR')}`)
              .join(', ');
            return `Cuota ${tipo}: ${lineas}`;
          })
          .join(' | ');
        prompt =
          `El socio ${data.nombre} tiene cuotas pendientes: ${detalle}. ` +
          `Total adeudado: $${data.totalMonto.toLocaleString('es-AR')}.\n\n` +
          'Presentá esta información agrupada por tipo de cuota ' +
          '(usá 🏛️ para Social y ⚽ para Futsal) con *negrita* en los títulos. ' +
          'Mostrá el total al final.';
      }
      break;

    case 'partidos':
      if (!data || !data.length) {
        prompt = 'No hay partidos programados en este momento. Informale al usuario de forma amigable.';
      } else {
        const jornadasTexto = data
          .map((j) => {
            const cats = j.categorias
              .map((c) => `    • ${c.categoria}: ${c.hora} hs`)
              .join('\n');
            return `Jornada: ${j.fecha} VS ${j.rival} | ${j.lugar}\nCategorías:\n${cats}`;
          })
          .join('\n\n');
        prompt =
          `El usuario consultó los próximos partidos. Las jornadas programadas son:\n\n${jornadasTexto}\n\n` +
          'Presentá cada jornada agrupada: fecha y rival una sola vez arriba, y cada categoría ' +
          'con su horario en lista debajo. Usá emojis y formato claro para WhatsApp.';
      }
      break;

    case 'valor_cuotas':
      prompt =
        'El usuario quiere saber cuánto cuestan las cuotas del club. Los valores vigentes son:\n' +
        '- Cuota Social Menor: $15.000\n' +
        '- Cuota Social Mayor: $18.000\n' +
        '- Cuota Futsal: $35.000\n\n' +
        'Informale de forma clara y amigable para WhatsApp.';
      break;

    case 'pago':
      prompt =
        'El usuario quiere saber cómo pagar las cuotas del club. ' +
        'Explicale que tiene dos opciones:\n' +
        '1. En efectivo en la secretaría del club, de lunes a viernes de 8:30 a 14:00 hs o de 16:30 a 20:30 hs.\n' +
        '2. Por transferencia bancaria al CBU: 123123123123.\n' +
        'Presentá la información de forma clara y amigable para WhatsApp.';
      break;

    case 'cierre':
      prompt =
        `El usuario mandó: "${userMessage}". Es un acuse de recibo o cierre de conversación. ` +
        'Respondé de forma corta y amigable (máximo 2 líneas). No repitas el menú de opciones.';
      break;

    case 'no_entendido':
      prompt =
        `El usuario escribió: "${userMessage}" y el bot no entendió la consulta. ` +
        'Avisale que no entendiste y explicale con qué palabras puede consultar: ' +
        'sus cuotas (ej: "cuotas", "cuánto debo"), ' +
        'el stock (ej: "stock", "ropa"), ' +
        'o los partidos (ej: "partidos", "fixture"). Sé amigable.';
      break;

    // ── Reservas ──────────────────────────────────────────────────────────────

    case 'reserva_oferta':
      prompt =
        `El usuario acaba de ver los detalles del producto "${data.nombre}". ` +
        'Preguntale de forma natural y entusiasta si quiere reservarlo. Máximo 2 líneas.';
      break;

    case 'reserva_pedir_nombre':
      prompt =
        `El usuario quiere reservar "${data.producto}". ` +
        'Pedile su nombre de pila de forma amigable para registrar la reserva.';
      break;

    case 'reserva_pedir_apellido':
      prompt =
        `El usuario se llama ${data.nombre} y quiere reservar indumentaria. ` +
        'Pedile el apellido de forma natural para completar el registro.';
      break;

    case 'reserva_pedir_celular':
      prompt =
        `El usuario se llama ${data.nombre} ${data.apellido}. ` +
        'Pedile su número de celular (con código de área) para poder contactarlo si es necesario.';
      break;

    case 'reserva_celular_invalido':
      prompt =
        `El usuario ingresó "${userMessage}" como número de celular pero no parece válido. ` +
        'Pedile amigablemente que ingrese su número de celular con código de área (ej: 11 XXXX-XXXX).';
      break;

    case 'reserva_instrucciones_pago':
      prompt =
        `El usuario ${data.nombre} reservó el producto "${data.producto}". La reserva quedó registrada. ` +
        'Explicale las opciones de pago:\n' +
        '1. Transferencia bancaria al alias *VILTER.2026* — pedile que mande el comprobante por acá cuando esté.\n' +
        '2. En efectivo, comunicándose al *1130350702* para coordinar.\n' +
        'Para el retiro del producto también puede comunicarse a ese número. Sé amigable y transmití entusiasmo.';
      break;

    case 'reserva_comprobante_valido':
      prompt =
        `El usuario ${data.nombre} mandó el comprobante de pago para "${data.producto}" y fue validado correctamente. ` +
        'Confirmale que el pago fue recibido y que pronto lo van a contactar para coordinar el retiro. ' +
        'Sé amigable y entusiasta.';
      break;

    case 'reserva_comprobante_invalido':
      prompt =
        'El usuario mandó una imagen pero no se pudo validar como comprobante de transferencia bancaria. ' +
        'Pedile amigablemente que reenvíe el comprobante. ' +
        'Puede ser una captura del home banking, billetera virtual o app del banco.';
      break;

    case 'reserva_comprobante_recordatorio':
      prompt =
        `El usuario ${data.nombre} tiene una reserva con pago pendiente. ` +
        'Recordale que puede mandar el comprobante de la transferencia al alias *VILTER.2026* por acá, ' +
        'o avisar si prefiere pagar en efectivo (coordinando con el *1130350702*).';
      break;

    case 'reserva_efectivo_ok':
      prompt =
        `El usuario ${data.nombre} eligió pagar en efectivo por "${data.producto}". ` +
        'Confirmale que su reserva quedó anotada y que para coordinar el retiro y el pago ' +
        'se comunique al *1130350702*. Sé amigable.';
      break;

    case 'reserva_rechazada':
      prompt =
        'El usuario no quiere reservar en este momento. ' +
        'Avisale que no hay problema y que puede seguir viendo otros productos o consultar lo que necesite.';
      break;

    default:
      prompt =
        `El usuario escribió: "${userMessage}". ` +
        'Respondé amigablemente y explicale que podés ayudar con cuotas, stock de indumentaria y próximos partidos.';
  }

  return callClaude(prompt);
}

module.exports = { generateResponse, validateComprobante };
