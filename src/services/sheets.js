const { google } = require('googleapis');

// ─── Auth ────────────────────────────────────────────────────────────────────

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

// ─── Cache ───────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60 * 1000;
const cache = {};

function fromCache(key) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    delete cache[key];
    return null;
  }
  return entry.data;
}

function toCache(key, data) {
  cache[key] = { data, ts: Date.now() };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Lee un rango de una pestaña y devuelve array de objetos
 * usando la primera fila como nombres de columna.
 */
async function readSheet(tab, range) {
  const cacheKey = `${tab}!${range}`;
  const cached = fromCache(cacheKey);
  if (cached) return cached;

  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: `${tab}!${range}`,
  });

  const rows = response.data.values || [];
  if (rows.length < 2) {
    toCache(cacheKey, []);
    return [];
  }

  const [headers, ...dataRows] = rows;
  const result = dataRows.map((row) =>
    Object.fromEntries(headers.map((h, i) => [h.trim(), row[i] ?? '']))
  );

  toCache(cacheKey, result);
  return result;
}

// ─── Funciones públicas ───────────────────────────────────────────────────────

/**
 * Devuelve productos con Cantidad > 0.
 * [{ producto, talle, cantidad, precio }]
 */
function normalizarUrlImagen(url) {
  if (!url) return '';
  const matchFile = url.match(/\/file\/d\/([^/?]+)/);
  if (matchFile) return `https://drive.google.com/uc?export=view&id=${matchFile[1]}`;
  const matchId = url.match(/[?&]id=([^&]+)/);
  if (matchId) return `https://drive.google.com/uc?export=view&id=${matchId[1]}`;
  return url;
}

async function getStock() {
  try {
    const rows = await readSheet('Stock', 'A:E');
    return rows
      .filter((r) => parseInt(r.Cantidad, 10) > 0)
      .map((r) => ({
        producto: r.Producto,
        talle: r.Talle,
        cantidad: parseInt(r.Cantidad, 10),
        precio: String(r.Precio || '').replace(/^\$\s*/, '').trim(),
        imagenUrl: normalizarUrlImagen(r.ImagenUrl),
      }));
  } catch (err) {
    console.error('[sheets] Error en getStock:', err.message);
    throw err;
  }
}

/**
 * Busca cuotas pendientes de un socio por su DNI.
 * Devuelve { encontrado, nombre, cuotas, totalMonto } o { encontrado: false }.
 */
async function getCuotasPendientes(dni) {
  try {
    const socios = await readSheet('Socios', 'A:E');
    const socio = socios.find((s) => s.DNI === String(dni));

    if (!socio) return { encontrado: false };

    const cuotasRows = await readSheet('Cuotas', 'A:F');

    const cuotasPendientes = cuotasRows.filter(
      (c) =>
        c.Nombre === socio.Nombre &&
        c.Apellido === socio.Apellido &&
        c.Estado === 'Pendiente'
    );

    const totalMonto = cuotasPendientes.reduce(
      (sum, c) => sum + parseFloat(c.Monto || 0),
      0
    );

    return {
      encontrado: true,
      nombre: `${socio.Nombre} ${socio.Apellido}`,
      cuotas: cuotasPendientes.map((c) => ({
        mes: c.Mes,
        tipo: c.Tipo || 'Otra',
        estado: c.Estado,
        monto: parseFloat(c.Monto || 0),
      })),
      totalMonto,
    };
  } catch (err) {
    console.error('[sheets] Error en getCuotasPendientes:', err.message);
    throw err;
  }
}

/**
 * Devuelve los próximos `cantidad` partidos desde hoy, ordenados por fecha.
 * [{ fecha, hora, rival, lugar, categoria }]
 */
async function getProximosPartidos(cantidad = 3) {
  try {
    const hoy = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const rows = await readSheet('Partidos', 'A:E');

    return rows
      .filter((r) => r.Fecha >= hoy)
      .sort((a, b) => (a.Fecha > b.Fecha ? 1 : -1))
      .slice(0, cantidad)
      .map((r) => ({
        fecha: r.Fecha,
        hora: r.Hora,
        rival: r.Rival,
        lugar: r.Lugar,
        categoria: r.Categoria,
      }));
  } catch (err) {
    console.error('[sheets] Error en getProximosPartidos:', err.message);
    throw err;
  }
}

module.exports = { getStock, getCuotasPendientes, getProximosPartidos };
