/* ===========================================================================
   Norte — is the database a lossless copy of the repo?
   ---------------------------------------------------------------------------
       node db/verify.mjs <bootstrap.json>

   where bootstrap.json is the output of:

       psql -tA -d norte -c 'select bootstrap_market()'

   Compares every row, field by field, against data/market/*.json. Not a
   count, not a spot check: the sentinels are the reason this file exists.
   UNKNOWN and UNCAPPED look alike to a row count and mean opposite things to
   the engine, so the comparison has to be on values.

   Order is ignored (the database sorts by id, the files do not) but content
   is not: a missing field, a number that became a string, a null that became
   an empty string, all fail here.
   =========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market', n + '.json'), 'utf8'));

const TABLES = [
  ['issuers', 'issuers', 'issuer_id'],
  ['cards', 'cards', 'card_id'],
  ['cardRewards', 'card_rewards', 'reward_id'],
  ['accounts', 'accounts', 'account_id'],
  ['yieldTiers', 'yield_tiers', 'tier_id'],
  ['termTiers', 'term_tiers', 'term_id'],
  ['conditionalBoosts', 'conditional_boosts', 'boost_id'],
  ['categories', 'categories', 'category_key'],
  ['fxRates', 'fx_rates', 'pair'],
  ['referenceRates', 'reference_rates', 'index'],
];

const file = process.argv[2];
if (!file) { console.error('usage: node db/verify.mjs <bootstrap.json>'); process.exit(2); }
const db = JSON.parse(fs.readFileSync(file, 'utf8'));

/* Key order differs between JSON.stringify of a file row and of a jsonb row,
   and that difference is meaningless. Sort keys before comparing; everything
   else, including types, must match exactly. */
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  }
  return v;
};
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

let problems = 0;
let rowsChecked = 0;
let fieldsChecked = 0;

for (const [key, fileName, idField] of TABLES) {
  const want = M(fileName);
  const got = db[key] || [];
  const gotById = new Map(got.map((r) => [r[idField], r]));

  if (want.length !== got.length) {
    console.error(`${key}: repo has ${want.length} rows, database has ${got.length}`);
    problems++;
  }

  for (const w of want) {
    const id = w[idField];
    const g = gotById.get(id);
    if (!g) { console.error(`${key}: ${id} missing from database`); problems++; continue; }
    rowsChecked++;

    const keys = [...new Set([...Object.keys(w), ...Object.keys(g)])];
    for (const k of keys) {
      fieldsChecked++;
      if (!eq(w[k], g[k])) {
        console.error(
          `${key}/${id}.${k}\n  repo: ${JSON.stringify(w[k])}\n  db:   ${JSON.stringify(g[k])}`);
        problems++;
      }
    }
    gotById.delete(id);
  }

  for (const id of gotById.keys()) {
    console.error(`${key}: ${id} is in the database but not in the repo`);
    problems++;
  }
}

/* The sentinels get their own count, stated out loud. They are the fields the
   schema was designed around, so "they survived" should not be an inference
   drawn from a silent pass. */
const SENT = ['UNKNOWN', 'UNCAPPED', 'NOT_APPLICABLE'];
let sentinels = 0;
for (const [key] of TABLES) {
  for (const row of db[key] || []) {
    for (const v of Object.values(row)) {
      if (typeof v === 'string' && SENT.includes(v.trim().toUpperCase())) sentinels++;
    }
  }
}

if (problems) {
  console.error(`\n${problems} problems`);
  process.exit(1);
}
console.log(`lossless: ${rowsChecked} rows, ${fieldsChecked} fields, identical to the repo`);
console.log(`          ${sentinels} sentinel values survived the round trip intact`);
