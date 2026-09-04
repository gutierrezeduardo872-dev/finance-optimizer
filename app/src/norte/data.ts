/* ===========================================================================
   Norte — los datos que ve el motor
   ---------------------------------------------------------------------------
   Por ahora el conjunto de datos viaja dentro del bundle, leído de
   data/market/ igual que la web. Todavía no pasa por Supabase a propósito:
   esta primera pantalla existe para probar que el motor corre en el teléfono,
   y meter red y auth en el mismo paso haría imposible saber qué falló si algo
   falla.

   El usuario de demostración es EL MISMO fixture que usa tools/golden.mjs:
   las seis primeras tarjetas mapeadas por orden de id, con los mismos
   movimientos del mes. Eso no es casualidad. Significa que los números que
   salgan en el teléfono se pueden comparar contra tools/golden.json, y si no
   coinciden, el puerto está mal.
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

const mapped = (rows: any[], key: string, n: number) =>
  rows.filter((r) => String(r.mapping_status).toLowerCase() === 'mapped')
      .map((r) => r[key])
      .sort()
      .slice(0, n);

const heldCardIds = mapped(cards as any[], 'card_id', 6);
const heldAccountIds = mapped(accounts as any[], 'account_id', 5);

const month = new Date().toISOString().slice(0, 7);

export const db: any = {
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

  users: [{ user_id: USER_ID, name: 'Fixture', risk_score: '700', pin: '', is_admin: '', notes: '' }],

  userProducts: [
    ...heldCardIds.map((id, i) => ({
      id: `up_c${i}`, user_id: USER_ID, product_type: 'card', product_id: id,
      current_balance: '', notes: '',
    })),
    ...heldAccountIds.map((id, i) => ({
      id: `up_a${i}`, user_id: USER_ID, product_type: 'account', product_id: id,
      current_balance: String(10000 * (i + 1)), notes: '',
    })),
  ],

  // Sin movimientos el gasto del mes es cero y ningún tope se ejercita nunca,
  // así que la prueba no probaría la mitad interesante del motor.
  movements: heldCardIds.flatMap((id, i) => ([
    { movement_id: `mv_${i}a`, user_id: USER_ID, timestamp: `${month}-05T12:00:00.000Z`,
      flow: 'cc', direction: '', merchant_category: 'supermarket',
      amount: String(1500 + i * 400), recommended_product_id: id,
      computed_benefit_mxn: '0', notes: '' },
    { movement_id: `mv_${i}b`, user_id: USER_ID, timestamp: `${month}-12T12:00:00.000Z`,
      flow: 'cc', direction: '', merchant_category: 'restaurant',
      amount: String(800 + i * 250), recommended_product_id: id,
      computed_benefit_mxn: '0', notes: '' },
  ])),

  userFlags: { [USER_ID]: { payroll: false, memberships: [] } },
};

export const CATEGORIES = db.categories as { category_key: string; display_label: string }[];

/* shortIssuer() recorta el nombre legal ("Banco Inbursa, S.A., Institución de
   Banca Múltiple" no cabe en una tarjeta), pero recibe el nombre, no el id.
   Esta es la búsqueda que falta. */
const issuersById: Record<string, any> = Object.fromEntries(
  (issuers as any[]).map((i) => [i.issuer_id, i]),
);

export const issuerName = (issuerId: string) =>
  issuersById[issuerId]?.display_name || issuerId;
