require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getStock, getCuotasPendientes, getProximosPartidos } = require('./services/sheets');

async function main() {
  console.log('=== TEST: getStock ===');
  const stock = await getStock();
  console.log(stock.length ? stock : '(sin productos con stock)');

  console.log('\n=== TEST: getCuotasPendientes (DNI: 12345678) ===');
  const cuotas = await getCuotasPendientes('12345678');
  console.log(cuotas);

  console.log('\n=== TEST: getProximosPartidos (próximos 3) ===');
  const partidos = await getProximosPartidos(3);
  console.log(partidos.length ? partidos : '(sin partidos próximos)');
}

main().catch((err) => {
  console.error('Error en test:', err.message);
  process.exit(1);
});
