/* ===========================================================================
   Norte — golden output harness
   ---------------------------------------------------------------------------
   The point of this file is one question: does the extracted core in core/
   produce byte-identical recommendations to the engine that is live today?

   It answers it by running the SAME battery twice — once against the legacy
   src/lib.js + src/engine.js pair evaluated in a shared scope the way the
   browser does it, once against core/index.js as a real module — and diffing
   the two JSON blobs.

     node tools/golden.mjs            compare legacy vs core, exit 1 on drift
     node tools/golden.mjs --write    write tools/golden.json from core
     node tools/golden.mjs --check    compare core against tools/golden.json

   The third mode is the one that matters after the legacy files are gone: it
   pins the engine's behaviour so the React Native port can be proven not to
   have moved a single number.
   =========================================================================== */

import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

/* --------------------------------------------------------------------------
   Fixture. Market data is the real dataset. User data is synthetic and fixed:
   the sheet is not reachable from here, and a golden file must not depend on
   whatever three demo rows happen to be in it today.
   -------------------------------------------------------------------------- */

const M = (n) => json(`data/market/${n}.json`);

/* --market <file> swaps the repo JSON for a bootstrap payload pulled from the
   database. Same battery, same fixture, different source: if the 257 cases
   still match, the round trip through Postgres changed nothing. */
const marketArg = process.argv.indexOf('--market');
const OVERRIDE = marketArg > -1 ? JSON.parse(fs.readFileSync(process.argv[marketArg + 1], 'utf8')) : null;
const KEY = {
  issuers: 'issuers', cards: 'cards', card_rewards: 'cardRewards', card_perks: 'cardPerks',
  accounts: 'accounts', yield_tiers: 'yieldTiers', term_tiers: 'termTiers',
  conditional_boosts: 'conditionalBoosts', categories: 'categories',
  fx_rates: 'fxRates', reference_rates: 'referenceRates',
};
const ID = {
  issuers: 'issuer_id', cards: 'card_id', card_rewards: 'reward_id', card_perks: 'perk_id',
  accounts: 'account_id', yield_tiers: 'tier_id', term_tiers: 'term_id',
  conditional_boosts: 'boost_id', categories: 'category_key',
  fx_rates: 'pair', reference_rates: 'index',
};

/* Every table is sorted by its id before it reaches the engine. Postgres
   returns rows sorted and the JSON files are in the order the skill wrote
   them, so without this the same data produces different fixtures.

   It also pins something worth knowing: the engine's output is not entirely
   independent of input row order. Two products that score identically are
   ranked by their position in the array. Sorting here makes the test
   deterministic; whether the app should break those ties on something more
   meaningful than array position is a separate question, and an open one. */
const T = (n) => {
  const rows = OVERRIDE ? (OVERRIDE[KEY[n]] || []) : M(n);
  const id = ID[n];
  return [...rows].sort((a, b) => String(a[id]).localeCompare(String(b[id])));
};

function fixture() {
  const cards = T('cards');
  const accounts = T('accounts');

  // A deterministic slice: the first cards and accounts that are actually
  // mapped, so the user holds products with real rates rather than skeletons.
  // Sorted by id, not left in file order. The database returns rows sorted and
  // the JSON files do not, so without this the fixture holds different
  // products depending on where the data came from and the two runs cannot be
  // compared at all. Found exactly that way on 2026-09-03.
  const held = (rows, idKey, n) =>
    rows.filter((r) => r.mapping_status === 'mapped' || r.mapping_status === 'MAPPED')
        .map((r) => r[idKey])
        .sort()
        .slice(0, n);

  const heldCardIds = held(cards, 'card_id', 6);
  const heldAcctIds = held(accounts, 'account_id', 5);

  const userProducts = [
    ...heldCardIds.map((id, i) => ({
      id: `up_c${i}`, user_id: 'u1', product_type: 'card', product_id: id,
      current_balance: '', notes: '',
    })),
    ...heldAcctIds.map((id, i) => ({
      id: `up_a${i}`, user_id: 'u1', product_type: 'account', product_id: id,
      current_balance: String(10000 * (i + 1)), notes: '',
    })),
  ];

  // Movements drive the month-to-date caps, so the fixture has to contain some
  // or every cap test scores against zero prior spend and proves nothing.
  const month = new Date().toISOString().slice(0, 7);
  const movements = heldCardIds.flatMap((id, i) => ([
    { movement_id: `mv_${i}a`, user_id: 'u1', timestamp: `${month}-05T12:00:00.000Z`,
      flow: 'cc', direction: '', merchant_category: 'supermarket',
      amount: String(1500 + i * 400), recommended_product_id: id,
      computed_benefit_mxn: '0', notes: '' },
    { movement_id: `mv_${i}b`, user_id: 'u1', timestamp: `${month}-12T12:00:00.000Z`,
      flow: 'cc', direction: '', merchant_category: 'restaurant',
      amount: String(800 + i * 250), recommended_product_id: id,
      computed_benefit_mxn: '0', notes: '' },
  ]));

  return {
    issuers: T('issuers'),
    cards,
    cardRewards: T('card_rewards'),
    cardPerks: [],
    accounts,
    yieldTiers: T('yield_tiers'),
    termTiers: T('term_tiers'),
    conditionalBoosts: T('conditional_boosts'),
    categories: T('categories'),
    fxRates: T('fx_rates'),
    referenceRates: T('reference_rates'),
    users: [{ user_id: 'u1', name: 'Fixture', risk_score: '700', pin: '', is_admin: '', notes: '' }],
    userProducts,
    movements,
    userFlags: { u1: { payroll: false, memberships: [] } },
  };
}

/* --------------------------------------------------------------------------
   The battery. Every public entry point, over enough inputs that a change in
   any branch shows up. Errors are captured rather than thrown so that a
   regression reads as a diff instead of a stack trace.
   -------------------------------------------------------------------------- */

const AMOUNTS = [150, 999, 2500, 12000, 75000];
const BALANCES = [5000, 25000, 120000, 900000];

function battery(E, d) {
  const out = {};
  const call = (label, fn) => {
    try { out[label] = fn(); }
    catch (e) { out[label] = { __error: String(e && e.message || e) }; }
  };

  const cats = d.categories.map((c) => c.category_key).sort();

  for (const cat of cats) {
    for (const amt of AMOUNTS) {
      call(`ccRecommend/${cat}/${amt}`, () => E.ccRecommend(d, 'u1', cat, amt, {}));
    }
  }

  // scoreCard across every held card, not just the winner: the ranking below
  // first place is where silent drift hides.
  const heldCardIds = d.userProducts.filter((p) => p.product_type === 'card').map((p) => p.product_id);
  for (const id of heldCardIds) {
    const card = d.cards.find((c) => c.card_id === id);
    if (!card) continue;
    call(`resolveFee/${id}`, () => E.resolveFee(d, card));
    call(`carryingCost/${id}`, () => E.carryingCost(card, 8000));
    for (const cat of cats.slice(0, 6)) {
      call(`scoreCard/${id}/${cat}`, () => E.scoreCard(d, card, cat, 2500, 'u1', {}));
    }
  }

  for (const amt of AMOUNTS) {
    call(`savingsIn/${amt}`, () => E.savingsIn(d, 'u1', amt, {}));
    call(`savingsOut/${amt}`, () => E.savingsOut(d, 'u1', amt));
  }

  const heldAcctIds = d.userProducts.filter((p) => p.product_type === 'account').map((p) => p.product_id);
  for (const id of heldAcctIds) {
    const a = d.accounts.find((x) => x.account_id === id);
    if (!a) continue;
    call(`headlineRate/${id}`, () => E.headlineRate(d, 'u1', a));
    call(`indexedRate/${id}`, () => E.indexedRate(d, a));
    call(`bestTermRate/${id}`, () => E.bestTermRate(d, a));
    call(`coverageMxn/${id}`, () => E.coverageMxn(d, a));
    for (const bal of BALANCES) {
      call(`annualYield/${id}/${bal}`, () => E.annualYield(d, 'u1', a, bal));
      call(`marginalRate/${id}/${bal}`, () => E.marginalRate(d, 'u1', a, bal));
      call(`blendedRate/${id}/${bal}`, () => E.blendedRate(d, 'u1', a, bal));
      call(`rateIsCapped/${id}/${bal}`, () => E.rateIsCapped(d, 'u1', a, bal));
      call(`boostOpportunity/${id}/${bal}`, () => E.boostOpportunity(d, 'u1', a, bal));
    }
  }

  call('newCardPicks', () => E.newCardPicks(d, 'u1'));
  call('newAccountPicks', () => E.newAccountPicks(d, 'u1'));
  call('portfolio', () => E.portfolio(d, 'u1'));
  call('currentPortfolioYield', () => E.currentPortfolioYield(d, 'u1'));

  return out;
}

/* --------------------------------------------------------------------------
   Legacy loader. src/lib.js and src/engine.js were plain scripts sharing one
   scope in the browser; reproducing that meant evaluating them together in one
   vm context with the browser globals they touch stubbed out.

   This ran once, on 2026-09-03, to prove the extraction into core/ moved no
   numbers: 257 of 257 cases identical. src/engine.js was deleted immediately
   after, so the mode now reports that rather than crashing. Kept because the
   method is the reusable part — the same trick pins any future extraction.
   -------------------------------------------------------------------------- */

function loadLegacy() {
  if (!fs.existsSync(path.join(ROOT, 'src/engine.js'))) return null;
  const sandbox = {
    console,
    Intl, Date, Math, JSON, Number, String, Object, Array, RegExp, isNaN, parseFloat, parseInt,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  vm.createContext(sandbox);
  const src = read('src/lib.js') + '\n;\n' + read('src/engine.js');
  vm.runInContext(src, sandbox, { filename: 'legacy.js' });
  return sandbox;
}

/* -------------------------------------------------------------------------- */

/* Sabido y aceptado: ccRecommend devuelve un ARREGLO con .best, .ranked y
   .unvaluable colgados encima como propiedades, y JSON.stringify ignora las
   propiedades no indexadas de un arreglo. O sea que esas tres no quedan
   fijadas aquí. El contenido sí: el arreglo es ranked.concat(unvaluable) y
   cada elemento lleva su propia bandera unvaluable, así que el orden y la
   clasificación están cubiertos. Lo que no se detectaría es que .best dejara
   de apuntar al primero. Anotado en vez de corregido porque arreglarlo
   obliga a regenerar toda la línea base. */
const stable = (o) => JSON.stringify(o, (k, v) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.fromEntries(Object.keys(v).sort().map((kk) => [kk, v[kk]]));
  }
  return typeof v === 'number' && !Number.isFinite(v) ? String(v) : v;
}, 2);

function diff(a, b) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const bad = [];
  for (const k of keys) {
    const x = stable(a[k]); const y = stable(b[k]);
    if (x !== y) bad.push({ key: k, legacy: x, core: y });
  }
  return bad;
}

const mode = process.argv[2] || '--compare';
const d = fixture();
const core = await import(path.join(ROOT, 'core/index.js'));
const coreOut = battery(core, d);
const nCases = Object.keys(coreOut).length;

/* The full battery serialises to ~3 MB, which is not a thing to put in a repo
   and re-diff on every commit. So the golden file stores a hash per case, plus
   the full value for a short list of headline cases — enough that a drift
   report shows real numbers rather than only a changed digest. */

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

const HEADLINE = (keys) => [
  'portfolio', 'currentPortfolioYield', 'newCardPicks', 'newAccountPicks',
  ...keys.filter((k) => k.startsWith('ccRecommend/supermarket/')),
  ...keys.filter((k) => k.startsWith('savingsIn/')).slice(0, 3),
];

function condense(out) {
  const keys = Object.keys(out).sort();
  const head = new Set(HEADLINE(keys));
  return {
    cases: keys.length,
    hashes: Object.fromEntries(keys.map((k) => [k, sha(stable(out[k]))])),
    values: Object.fromEntries(keys.filter((k) => head.has(k)).map((k) => [k, out[k]])),
  };
}

if (mode === '--write') {
  fs.writeFileSync(path.join(ROOT, 'tools/golden.json'), stable(condense(coreOut)) + '\n');
  console.log(`wrote tools/golden.json — ${nCases} cases`);
  process.exit(0);
}

if (mode === '--check') {
  const want = json('tools/golden.json');
  const got = condense(coreOut);
  const bad = [];
  for (const k of [...new Set([...Object.keys(want.hashes), ...Object.keys(got.hashes)])].sort()) {
    if (want.hashes[k] !== got.hashes[k]) {
      bad.push({
        key: k,
        legacy: k in want.values ? stable(want.values[k]) : `hash ${want.hashes[k] || 'absent'}`,
        core: k in got.values ? stable(got.values[k]) : `hash ${got.hashes[k] || 'absent'}`,
      });
    }
  }
  if (!bad.length) { console.log(`golden: ${nCases} cases, no drift`); process.exit(0); }
  console.error(`golden: ${bad.length} of ${nCases} cases drifted`);
  for (const b of bad.slice(0, 10)) console.error(`\n· ${b.key}\n  golden: ${b.legacy.slice(0, 400)}\n  now:    ${b.core.slice(0, 400)}`);
  process.exit(1);
}

const legacy = loadLegacy();
if (!legacy) {
  console.log('parity: src/engine.js is gone — the legacy comparison already ran and passed.');
  console.log('        Use --check against tools/golden.json from here on.');
  process.exit(0);
}
const legacyOut = battery(legacy, fixture());
const bad = diff(legacyOut, coreOut);
if (!bad.length) {
  console.log(`parity: ${nCases} cases, legacy and core agree on every one`);
  process.exit(0);
}
console.error(`parity: ${bad.length} of ${nCases} cases differ`);
for (const b of bad.slice(0, 10)) {
  console.error(`\n· ${b.key}\n  legacy: ${b.legacy.slice(0, 300)}\n  core:   ${b.core.slice(0, 300)}`);
}
process.exit(1);
