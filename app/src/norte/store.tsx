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
};

const NorteContext = createContext<Ctx | null>(null);

let seq = 0;
const nextId = () => `up_${Date.now().toString(36)}_${seq++}`;

export function NorteProvider({ children }: { children: ReactNode }) {
  const [userProducts, setUserProducts] = useState<any[]>(INITIAL_PRODUCTS);
  const [movements] = useState<any[]>(INITIAL_MOVEMENTS);

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
