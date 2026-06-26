'use strict';
const https = require('https');

const SYSTEM_PROMPT =
  'Sos el asistente de WhatsApp de un club de fútbol sala (futsal). ' +
  'Respondés siempre en español rioplatense (Argentina): tuteo, "querés", "podés", "tenés". ' +
  'Usás emojis con moderación y formateás para WhatsApp usando *negrita* con asteriscos. ' +
  'Sos amigable, conciso y claro. Nunca inventás datos: solo usás la información que te proveen.';

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
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
    req.write(body);
    req.end();
  });
}

async function generateResponse(intent, data, userMessage) {
  let prompt;

  switch (intent) {
    case 'menu':
      prompt =
        `El usuario mandó: "${userMessage}". ` +
        'Saludalo y presentá el menú de opciones del bot: ' +
        '(1) consulta de cuotas sociales y de futsal, ' +
        '(2) stock de indumentaria (camisetas, talles), ' +
        '(3) próximos partidos, ' +
        '(4) cómo pagar las cuotas. ' +
        'Mencioná brevemente cómo puede consultar cada tema.';
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
        'Presentá el listado numerado de forma atractiva y pedile que responda con el número del producto que quiere ver.';
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

    default:
      prompt =
        `El usuario escribió: "${userMessage}". ` +
        'Respondé amigablemente y explicale que podés ayudar con cuotas, stock de indumentaria y próximos partidos.';
  }

  return callClaude(prompt);
}

module.exports = { generateResponse };
