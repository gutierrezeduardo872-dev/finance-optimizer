/* ===========================================================================
   Norte — app shell
   ---------------------------------------------------------------------------
   Loaded last. Plain script, shared scope — see SETUP.md.

   Holds the API layer, the optimistic write queue, session handling, routing
   and the root render. Migration notes are marked MIGRATED.
   =========================================================================== */

/* -------------------------------- network ------------------------------- */

async function apiGet(params) {
  const r = await fetch(API + '?' + new URLSearchParams(params).toString());
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function apiPost(body) {
  // text/plain avoids a CORS preflight, which Apps Script does not answer.
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/**
 * Writes are applied to local state immediately and sent one at a time in the
 * background. Serialising matters: the Sheet is edited by row lookup, so two
 * concurrent writes can race on the same row.
 *
 * A failure surfaces as a toast; the optimistic state is NOT rolled back,
 * because the next refresh reconciles from the server anyway.
 */
const writeQueue = (() => {
  let chain = Promise.resolve();
  let pending = 0;
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn(pending));
  return {
    push(body, onError) {
      pending++; notify();
      chain = chain.then(async () => {
        try {
          const r = await apiPost(body);
          if (!r || r.ok === false) throw new Error((r && r.error) || 'rechazado');
        } catch (e) {
          if (onError) onError(e);
        } finally {
          pending--; notify();
        }
      });
      return chain;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();

/* ------------------------------ local cache ----------------------------- */

// MIGRATED: termTiers and conditionalBoosts are new tables. Missing them here
// would leave every boost invisible until a full refresh landed.
const EMPTY_DB = {
  issuers: [], cards: [], cardRewards: [], cardPerks: [], accounts: [],
  yieldTiers: [], termTiers: [], conditionalBoosts: [], categories: [],
  // fxRates and referenceRates arrive from the backend as single-purpose
  // reference tables: the USD/MXN FIX, and the CETES/TIIE rates that
  // index-linked accounts resolve against. Absent from this list they would
  // be silently dropped on merge and every indexed account would read 0%.
  fxRates: [], referenceRates: [],
  users: [], userProducts: [], movements: [],
};

const MARKET_KEYS = ['issuers', 'cards', 'cardRewards', 'cardPerks', 'accounts',
                     'yieldTiers', 'termTiers', 'conditionalBoosts', 'categories',
                     'fxRates', 'referenceRates'];
const USER_KEYS = ['users', 'userProducts', 'movements'];

const pick = (obj, keys) => keys.reduce((acc, k) => { acc[k] = obj[k] || []; return acc; }, {});

/* -------------------------------- routing ------------------------------- */

const TABS = [
  ['home', 'Inicio', 'home'],
  ['cc', 'Tarjetas', 'card'],
  ['save', 'Ahorro', 'savings'],
  ['picks', 'Sugerencias', 'spark'],
  ['products', 'Productos', 'grid'],
];
const MAIN = TABS.map((t) => t[0]);
const SUBVIEWS = { history: 'Historial', profile: 'Perfil', admin: 'Admin' };
const TITLES = {
  home: 'Norte', cc: 'Asesor de tarjetas', save: 'Asesor de ahorro',
  picks: 'Sugerencias', products: 'Productos', ...SUBVIEWS,
};

/* ---------------------------------- app --------------------------------- */

function App() {
  const [session, setSession] = useState(() => LS.get(K_SESSION));
  const [db, setDb] = useState(() => {
    const market = LS.get(K_MARKET);
    const user = LS.get(K_USER);
    return market && user ? { ...EMPTY_DB, ...market.data, ...user.data } : null;
  });
  const [view, setView] = useState('home');
  const [lastMainView, setLastMainView] = useState('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState(null);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [lastSync, setLastSync] = useState(() => {
    const m = LS.get(K_MARKET);
    return m ? m.at : null;
  });
  const scroller = useRef(null);

  // Live snapshot for listeners registered once (see the popstate effect).
  const navRef = useRef({ view, lastMainView, menuOpen });
  navRef.current = { view, lastMainView, menuOpen };

  useEffect(() => writeQueue.subscribe(setPendingWrites), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const ok = (text) => setToast({ text });
  const bad = (text) => setToast({ text, bad: true });

  const cache = (next) => {
    LS.set(K_MARKET, { at: Date.now(), data: pick(next, MARKET_KEYS) });
    LS.set(K_USER, { at: Date.now(), data: pick(next, USER_KEYS) });
  };

  const refresh = useCallback(async () => {
    if (!session) return;
    setSyncing(true);
    try {
      const r = await apiGet(session.token
        ? { action: 'bootstrap', user_id: session.user_id, token: session.token }
        : { action: 'bootstrap', user_id: session.user_id });
      if (r.ok) {
        const next = { ...EMPTY_DB, ...r.data };
        setDb(next);
        cache(next);
        setLastSync(Date.now());
        setLoadError('');
      } else {
        setLoadError(r.error || 'No se pudieron cargar los datos');
      }
    } catch {
      setLoadError('Sin conexión con el servidor');
    }
    setSyncing(false);
  }, [session]);

  useEffect(() => { if (session) refresh(); }, [session, refresh]);

  /** Apply a local change and persist the cache in one step. */
  const apply = (fn) => setDb((prev) => {
    if (!prev) return prev;
    const next = fn(prev);
    cache(next);
    return next;
  });

  const logMovement = (m) => {
    const row = {
      movement_id: uid('mv'),
      user_id: session.user_id,
      timestamp: new Date().toISOString(),
      flow: m.flow,
      direction: m.direction || '',
      merchant_category: m.merchant_category || '',
      amount: m.amount,
      recommended_product_id: m.recommended_product_id,
      computed_benefit_mxn: m.computed_benefit_mxn,
      // MIGRATED: reward is stored apart from total benefit. Monthly caps apply
      // to reward only — perk value is not capped — so logging them combined
      // made caps read as more consumed than they were.
      computed_reward_mxn: m.computed_reward_mxn != null
        ? m.computed_reward_mxn : m.computed_benefit_mxn,
      notes: 'registrado desde la app',
    };
    apply((prev) => ({ ...prev, movements: [...prev.movements, row] }));
    writeQueue.push({ action: 'logMovement', ...row },
                    () => bad('No se pudo guardar el movimiento'));
    ok('Movimiento registrado');
  };

  const deleteMovement = (id) => {
    apply((prev) => ({
      ...prev, movements: prev.movements.filter((m) => m.movement_id !== id),
    }));
    writeQueue.push({ action: 'deleteMovement', movement_id: id },
                    () => bad('No se pudo eliminar'));
    ok('Movimiento eliminado');
  };

  const addProduct = (kind, productId) => {
    const row = {
      id: uid('up'),
      user_id: session.user_id,
      product_type: kind,
      product_id: productId,
      current_balance: kind === 'account' ? 0 : '',
      // MIGRATED: per-account flags for boost conditions. Empty is not FALSE —
      // it means never asked, which the UI should treat as a prompt.
      payroll_deposited: '',
      membership_tier: '',
      flag_confirmed_on: '',
      notes: '',
    };
    apply((prev) => ({ ...prev, userProducts: [...prev.userProducts, row] }));
    writeQueue.push({ action: 'addUserProduct', ...row },
                    () => bad('No se pudo agregar'));
    ok(kind === 'card' ? 'Tarjeta agregada' : 'Cuenta agregada');
  };

  const removeProduct = (kind, productId) => {
    const row = db.userProducts.find(
      (p) => p.user_id === session.user_id && p.product_type === kind &&
             p.product_id === productId);
    if (!row) return;
    apply((prev) => ({
      ...prev, userProducts: prev.userProducts.filter((p) => p.id !== row.id),
    }));
    writeQueue.push({ action: 'removeUserProduct', id: row.id },
                    () => bad('No se pudo quitar'));
    ok(kind === 'card' ? 'Tarjeta quitada' : 'Cuenta quitada');
  };

  const setBalance = (upId, value) => {
    apply((prev) => ({
      ...prev,
      userProducts: prev.userProducts.map(
        (p) => (p.id === upId ? { ...p, current_balance: value } : p)),
    }));
    writeQueue.push({ action: 'updateUserProduct', id: upId, current_balance: value },
                    () => bad('No se pudo actualizar el saldo'));
    ok('Saldo actualizado');
  };

  /**
   * Confirm or clear a flag the engine cannot observe: a paid membership tier,
   * or payroll landing in this account. Both gate real boosts — Nu's Cajita
   * Turbo at 13% and Ualá's payroll rate — and until now nothing in the app
   * could set them, so those boosts could never apply to anyone.
   */
  const setProductFlag = (upId, field, value) => {
    apply((prev) => ({
      ...prev,
      userProducts: prev.userProducts.map(
        (p) => (p.id === upId
          ? { ...p, [field]: value,
              flag_confirmed_on: new Date().toISOString().slice(0, 10) }
          : p)),
    }));
    writeQueue.push({ action: 'updateUserProduct', id: upId, [field]: value },
                    () => bad('No se pudo actualizar'));
    ok(value ? 'Beneficio confirmado' : 'Beneficio quitado');
  };

  const saveName = (name) => {
    apply((prev) => ({
      ...prev,
      users: prev.users.map((u) => (u.user_id === session.user_id ? { ...u, name } : u)),
    }));
    setSession((prev) => {
      const next = { ...prev, name };
      LS.set(K_SESSION, next);
      return next;
    });
    writeQueue.push({ action: 'updateUser', user_id: session.user_id, name },
                    () => bad('No se pudo guardar el nombre'));
    ok('Nombre actualizado');
  };

  const go = (next) => {
    // Remember which tab we came from, so leaving a subview returns there.
    if (MAIN.indexOf(next) < 0 && MAIN.indexOf(view) >= 0) setLastMainView(view);
    setView(next);
    setMenuOpen(false);
    if (scroller.current) scroller.current.scrollTop = 0;
    window.scrollTo(0, 0);
    // Routing used to be React state alone, so Android's back gesture left
    // Norte entirely instead of leaving the screen. Each navigation now pushes
    // a history entry; the popstate handler below turns back into "go up one".
    if (typeof next === 'string' && next !== view) {
      try { history.pushState({ view: next }, '', '#' + next); } catch (e) {}
    }
  };

  /**
   * Back means the nearest enclosing thing: close the menu if it is open,
   * otherwise leave a subview for the tab it was opened from, otherwise follow
   * the history entry. Only at Inicio does back leave the app.
   *
   * The listener is registered once, so it reads live state through a ref
   * instead of closing over the values it saw at mount.
   */
  useEffect(() => {
    try { history.replaceState({ view: 'home' }, '', '#home'); } catch (e) {}
    const onPop = (e) => {
      const st = navRef.current;
      if (st.menuOpen) { setMenuOpen(false); return; }
      setView(SUBVIEWS[st.view] ? st.lastMainView : ((e.state && e.state.view) || 'home'));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const signOut = () => {
    LS.del(K_SESSION); LS.del(K_USER);
    setSession(null);
    setView('home');
  };

  /**
   * AUTH: the login screen now returns the whole auth result, not a bare user
   * row. The token is what scopes every later bootstrap to this account.
   * Accepts the old shape too, so a session cached before this deploy still
   * works instead of bouncing the user to the login screen.
   */
  const onLogin = (res) => {
    const u = res && res.user ? res.user : res;
    const s = {
      user_id: u.user_id,
      name: u.name,
      first_name: u.first_name || '',
      last_name: u.last_name || '',
      email: u.email || '',
      is_admin: u.is_admin,
      token: (res && res.token) || null,
    };
    LS.set(K_SESSION, s);
    LS.set(ONB_SEEN_KEY, true);   // this device has signed in before
    setSession(s);
    setView('home');
  };

  if (!session) {
    return <Entry onLogin={onLogin} />;
  }

  if (!db) {
    return (
      <div className="app">
        <div className="topbar">
          <span className="brand"><Logo size={20} plain /> Norte</span>
        </div>
        <div className="screen">
          {loadError
            ? <Empty icon="alert" title="No se pudieron cargar los datos"
                     cta={<button className="btn" onClick={refresh}>Reintentar</button>}>
                {loadError}
              </Empty>
            : <div className="loading"><span className="spin dark" /> Cargando…</div>}
        </div>
      </div>
    );
  }

  const isSub = !!SUBVIEWS[view];
  const syncLabel = lastSync
    ? new Date(lastSync).toLocaleTimeString('es-MX',
        { hour: '2-digit', minute: '2-digit' })
    : null;

  const screen = () => {
    switch (view) {
      case 'home':
        return <Home d={db} user={session} go={go} />;
      case 'cc':
        return <CardAdvisor d={db} user={session} logMovement={logMovement} go={go} />;
      case 'save':
        return <SavingsAdvisor d={db} user={session} logMovement={logMovement}
                               setBalance={setBalance} setProductFlag={setProductFlag} go={go} />;
      case 'picks':
        return <Suggestions d={db} user={session} addProduct={addProduct} go={go} />;
      case 'products':
        return <Products d={db} user={session} addProduct={addProduct}
                         removeProduct={removeProduct} />;
      case 'history':
        return <History d={db} user={session} deleteMovement={deleteMovement} />;
      case 'profile':
        return <Profile d={db} user={session} onSignOut={signOut} onSwitch={signOut}
                        saveName={saveName} go={go} />;
      case 'admin':
        // Route-level guard. Reaching #admin by hand should not render it.
        return session.is_admin === true
          ? <Admin d={db} user={session} />
          : <Empty icon="shield" title="Sólo para administradores">
              Esta sección no está disponible en tu cuenta.
            </Empty>;
      default:
        return null;
    }
  };

  return (
    <div className="app">
      <div className="topbar">
        {isSub
          ? <button className="icon-btn" onClick={() => go(lastMainView)} aria-label="Atrás">
              <Ico n="left" s={18} />
            </button>
          : <span className="brand"><Logo size={20} plain /> Norte</span>}
        <span className="topbar-t">{TITLES[view]}</span>
        <div className="topbar-r">
          {(syncing || pendingWrites > 0) && <span className="spin dark small" />}
          <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Menú">
            <Ico n="more" s={18} />
          </button>
        </div>
      </div>

      {loadError && (
        <div className="banner">
          <Ico n="alert" s={15} /> {loadError}
          <button className="link" onClick={refresh}>Reintentar</button>
        </div>
      )}

      <div className="screen" ref={scroller}>{screen()}</div>

      <nav className="tabbar">
        {TABS.map(([key, label, icon]) => (
          <button key={key} className={'tabb' + (view === key ? ' on' : '')}
                  onClick={() => go(key)}>
            <Ico n={icon} s={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <Menu open={menuOpen} onClose={() => setMenuOpen(false)} d={db} user={session}
            go={go} onRefresh={refresh} syncing={syncing} lastSync={syncLabel}
            onSignOut={signOut} />

      <Toast msg={toast} />
    </div>
  );
}

/**
 * Without this, any render error unmounts the tree and the user sees a black
 * screen with no information — which is how two bugs shipped today and had to
 * be diagnosed by guesswork. React deliberately blanks the UI on an uncaught
 * error; the boundary catches it and shows what actually broke.
 */
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null, info: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    this.setState({ info });
    try { console.error('Norte render error:', err, info); } catch (e) {}
  }
  render() {
    if (!this.state.err) return this.props.children;
    const stack = String((this.state.info && this.state.info.componentStack) || '')
      .split('\n').filter(Boolean).slice(0, 6).join('\n');
    const text = String(this.state.err && this.state.err.message || this.state.err) +
                 '\n' + stack;
    return (
      <div style={{ padding: 20, fontFamily: 'Inter,system-ui,sans-serif',
                    color: '#1C2431', maxWidth: 640, margin: '0 auto' }}>
        <h2 style={{ fontFamily: '"Space Grotesk",sans-serif', color: '#B85F35' }}>
          Algo se rompió en esta pantalla
        </h2>
        <p style={{ lineHeight: 1.5 }}>
          El resto de la app sigue funcionando. Copia este detalle y compártelo —
          dice exactamente qué falló.
        </p>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      background: '#f4f2ef', padding: 12, borderRadius: 10,
                      fontSize: 12, lineHeight: 1.45 }}>{text}</pre>
        <button onClick={() => { try { navigator.clipboard.writeText(text); } catch (e) {} }}
                style={{ padding: '10px 16px', borderRadius: 10, border: 0,
                         background: '#0F7365', color: '#fff', fontWeight: 600,
                         marginRight: 8 }}>
          Copiar detalle
        </button>
        <button onClick={() => this.setState({ err: null, info: null })}
                style={{ padding: '10px 16px', borderRadius: 10,
                         border: '1px solid #d8d3cc', background: '#fff' }}>
          Reintentar
        </button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root'))
  .render(<ErrorBoundary><App /></ErrorBoundary>);
