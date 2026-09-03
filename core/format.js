/* ===========================================================================
   Norte core — formatters, labels, date helpers, icon paths
   ---------------------------------------------------------------------------
   PORTABLE. No DOM, no localStorage, no network. Runs unchanged in the
   browser, in Node (tests) and in React Native.

   Extracted from src/lib.js. The web-only half (API url, localStorage
   wrapper, cache keys) stayed behind in src/lib.js on purpose: those are the
   only three things in the old file that a phone cannot use as written.

   ICONS holds raw SVG path data, not markup, so the same table feeds <path>
   on the web and <Path> from react-native-svg on the phone.
   =========================================================================== */

/* ----------------------------- formatting ------------------------------- */

const fmtMXN = new Intl.NumberFormat("es-MX",
  { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const fmtMXN2 = new Intl.NumberFormat("es-MX",
  { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const mxn = (v) => fmtMXN.format(Math.round(v || 0));
const mxn2 = (v) => fmtMXN2.format(v || 0);
const pct = (v) => (Math.round((v || 0) * 100) / 100).toLocaleString("es-MX") + "%";

/** Numeric with a fallback. Use for values that are genuinely optional. */
const num = (v, dflt = 0) =>
  v === "" || v == null || isNaN(Number(v)) ? dflt : Number(v);

/**
 * Numeric, or null for sentinels. The dataset shares columns between numbers
 * and UNKNOWN / NOT_APPLICABLE / UNCAPPED, so anything doing arithmetic must
 * branch on type first — coercing a sentinel to a default is how an unknown
 * silently becomes a fact.
 */
const knownNum = (v) =>
  v === "" || v == null ||
  ["UNKNOWN", "UNCAPPED", "NOT_APPLICABLE"].includes(String(v).trim().toUpperCase()) ||
  isNaN(Number(v))
    ? null
    : Number(v);


/**
 * What a card costs, as a label — never just the annual fee.
 *
 * Six mapped cards charge $0 a year and then a monthly penalty when spend falls
 * below a threshold: Walmart INVEX is $273/mes under $1,200, which is $3,276 a
 * year, more than any annual fee in the dataset except Infinite. Rendering
 * annual_fee_mxn alone calls those cards free, so every surface that shows a
 * fee goes through here.
 *
 * Returns { text, conditional } — `conditional` is true when the headline zero
 * depends on the user's own spending, so callers can style it as a caveat.
 */
const PERIOD_SUFFIX = { monthly: "/mes", quarterly: "/trimestre", annual: "/año" };
const PERIODS_PER_YEAR = { monthly: 12, quarterly: 4, annual: 1 };

const feeLabel = (card) => {
  const fee = knownNum(card.annual_fee_mxn);
  const inact = knownNum(card.inactivity_fee_mxn);
  const floor = knownNum(card.inactivity_min_spend_mxn);
  const iva = card.annual_fee_includes_iva === false ? " + IVA" : "";
  // Banorte measures per quarter where Invex and Santander measure per month.
  // Both the penalty and the spend threshold carry their own period, and they
  // are not always the same field, so neither may be assumed.
  const per = PERIOD_SUFFIX[String(card.inactivity_fee_period || "").toLowerCase()] || "";
  const spendPer =
    PERIOD_SUFFIX[String(card.inactivity_spend_period || "").toLowerCase()] || "";

  if (fee === null) return { text: "anualidad sin dato", conditional: false };

  if (fee > 0) {
    const billed = card.fee_billing_period === "monthly" ? ", cobrada mensualmente" : "";
    return { text: mxn(fee) + "/año" + iva + billed, conditional: false };
  }

  // fee === 0. Free only if there is no penalty attached to it.
  if (inact === null || inact <= 0) return { text: "sin anualidad", conditional: false };

  const cond = floor === null
    ? "sin anualidad, pero cobra " + mxn(inact) + per + " por inactividad"
    : "sin anualidad si gastas " + mxn(floor) + spendPer + "; si no, " + mxn(inact) + per;
  return { text: cond, conditional: true };
};

/** Yearly worst case, for portfolio totals: annual fee plus a full year of penalty. */
const maxCarryingCost = (card) => {
  const fee = knownNum(card.annual_fee_mxn) || 0;
  const inact = knownNum(card.inactivity_fee_mxn);
  if (inact === null || inact <= 0) return fee;
  const mult = PERIODS_PER_YEAR[String(card.inactivity_fee_period || "").toLowerCase()];
  // An unrecognised period must not silently become "once a year" — that would
  // understate a quarterly penalty fourfold.
  if (!mult) return fee;
  return fee + inact * mult;
};

/* ------------------------------- labels --------------------------------- */

const RTL = { points: "puntos", miles: "millas", cashback: "cashback", none: "sin recompensa" };
const rtl = (t) => RTL[t] || t || "";

/**
 * MIGRATED: keyed on regulated_entity_type, not the old institution_type.
 * Deposit insurance follows the licence, so this table is the single place the
 * mapping lives on the client — it must agree with references/schema.md.
 */
const INST = {
  banco:      { l: "Banco",   ins: "IPAB hasta 400,000 UDIS",      tone: "teal" },
  sofipo:     { l: "Sofipo",  ins: "PROSOFIPO hasta 25,000 UDIS",  tone: "sand" },
  socap:      { l: "Socap",   ins: "FOCOOP hasta 25,000 UDIS",     tone: "sand" },
  ifpe:       { l: "Fintech", ins: "Sin seguro de dep\u00F3sito",      tone: "warn" },
  ifc:        { l: "Fintech", ins: "Sin seguro de dep\u00F3sito",      tone: "warn" },
  sofom_er:   { l: "Sofom",   ins: "Sin seguro de dep\u00F3sito",      tone: "warn" },
  sofom_enr:  { l: "Sofom",   ins: "Sin seguro de dep\u00F3sito",      tone: "warn" },
  casa_bolsa: { l: "Casa de bolsa", ins: "Sin seguro de dep\u00F3sito", tone: "warn" },
  other:      { l: "Otro",    ins: "Sin clasificar",               tone: "warn" },
};

const instOf = (issuer) =>
  INST[String((issuer && issuer.regulated_entity_type) || "").trim().toLowerCase()] || null;

/**
 * An issuer that takes no deposits has no scheme to be covered by, which is a
 * different statement from "cover unknown" and must not read as a warning.
 */
const takesDeposits = (issuer) =>
  !(issuer && (issuer.offers_deposit_products === false ||
               String(issuer.offers_deposit_products).toUpperCase() === "FALSE"));

// MIGRATED: yield_structure gained term_tiered.
const YTL = { none: "sin rendimiento", flat: "tasa fija",
              tiered: "por niveles", term_tiered: "por plazo" };
const ytl = (t) => YTL[t] || t || "";

// MIGRATED: liquidity gained same_day; "term" became "term_locked".
const LIQ = { instant: "Inmediata", same_day: "Mismo d\u00EDa", term_locked: "Bloqueado (plazo)" };
const liq = (t) => LIQ[t] || t || "";

const RATE_TYPE = {
  rendimiento_anual_nominal: "rendimiento anual nominal",
  GAT_nominal: "GAT nominal", GAT_real: "GAT real",
};
const rateTypeLabel = (t) => RATE_TYPE[t] || "";

/* -------------------------------- dates --------------------------------- */

const MONTHS = ["enero","febrero","marzo","abril","mayo","junio","julio",
                "agosto","septiembre","octubre","noviembre","diciembre"];

/**
 * A date column, as the day it names — nothing more.
 *
 * In git these fields are clean: cat_calculated_on is "2026-04-16". But the app
 * does not read git, it reads the Sheet, and Apps Script hands back a
 * date-formatted cell as a Date object, which JSON.stringify turns into
 * "2026-04-16T06:00:00.000Z" — the T06:00Z being the CDMX offset, not a time
 * anyone recorded. Rendering that raw put a meaningless timestamp on the CAT.
 *
 * Slicing is correct rather than parsing: the string is already the local day
 * the issuer published, and running it through Date() would shift it back one
 * day for anyone west of UTC.
 *
 * Sentinels pass through untouched so callers can still test for them.
 */
const SENTINELS = ["UNKNOWN", "NOT_APPLICABLE", "UNCAPPED"];

const dateOnly = (v) => {
  const s = String(v == null ? "" : v).trim();
  if (!s || SENTINELS.includes(s.toUpperCase())) return s;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
};

/** The same day, written the way a person in Mexico writes it: "16 abr. 2026". */
const dateLabel = (v) => {
  const iso = dateOnly(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return Number(m[3]) + " " + MONTHS[Number(m[2]) - 1].slice(0, 3) + ". " + m[1];
};

/** Today, as the same kind of string, for comparing against a date column. */
const todayISO = () => new Date().toISOString().slice(0, 10);

const monthLabel = (key) => {
  const [y, m] = String(key).split("-");
  return (MONTHS[Number(m) - 1] || "") + " " + y;
};

const dayLabel = (iso) => {
  const [, m, d] = String(iso).slice(0, 10).split("-");
  return d + " " + (MONTHS[Number(m) - 1] || "").slice(0, 3) + ".";
};

const NOW_MONTH = new Date().toISOString().slice(0, 7);

function weekKey(iso) {
  const dt = new Date(iso);
  const d = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - start) / 86400000 + 1) / 7);
  return d.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
}
const NOW_WEEK = weekKey(new Date().toISOString());

/* ------------------------------ identifiers ----------------------------- */

const uid = (prefix) =>
  prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/* ---------------------------- issuer display ---------------------------- */

const BANK_COLORS = [["bbva","#0B3B7A"],
  ["santander","#C4262E"],
  ["banorte","#C4102A"],
  ["banamex","#00426A"],
  ["citi","#00426A"],
  ["hsbc","#B5121B"],
  ["scotia","#C4262E"],
  ["inbursa","#0A3D91"],
  ["banregio","#C97024"],
  ["nu","#7B2FBE"],
  ["hey","#0E9179"],
  ["klar","#33333D"],
  ["stori","#C75E22"],
  ["uala","#0E8E86"],
  ["didi","#C96A33"],
  ["rappi","#C93B26"],
  ["mercado","#1E7AA8"],
  ["plata","#0E8A78"],
  ["azteca","#127A42"],
  ["coppel","#14539A"],
  ["afirme","#9E2A34"],
  ["bajio","#A81828"],
  ["actinver","#1A3E7A"],
  ["invex","#33333D"],
  ["liverpool","#A81070"],
  ["palacio","#2B2B33"],
  ["cetes","#5B1330"],
  ["finsus","#63307A"],
  ["kubo","#B57A1E"],
  ["revolut","#155FAF"],
  ["bineo","#33619E"],
  ["broxel","#1F4E8C"],
  ["nafin","#5B1330"],
  ["falabella","#0E6E3C"],
  ["sabadell","#0E6E8E"],
  ["multiva","#8A1E3C"],
  ["compartamos","#C4622A"],
  ["bancoppel","#14539A"],
  ["fondeadora","#2B2B33"],
  ["albo","#1E6EA8"]];

function bankColor(name) {
  const n = norm(name);
  for (const [needle, hex] of BANK_COLORS) if (n.includes(needle)) return hex;
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) | 0;
  return "hsl(" + (Math.abs(h) % 360) + ",38%,33%)";
}

const LOWER_WORDS = ["de", "del", "la", "las", "los", "el"];

/** Trims legal suffixes so "Banco Inbursa, S.A., Instituci\u00F3n de Banca M\u00FAltiple" fits a tile. */
function shortIssuer(name) {
  let s = String(name || "").replace(/\(.*?\)/g, " ");
  s = s.replace(/\bAmerican Express\b/gi, "Amex");
  s = s.replace(/\s+(M[e\u00E9]xico|Mexico|MX)\b\.?/gi, " ");
  s = s.replace(
    /[,\s]+\b(S\.?A\.?(\s*de\s*C\.?V\.?)?|S\.?A\.?P\.?I\.?|Instituci[o\u00F3]n de Banca M[u\u00FA]ltiple|Grupo Financiero)\b.*$/i,
    "");
  s = s.replace(/\s+/g, " ").trim();
  let parts = s.split(" ");
  if (parts.length > 1 && /^banco$/i.test(parts[0]) &&
      LOWER_WORDS.indexOf(parts[1].toLowerCase()) < 0) {
    parts = parts.slice(1);
  }
  return parts.join(" ").trim() || String(name || "");
}

function bankInitials(name) {
  const parts = String(name || "?").replace(/\(.*?\)/g, "").trim()
                  .split(/[\s\-]+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.length > 1 && parts[0].length <= 3
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}

/* -------------------------------- icons --------------------------------- */

const ICONS = {
  home: ["M3 10.6 12 3.4l9 7.2","M5.6 9.4V20.6h12.8V9.4"],
  card: ["M2.6 6.4h18.8v11.2H2.6z","M2.6 10.4h18.8"],
  savings: ["M12 3.2v17.6","M16.2 7.6c0-1.9-1.9-3-4.2-3s-4.2 1.1-4.2 3 1.9 2.7 4.2 3.3 4.2 1.4 4.2 3.3-1.9 3-4.2 3-4.2-1.1-4.2-3"],
  grid: ["M3.6 3.6h6.8v6.8H3.6z","M13.6 3.6h6.8v6.8h-6.8z","M3.6 13.6h6.8v6.8H3.6z","M13.6 13.6h6.8v6.8h-6.8z"],
  more: ["M5 12h.01","M12 12h.01","M19 12h.01"],
  search: ["M11 4.2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6","m16.1 16.1 4.3 4.3"],
  close: ["M6.2 6.2 17.8 17.8","M17.8 6.2 6.2 17.8"],
  right: ["m9.4 5.2 6.8 6.8-6.8 6.8"],
  down: ["m5.2 9.4 6.8 6.8 6.8-6.8"],
  plus: ["M12 5.2v13.6","M5.2 12h13.6"],
  trash: ["M4.2 6.8h15.6","M9.2 6.8V4.2h5.6v2.6","M6.6 6.8 7.6 20.4h8.8L17.4 6.8"],
  check: ["m5.2 12.4 4.8 4.8 8.8-10.4"],
  spark: ["M12 3.2 14.2 9.6l6.4 2.4-6.4 2.4L12 20.8l-2.2-6.4L3.4 12l6.4-2.4z"],
  user: ["M12 12.2a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2","M4.4 20.4c.9-3.8 4-5.7 7.6-5.7s6.7 1.9 7.6 5.7"],
  shield: ["M12 3.2 19.4 6.2v5.6c0 4.4-3 8.2-7.4 9.4-4.4-1.2-7.4-5-7.4-9.4V6.2z"],
  logout: ["M14.4 4.4h5.2v15.2h-5.2","M4.4 12h9.6","m10.6 8.4 3.6 3.6-3.6 3.6"],
  edit: ["M4.2 19.8h4L19 9a2.1 2.1 0 0 0-3-3L5.2 15.8z"],
  refresh: ["M20.2 12a8.2 8.2 0 1 1-2.6-6","M20.6 3.6v4.4h-4.4"],
  clock: ["M12 20.8a8.8 8.8 0 1 0 0-17.6 8.8 8.8 0 0 0 0 17.6","M12 7v5.4l3.6 2.1"],
  bank: ["M3.4 9.6 12 4.2l8.6 5.4","M5.8 9.6v9M18.2 9.6v9M10 9.6v9M14 9.6v9","M3.4 20.6h17.2"],
  alert: ["M12 3.4 2.8 20.6h18.4z","M12 10v4.2","M12 17.4h.01"],
  arrowdown: ["M12 4.6v14.8","m6.4 13.4 5.6 6 5.6-6"],
  arrowup: ["M12 19.4V4.6","m6.4 10.6 5.6-6 5.6 6"],
  info: ["M12 20.8a8.8 8.8 0 1 0 0-17.6 8.8 8.8 0 0 0 0 17.6","M12 11v5.4","M12 7.6h.01"],
  supermarket: ["M3.2 5h2.6l2.4 10.2h9.6l2-7.2H7.2","M10 19.4h.01","M17 19.4h.01"],
  restaurants: ["M6.4 3.2v7.6a2.1 2.1 0 0 0 4.2 0V3.2","M8.5 10.8v10","M17.6 3.2c-1.6 1-2.6 3-2.6 5.6s1 4.4 2.6 4.4v7.6"],
  cinema: ["M3.4 4.6h17.2v14.8H3.4z","M8.2 4.6v14.8","M15.8 4.6v14.8"],
  gas: ["M4.6 20.4V5.2a1.6 1.6 0 0 1 1.6-1.6h4.8a1.6 1.6 0 0 1 1.6 1.6v15.2","M3.2 20.4h11.2","M12.6 9.2h2.8l2 2v6.6a1.6 1.6 0 0 1-3.2 0V13.2"],
  travel: ["M20.8 4.2 3.4 11.2l5.8 2.4 2.4 5.8z","M9.2 13.6 20.8 4.2"],
  online: ["M12 20.8a8.8 8.8 0 1 0 0-17.6 8.8 8.8 0 0 0 0 17.6","M3.4 9.6h17.2M3.4 14.4h17.2","M12 3.2c-2.4 2.4-3.6 5.3-3.6 8.8s1.2 6.4 3.6 8.8c2.4-2.4 3.6-5.3 3.6-8.8S14.4 5.6 12 3.2"],
  department_store: ["M5.2 8h13.6l-1.1 12.4H6.3z","M9 8V6a3 3 0 0 1 6 0v2"],
  pharmacy: ["M9.6 3.6h4.8v6h6v4.8h-6v6H9.6v-6h-6V9.6h6z"],
  utilities: ["M13.4 3.2 5.2 14h6l-.6 6.8L18.8 10h-6z"],

  /* The five categories added to categories.json after this set was drawn.
     Until now each fell through to `other`, so a quarter of the grid was
     identical grey dots. */
  home_improvement: ["M14.6 3.4 20.6 9.4l-2.8 2.8-6-6z",
                     "M15 8.6 5.4 18.2a1.8 1.8 0 0 0 2.6 2.6l9.6-9.6z"],
  entertainment: ["M3.4 6.6h17.2v3.2a2.2 2.2 0 0 0 0 4.4v3.2H3.4v-3.2a2.2 2.2 0 0 0 0-4.4z",
                  "M14.8 7v1.8","M14.8 11.1v1.8","M14.8 15.2v1.8"],
  health: ["M12 20.2C7.4 17 3.8 13.6 3.8 9.8a4.2 4.2 0 0 1 8.2-1.4 4.2 4.2 0 0 1 8.2 1.4c0 3.8-3.6 7.2-8.2 10.4z",
           "M6.8 11.4h2.4l1.4-2.2 1.8 4 1.2-1.8h2.6"],
  education: ["M2.8 8.8 12 4.6l9.2 4.2-9.2 4.2z",
              "M6.8 11v4.4c0 1.6 2.3 2.6 5.2 2.6s5.2-1 5.2-2.6V11",
              "M21.2 8.8v5"],
  clothing: ["M8.4 3.6 3.6 6.4l2 3.8 2-1v11.2h8.8V9.2l2 1 2-3.8-4.8-2.8a3.6 3.6 0 0 1-7.2 0z"],

  other: ["M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16","M12 12h.01"]};

/**
 * The canonical category key is `restaurant`; the icon was drawn as
 * `restaurants`. Nothing errored — catIcon just fell through to `other`, so
 * one of the most-used categories in the app showed the generic dot.
 *
 * Aliasing rather than renaming, because the icon name is also a public-ish
 * handle: anything else in the app that already asks for "restaurants" keeps
 * working, and a future key rename in the dataset lands here, not in a
 * component.
 */
const ICON_ALIAS = { restaurant: "restaurants" };

const catIcon = (key) => {
  const k = ICON_ALIAS[key] || key;
  return ICONS[k] ? k : "other";
};

export {
  fmtMXN,
  fmtMXN2,
  mxn,
  mxn2,
  pct,
  num,
  knownNum,
  PERIOD_SUFFIX,
  PERIODS_PER_YEAR,
  feeLabel,
  maxCarryingCost,
  RTL,
  rtl,
  INST,
  instOf,
  takesDeposits,
  YTL,
  ytl,
  LIQ,
  liq,
  RATE_TYPE,
  rateTypeLabel,
  MONTHS,
  SENTINELS,
  dateOnly,
  dateLabel,
  todayISO,
  monthLabel,
  dayLabel,
  NOW_MONTH,
  weekKey,
  NOW_WEEK,
  uid,
  norm,
  BANK_COLORS,
  bankColor,
  LOWER_WORDS,
  shortIssuer,
  bankInitials,
  ICONS,
  ICON_ALIAS,
  catIcon,
};
