/* ===========================================================================
   Norte — cargar el repo a Supabase sin psql
   ---------------------------------------------------------------------------
   Hace lo mismo que db/seed.sql, pero contra la API REST, así que no hace
   falta psql ni el CLI de Supabase. Solo Node, y funciona desde la 16.

       export SUPABASE_URL='https://xxxxxxxx.supabase.co'
       export SUPABASE_SERVICE_ROLE_KEY='eyJ...'      # Settings > API

       node db/push.mjs              borra y recarga las tablas de mercado
       node db/push.mjs --dry-run    imprime qué haría, sin tocar nada
       node db/push.mjs --verify     descarga bootstrap_market() a un archivo

   LA SERVICE ROLE KEY SE SALTA ROW LEVEL SECURITY. Es la llave de admin.
   Va en una variable de entorno, nunca en un archivo del repo, nunca pegada
   en un chat. Si se filtra, se rota en Settings > API.

   El orden de las tablas respeta las llaves foráneas. Si un card_id apunta a
   un emisor que no existe, la carga falla aquí y no meses después.
   =========================================================================== */

import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market', n + '.json'), 'utf8'));

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DRY = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');

if (!DRY && (!URL_BASE || !KEY)) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  console.error('Están en Supabase, Settings > API. Expórtalas en la terminal:');
  console.error("  export SUPABASE_URL='https://xxxxxxxx.supabase.co'");
  console.error("  export SUPABASE_SERVICE_ROLE_KEY='eyJ...'");
  process.exit(2);
}

/** [tabla, archivo json, campo id] en orden de dependencia. */
const TABLES = [
  ['issuers',            'issuers',            'issuer_id'],
  ['cards',              'cards',              'card_id'],
  ['card_rewards',       'card_rewards',       'reward_id'],
  ['accounts',           'accounts',           'account_id'],
  ['yield_tiers',        'yield_tiers',        'tier_id'],
  ['term_tiers',         'term_tiers',         'term_id'],
  ['conditional_boosts', 'conditional_boosts', 'boost_id'],
  ['categories',         'categories',         'category_key'],
  ['fx_rates',           'fx_rates',           'pair'],
  ['reference_rates',    'reference_rates',    'index'],
];

/* Node 16 no trae fetch global, así que esto va sobre node:https directo.
   Un poco más largo, cero dependencias, y corre en cualquier máquina. */
function request(method, url, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const u = new global.URL(url);
    const req = https.request({
      method,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': payload.length } : {}),
        ...extraHeaders,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(text);
        reject(new Error(`HTTP ${res.statusCode} en ${method} ${u.pathname}\n${text.slice(0, 600)}`));
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const rest = (table, query = '') => `${URL_BASE}/rest/v1/${table}${query}`;

/* Lotes: una fila de tarjeta pesa unos 3 KB y un POST de 180 de golpe puede
   pasarse del límite del gateway. 50 es holgado y sigue siendo rápido. */
const BATCH = 50;
const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

async function push() {
  // Borrar en orden inverso para no pelear con las llaves foráneas.
  // PostgREST exige un filtro en DELETE; raw es NOT NULL, así que este
  // siempre es verdadero y no depende del nombre de la llave primaria.
  for (const [table] of [...TABLES].reverse()) {
    if (DRY) { console.log(`delete ${table}`); continue; }
    await request('DELETE', rest(table, '?raw=not.is.null'), undefined,
                  { Prefer: 'return=minimal' });
    console.log(`vaciada  ${table}`);
  }

  let total = 0;
  for (const [table, file, idField] of TABLES) {
    const rows = M(file);

    const seen = new Set();
    for (const r of rows) {
      const id = r[idField];
      if (id == null || id === '') throw new Error(`${file}: una fila no tiene ${idField}`);
      if (seen.has(id)) throw new Error(`${file}: ${idField} duplicado: ${id}`);
      seen.add(id);
    }

    // Solo se envía raw. Todas las demás columnas son GENERATED y las calcula
    // Postgres; mandarlas sería un error y además una segunda copia que
    // podría contradecir a la primera.
    const payload = rows.map((raw) => ({ raw }));

    if (DRY) { console.log(`insert ${table}: ${rows.length} filas`); total += rows.length; continue; }

    for (const part of chunk(payload, BATCH)) {
      await request('POST', rest(table), part, { Prefer: 'return=minimal' });
    }
    console.log(`cargada  ${table}: ${rows.length} filas`);
    total += rows.length;
  }

  console.log(`\n${total} filas en ${TABLES.length} tablas`);
}

async function verify() {
  const text = await request('POST', `${URL_BASE}/rest/v1/rpc/bootstrap_market`, {});
  const out = path.join(ROOT, 'db/bootstrap.json');
  fs.writeFileSync(out, text);
  const data = JSON.parse(text);
  const counts = Object.entries(data).map(([k, v]) => `${k}=${v.length}`).join(' ');
  console.log(`db/bootstrap.json escrito\n${counts}`);
  console.log('\nAhora las dos pruebas:');
  console.log('  node db/verify.mjs db/bootstrap.json');
  console.log('  node tools/golden.mjs --check --market db/bootstrap.json');
}

try {
  if (VERIFY) await verify();
  else await push();
} catch (e) {
  console.error('\n' + e.message);
  process.exit(1);
}
