/* ===========================================================================
   Norte — estado de la sesión
   ---------------------------------------------------------------------------
   Aquí vive lo único que cambia mientras la app corre: qué productos tiene el
   usuario y qué movimientos ha registrado. Las tablas de mercado no se tocan.

   Esto existe por una razón que va más allá de agregar y quitar tarjetas. Es
   el punto exacto donde va a entrar auth. Hoy el userId es una constante y los
   productos arrancan de una cartera de demostración; mañana el userId sale de
   la sesión de Supabase y los productos de una consulta con row level
   security. Ninguna pantalla se entera, porque ninguna pantalla asume quién
   está firmado: todas piden userId al hook.

   Esa disciplina es lo que permite construir pantallas antes de tener login
   sin acumular deuda.
   =========================================================================== */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { INITIAL_MOVEMENTS, INITIAL_PRODUCTS, MARKET, USER_ID } from './data';

type Ctx = {
  db: any;
  userId: string;
  isHeld: (kind: 'card' | 'account', id: string) => boolean;
  addProduct: (kind: 'card' | 'account', id: string) => void;
  removeProduct: (kind: 'card' | 'account', id: string) => void;
  setBalance: (accountId: string, balance: number) => void;
  logMovement: (m: LoggedMovement) => void;
};

/* Lo que la app registra cuando el usuario dice que sí tomó el consejo. El
   beneficio se guarda calculado, no se recalcula al leer: las tasas cambian, y
   un historial que se recalcula reescribe el pasado cada vez que un emisor
   mueve un número. */
export type LoggedMovement = {
  flow: 'cc' | 'debit';
  direction?: 'in' | 'out';
  merchant_category?: string;
  amount: number;
  productId: string;
  benefit: number;
};

const NorteContext = createContext<Ctx | null>(null);

let seq = 0;
const nextId = () => `up_${Date.now().toString(36)}_${seq++}`;

export function NorteProvider({ children }: { children: ReactNode }) {
  const [userProducts, setUserProducts] = useState<any[]>(INITIAL_PRODUCTS);
  const [movements, setMovements] = useState<any[]>(INITIAL_MOVEMENTS);

  const db = useMemo(() => ({
    ...MARKET,
    userProducts,
    movements,
    userFlags: { [USER_ID]: { payroll: false, memberships: [] } },
  }), [userProducts, movements]);

  const value = useMemo<Ctx>(() => ({
    db,
    userId: USER_ID,

    isHeld: (kind, id) =>
      userProducts.some((p) => p.product_type === kind && p.product_id === id),

    addProduct: (kind, id) =>
      setUserProducts((prev) => {
        if (prev.some((p) => p.product_type === kind && p.product_id === id)) return prev;
        return [...prev, {
          id: nextId(), user_id: USER_ID, product_type: kind, product_id: id,
          // Una cuenta nueva entra en cero. Inventarle un saldo sería inventar
          // un rendimiento, y el usuario lo leería como un dato suyo.
          current_balance: kind === 'account' ? '0' : '',
          membership_tier: '', payroll_deposited: false, notes: '',
        }];
      }),

    removeProduct: (kind, id) =>
      setUserProducts((prev) =>
        prev.filter((p) => !(p.product_type === kind && p.product_id === id))),

    /* Registrar es lo que convierte a Norte en algo que sabe lo que has hecho
       y no solo lo que podrías hacer. Además alimenta los topes del mes y las
       condiciones de los boosts, así que la siguiente recomendación ya toma en
       cuenta esta. */
    logMovement: (m) =>
      setMovements((prev) => [...prev, {
        movement_id: nextId(),
        user_id: USER_ID,
        timestamp: new Date().toISOString(),
        flow: m.flow,
        direction: m.direction || '',
        merchant_category: m.merchant_category || '',
        amount: String(m.amount),
        recommended_product_id: m.productId,
        computed_benefit_mxn: String(m.benefit),
        notes: '',
      }]),

    setBalance: (accountId, balance) =>
      setUserProducts((prev) => prev.map((p) =>
        p.product_type === 'account' && p.product_id === accountId
          ? { ...p, current_balance: String(Math.max(0, balance)) }
          : p)),
  }), [db, userProducts]);

  return <NorteContext.Provider value={value}>{children}</NorteContext.Provider>;
}

export function useNorte() {
  const ctx = useContext(NorteContext);
  if (!ctx) throw new Error('useNorte fuera de NorteProvider');
  return ctx;
}
