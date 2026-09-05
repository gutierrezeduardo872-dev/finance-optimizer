/* ===========================================================================
   Norte — los datos que ve el motor
   ---------------------------------------------------------------------------
   El conjunto de datos viaja dentro del bundle, leído de data/market/ igual
   que la web. Todavía no pasa por Supabase a propósito: las tablas de mercado
   son legibles solo para usuarios firmados, y auth aún no existe.

   LA CARTERA DE DEMOSTRACIÓN NO ES ARBITRARIA. Está elegida para que cada
   camino del motor se ejercite al menos una vez, porque un demo que solo
   recorre el caso feliz no prueba nada:

     · tasa plana, por tramos, e indexada
     · boost cumplido (Mercado Pago, con el depósito del mes ya hecho)
     · boost sin cumplir (Ualá y Nu, que es cuando la app tiene algo útil
       que decir: "gasta $1,000 más y tu tasa sube a 12%")
     · las tres coberturas: IPAB, PROSOFIPO y ninguna
     · topes de recompensa compartidos entre categorías (Santander LikeU
       reparte un solo tope de $500 entre farmacia, restaurantes y telecom)
     · una cuenta de banco tradicional al 2.7% junto a fintechs al 13%,
       que es el argumento entero del producto puesto en una pantalla

   La cartera anterior eran las primeras seis tarjetas por orden alfabético,
   elegidas para poder comparar contra tools/golden.json y probar que el motor
   cruzó a nativo sin moverse. Eso ya se comprobó, así que ese criterio dejó
   de aplicar. El golden sigue cuidando el motor por su cuenta.
   =========================================================================== */

import issuers from '@market/issuers.json';
import cards from '@market/cards.json';
import cardRewards from '@market/card_rewards.json';
import accounts from '@market/accounts.json';
import yieldTiers from '@market/yield_tiers.json';
import termTiers from '@market/term_tiers.json';
import conditionalBoosts from '@market/conditional_boosts.json';
import categories from '@market/categories.json';
import fxRates from '@market/fx_rates.json';
import referenceRates from '@market/reference_rates.json';

export const USER_ID = 'u1';

const byId = (rows: any[], key: string) =>
  [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));

/* --- la cartera ---------------------------------------------------------- */

const HELD_CARDS = [
  'hsbc_mexico__hsbc_2now',              // 2% en todo, sin anualidad, tope $42,500 de gasto
  'santander_mexico__likeu',             // 6% farmacia, 5% restaurantes, 4% telecom, tope $500 COMPARTIDO
  'uala_mx__tarjeta_de_credito_uala',    // 10% supermercado, tope $500. Es la ligada al boost de Ualá
  'citibanamex__costco_banamex',         // 5% gasolina, 4% educación, 3% super, 2% restaurantes
  'klar__tarjeta_de_credito_klar',       // 3% en todo lo demás
  'bbva_mexico__oro_bbva',               // 1.1% en puntos, $748 al año. La que ya traías del banco
];

const HELD_ACCOUNTS: [string, number][] = [
  ['nu_mx__cajita_nu', 40000],                                  // 6.5%, IPAB, sube a 13% con nivel
  ['uala_mx__cuenta_con_rendimiento_uala', 25000],              // por tramos, IPAB, 12% gastando $3,000
  ['mercado_pago__cuenta_mercado_pago_rendimientos', 20000],    // por tramos, SIN SEGURO, 13% ya cumplido
  ['klar__cuenta_klar_saldo_disponible', 8000],                 // 3%, PROSOFIPO
  ['bbva_mexico__meta_ahorro_bbva', 60000],                     // 2.7%, IPAB. El banco de siempre
];

const month = new Date().toISOString().slice(0, 7);

/* Los movimientos del mes deciden dos cosas: cuánto tope de recompensa queda
   y qué boosts están cumplidos. Sin ellos la mitad del motor no se ejecuta.

   El gasto en Ualá queda deliberadamente en $2,000, por debajo de los $3,000
   que pide su boost, para que la pantalla tenga algo que recomendar en vez de
   solo felicitar. El depósito a Mercado Pago sí cumple los $3,000, así que ese
   boost está activo y la cuenta paga 13% de verdad. */
const movements = [
  { movement_id: 'mv_1', flow: 'cc', direction: '', merchant_category: 'supermarket',
    amount: '2000', product: 'uala_mx__tarjeta_de_credito_uala', day: '04' },
  { movement_id: 'mv_2', flow: 'cc', direction: '', merchant_category: 'restaurant',
    amount: '1850', product: 'santander_mexico__likeu', day: '07' },
  { movement_id: 'mv_3', flow: 'cc', direction: '', merchant_category: 'pharmacy',
    amount: '640', product: 'santander_mexico__likeu', day: '11' },
  { movement_id: 'mv_4', flow: 'cc', direction: '', merchant_category: 'gas',
    amount: '1400', product: 'citibanamex__costco_banamex', day: '09' },
  { movement_id: 'mv_5', flow: 'cc', direction: '', merchant_category: 'online',
    amount: '3200', product: 'hsbc_mexico__hsbc_2now', day: '12' },
  { movement_id: 'mv_6', flow: 'debit', direction: 'in', merchant_category: '',
    amount: '3500', product: 'mercado_pago__cuenta_mercado_pago_rendimientos', day: '02' },
].map((m) => ({
  movement_id: m.movement_id,
  user_id: USER_ID,
  timestamp: `${month}-${m.day}T12:00:00.000Z`,
  flow: m.flow,
  direction: m.direction,
  merchant_category: m.merchant_category,
  amount: m.amount,
  recommended_product_id: m.product,
  computed_benefit_mxn: '0',
  notes: '',
}));

/* Las tablas de mercado son inmutables: vienen del repo y nadie las edita en
   la app. Lo que sí cambia es qué productos tiene el usuario, y eso vive en
   store.tsx, no aquí. */
export const MARKET: any = {
  issuers: byId(issuers as any[], 'issuer_id'),
  cards: byId(cards as any[], 'card_id'),
  cardRewards: byId(cardRewards as any[], 'reward_id'),
  cardPerks: [],
  accounts: byId(accounts as any[], 'account_id'),
  yieldTiers: byId(yieldTiers as any[], 'tier_id'),
  termTiers: byId(termTiers as any[], 'term_id'),
  conditionalBoosts: byId(conditionalBoosts as any[], 'boost_id'),
  categories: byId(categories as any[], 'category_key'),
  fxRates: fxRates as any[],
  referenceRates: referenceRates as any[],

  users: [{ user_id: USER_ID, name: 'Demo', risk_score: '720', pin: '', is_admin: '', notes: '' }],
};

export const INITIAL_PRODUCTS: any[] = [
    ...HELD_CARDS.map((id, i) => ({
    id: `up_c${i}`, user_id: USER_ID, product_type: 'card', product_id: id,
    current_balance: '', notes: '',
  })),
    ...HELD_ACCOUNTS.map(([id, balance], i) => ({
      id: `up_a${i}`, user_id: USER_ID, product_type: 'account', product_id: id,
      current_balance: String(balance),
      // Ningún nivel de membresía ni nómina domiciliada, a propósito: así los
      // boosts que dependen de eso aparecen como oportunidad y no como hecho.
      membership_tier: '', payroll_deposited: false,
      notes: '',
    })),
];

export const INITIAL_MOVEMENTS = movements;

export const CATEGORIES = MARKET.categories as { category_key: string; display_label: string }[];

/* shortIssuer() recorta el nombre legal ("Banco Inbursa, S.A., Institución de
   Banca Múltiple" no cabe en una tarjeta), pero recibe el nombre, no el id.
   Esta es la búsqueda que falta. */
const issuersById: Record<string, any> = Object.fromEntries(
  (issuers as any[]).map((i) => [i.issuer_id, i]),
);

export const issuerName = (issuerId: string) =>
  issuersById[issuerId]?.display_name || issuerId;
