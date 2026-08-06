/* ===========================================================================
   Norte — shared constants, formatters and helpers
   ---------------------------------------------------------------------------
   Reconstructed from the compiled bundle (the original src/ was never
   committed; only the build output was). This file is SOURCE — index.html is
   generated from it.

   Migrated to the canonical market-data schema (2026-08). Changes from the
   previous build are marked MIGRATED.
   =========================================================================== */

export const API =
  "https://script.google.com/macros/s/AKfycbz0ti8iYODBR60V-AqD-YlTDK4-w7RekiMDrFsz6dJqLeJ9oqRZCyQxuEpFvpAk8ZeP/exec";

/* --------------------------- local storage ------------------------------ */

export const LS = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

export const K_SESSION = "norte.session.v1";
// MIGRATED: cache keys bumped to v2. A cached v1 payload has the old column
// names, and serving one after the cutover looks exactly like a failed deploy.
export const K_MARKET = "norte.market.v2";
export const K_USER = "norte.user.v2";

/* ----------------------------- formatting ------------------------------- */

const fmtMXN = new Intl.NumberFormat("es-MX",
  { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const fmtMXN2 = new Intl.NumberFormat("es-MX",
  { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const mxn = (v) => fmtMXN.format(Math.round(v || 0));
export const mxn2 = (v) => fmtMXN2.format(v || 0);
export const pct = (v) => (Math.round((v || 0) * 100) / 100).toLocaleString("es-MX") + "%";

/** Numeric with a fallback. Use for values that are genuinely optional. */
export const num = (v, dflt = 0) =>
  v === "" || v == null || isNaN(Number(v)) ? dflt : Number(v);

/**
 * Numeric, or null for sentinels. The dataset shares columns between numbers
 * and UNKNOWN / NOT_APPLICABLE / UNCAPPED, so anything doing arithmetic must
 * branch on type first — coercing a sentinel to a default is how an unknown
 * silently becomes a fact.
 */
export const knownNum = (v) =>
  v === "" || v == null ||
  ["UNKNOWN", "UNCAPPED", "NOT_APPLICABLE"].includes(String(v).trim().toUpperCase()) ||
  isNaN(Number(v))
    ? null
    : Number(v);

/* ------------------------------- labels --------------------------------- */

const RTL = { points: "puntos", miles: "millas", cashback: "cashback", none: "sin recompensa" };
export const rtl = (t) => RTL[t] || t || "";

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

export const instOf = (issuer) =>
  INST[String((issuer && issuer.regulated_entity_type) || "").trim().toLowerCase()] || null;

/**
 * An issuer that takes no deposits has no scheme to be covered by, which is a
 * different statement from "cover unknown" and must not read as a warning.
 */
export const takesDeposits = (issuer) =>
  !(issuer && (issuer.offers_deposit_products === false ||
               String(issuer.offers_deposit_products).toUpperCase() === "FALSE"));

// MIGRATED: yield_structure gained term_tiered.
const YTL = { none: "sin rendimiento", flat: "tasa fija",
              tiered: "por niveles", term_tiered: "por plazo" };
export const ytl = (t) => YTL[t] || t || "";

// MIGRATED: liquidity gained same_day; "term" became "term_locked".
const LIQ = { instant: "Inmediata", same_day: "Mismo d\u00EDa", term_locked: "Bloqueado (plazo)" };
export const liq = (t) => LIQ[t] || t || "";

const RATE_TYPE = {
  rendimiento_anual_nominal: "rendimiento anual nominal",
  GAT_nominal: "GAT nominal", GAT_real: "GAT real",
};
export const rateTypeLabel = (t) => RATE_TYPE[t] || "";

/* -------------------------------- dates --------------------------------- */

const MONTHS = ["enero","febrero","marzo","abril","mayo","junio","julio",
                "agosto","septiembre","octubre","noviembre","diciembre"];

export const monthLabel = (key) => {
  const [y, m] = String(key).split("-");
  return (MONTHS[Number(m) - 1] || "") + " " + y;
};

export const dayLabel = (iso) => {
  const [, m, d] = String(iso).slice(0, 10).split("-");
  return d + " " + (MONTHS[Number(m) - 1] || "").slice(0, 3) + ".";
};

export const NOW_MONTH = new Date().toISOString().slice(0, 7);

export function weekKey(iso) {
  const dt = new Date(iso);
  const d = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - start) / 86400000 + 1) / 7);
  return d.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
}
export const NOW_WEEK = weekKey(new Date().toISOString());

/* ------------------------------ identifiers ----------------------------- */

export const uid = (prefix) =>
  prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const norm = (s) =>
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

export function bankColor(name) {
  const n = norm(name);
  for (const [needle, hex] of BANK_COLORS) if (n.includes(needle)) return hex;
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) | 0;
  return "hsl(" + (Math.abs(h) % 360) + ",38%,33%)";
}

const LOWER_WORDS = ["de", "del", "la", "las", "los", "el"];

/** Trims legal suffixes so "Banco Inbursa, S.A., Instituci\u00F3n de Banca M\u00FAltiple" fits a tile. */
export function shortIssuer(name) {
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

export function bankInitials(name) {
  const parts = String(name || "?").replace(/\(.*?\)/g, "").trim()
                  .split(/[\s\-]+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.length > 1 && parts[0].length <= 3
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}

/* -------------------------------- icons --------------------------------- */

export const ICONS = {
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
  other: ["M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16","M12 12h.01"]};

export const catIcon = (key) => (ICONS[key] ? key : "other");
