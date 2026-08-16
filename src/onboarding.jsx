/* ===========================================================================
   Norte — welcome and onboarding (S0, A1–A13)
   ---------------------------------------------------------------------------
   Loaded after auth.jsx, before app.jsx. Plain script, shared scope.

   Order of the flow, and why:

     S0   Welcome. Two buttons, no fields.
     A1-3 What Norte does. BEFORE the signup form, not after — the objection
          in a Mexican finance app that asks you to type your cards in by hand
          is "why do you need this", and A3 answers it before A4 asks.
     A4   Email or Google. Google skips A5 entirely: name and email come from
          the verified token.
     A5   Name, surname, password.
     A7-9 Preferences. Saved now, read by the engine later. Only questions
          whose answers map to a real parameter.
     A10-12 Products. The highest-drop-off part of the flow, so: multi-select,
          skippable, detail deferred.
     A13  Done.

   A6 (email verification) is deliberately absent. The backend cannot send
   mail yet, and a code screen that verifies nothing is worse than no screen.

   The account is created at A4/A5, not at A13. Everything after needs a token
   to write against, and a half-finished onboarding leaves a usable account
   rather than nothing.
   =========================================================================== */

const ONB_SEEN_KEY = 'norte.seen.v1';

/* ------------------------------ scaffolding ------------------------------ */

function Step({ onBack, onSkip, progress, children, footer }) {
  return (
    <div className="onb">
      <div className="onb-top">
        {onBack
          ? <button className="onb-back" onClick={onBack} aria-label="Atrás">
              <Ico n="right" s={20} style={{ transform: 'rotate(180deg)' }} />
            </button>
          : <span />}
        {onSkip
          ? <button className="link" onClick={onSkip}>Saltar</button>
          : <span />}
      </div>
      {progress && (
        <div className="onb-prog">
          {progress.map((on, i) => <i key={i} className={on ? 'on' : ''} />)}
        </div>
      )}
      <div className="onb-body">{children}</div>
      {footer && <div className="onb-foot">{footer}</div>}
    </div>
  );
}

function Choice({ selected, onSelect, title, desc, tag, multi }) {
  return (
    <button className={'opt' + (selected ? ' sel' : '')} onClick={onSelect}>
      <span className={(multi ? 'chk' : 'radio') + (selected ? ' on' : '')} />
      <span className="opt-t">
        <span className="opt-title">{title}{tag && <span className="tag-pill">{tag}</span>}</span>
        {desc && <span className="opt-desc">{desc}</span>}
      </span>
    </button>
  );
}

/* ------------------------------ S0 welcome ------------------------------- */

function Welcome({ onCreate, onLogin }) {
  return (
    <div className="onb">
      <div className="onb-hero">
        <Logo size={72} />
        <h1 className="hero-brand">Norte</h1>
        <p className="hero-tag">Tu norte financiero</p>
        <p className="hero-sub">
          Qué tarjeta usar y dónde guardar tu dinero. Sin adivinar.
        </p>
      </div>
      <div className="onb-foot">
        <button className="btn" onClick={onCreate}>Crear cuenta</button>
        <div style={{ height: 10 }} />
        <button className="btn ghost" onClick={onLogin}>Ya tengo cuenta</button>
        <div className="note center">
          Norte es informativo. No movemos tu dinero ni pedimos claves de banca en línea.
        </div>
      </div>
    </div>
  );
}

/* --------------------------- A1–A3 value slides -------------------------- */

function ValueSlides({ step, onNext, onBack, onSkip }) {
  const prog = [step >= 0, step >= 1, step >= 2];

  const slides = [
    {
      h: '¿Con cuál tarjeta pago?',
      p: 'Dinos dónde estás comprando y cuánto. Norte revisa tus tarjetas y te dice cuál te deja más dinero.',
      body: (
        <div className="demo-win">
          <div className="demo-eyebrow">Usa esta</div>
          <div className="demo-pick">Tu mejor tarjeta</div>
          <div className="demo-meta">Supermercado · $1,850</div>
          <div className="demo-big">+$92.50</div>
          <div className="demo-bd">
            <div><span>5% en supermercado</span><span className="num">$92.50</span></div>
            <div><span>1% general</span><span className="num dim">$18.50</span></div>
            {/* The unvaluable bucket is visible from the very first screen:
                promising honesty about points and then hiding them would be
                the wrong order. */}
            <div><span>Otra tarjeta</span><span className="dim">sin valor publicado</span></div>
          </div>
        </div>
      ),
    },
    {
      h: '¿Dónde dejo mi dinero?',
      p: 'Comparamos el rendimiento real de tus cuentas, ya con comisiones descontadas, y te decimos dónde conviene depositar.',
      body: (
        <div>
          <div className="demo-row">
            <span><b>Cuenta A</b><br /><span className="dim">Neto de comisiones · IPAB</span></span>
            <span className="num demo-rate">14.5%</span>
          </div>
          <div className="demo-row">
            <span><b>Cuenta B</b><br /><span className="dim">Neto de comisiones · IPAB</span></span>
            <span className="num dim">3.2%</span>
          </div>
          <div className="demo-note">Mover <b>$40,000</b> te daría <b>+$4,520</b> al año.</div>
        </div>
      ),
    },
    {
      h: 'Tú tienes el control',
      p: 'Norte no se conecta a tus bancos. Tú registras tus productos, nosotros hacemos las cuentas.',
      body: (
        <div>
          {[
            ['Nunca pedimos claves de banca en línea', 'Ni usuario, ni contraseña, ni token de tu banco.'],
            ['Nunca movemos tu dinero', 'Te decimos qué conviene; tú decides y ejecutas.'],
            ['Borras tus datos cuando quieras', 'Desde Perfil, en un paso.'],
          ].map(([t, d]) => (
            <div className="promise" key={t}>
              <Ico n="check" s={18} />
              <span><b>{t}</b><br /><span className="dim">{d}</span></span>
            </div>
          ))}
          <div className="note">
            Estamos en fase de pruebas: revisa siempre las condiciones con tu banco antes de decidir.
          </div>
        </div>
      ),
    },
  ];

  const s = slides[step];
  return (
    <Step onBack={onBack} onSkip={onSkip} progress={prog}
          footer={<button className="btn" onClick={onNext}>
                    {step === 2 ? 'Crear mi cuenta' : 'Siguiente'}
                  </button>}>
      <h1 className="onb-h">{s.h}</h1>
      <p className="onb-p">{s.p}</p>
      {s.body}
    </Step>
  );
}

/* ----------------------------- A4 sign up -------------------------------- */

function SignUp({ onEmail, onGoogle, onBack, onHasAccount, busy, error, setError }) {
  const [email, setEmail] = useState('');
  const valid = /\S+@\S+\.\S+/.test(email.trim());

  return (
    <Step onBack={onBack}
          footer={
            <div className="note center">
              ¿Ya tienes cuenta?{' '}
              <button className="link" onClick={onHasAccount}>Inicia sesión</button>
            </div>
          }>
      <h1 className="onb-h">Crea tu cuenta</h1>
      <p className="onb-p">Toma menos de dos minutos.</p>

      <GoogleButton onCredential={onGoogle} onError={setError} />
      <div className="divide"><span>o</span></div>

      <label className="fld" htmlFor="su-mail">Correo electrónico</label>
      <input id="su-mail" className="text-in" type="email" inputMode="email"
             autoComplete="email" autoCapitalize="none" autoCorrect="off"
             spellCheck="false" value={email}
             onChange={(e) => { setEmail(e.target.value); setError(''); }}
             onKeyDown={(e) => { if (e.key === 'Enter' && valid) onEmail(email.trim()); }} />

      {error && <div className="err">{error}</div>}

      <div style={{ height: 14 }} />
      <button className="btn" disabled={!valid || busy} onClick={() => onEmail(email.trim())}>
        {busy ? <span className="spin" /> : 'Continuar'}
      </button>
      <div className="note center">
        Al continuar aceptas los Términos y el Aviso de Privacidad.
      </div>
    </Step>
  );
}

/* -------------------------- A5 name and password ------------------------- */

function NameAndPassword({ email, onSubmit, onBack, busy, error }) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);

  const strength = (() => {
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    return s;
  })();
  const ready = first.trim() && pw.length >= 8 && !busy;

  return (
    <Step onBack={onBack}
          footer={<button className="btn" disabled={!ready}
                          onClick={() => onSubmit({ first_name: first.trim(),
                                                    last_name: last.trim(),
                                                    password: pw })}>
                    {busy ? <span className="spin" /> : 'Crear cuenta'}
                  </button>}>
      <h1 className="onb-h">¿Cómo te llamamos?</h1>
      <p className="onb-p">Usamos tu nombre en las recomendaciones. Nada más.</p>

      <label className="fld" htmlFor="su-first">Nombre</label>
      <input id="su-first" className="text-in" autoComplete="given-name"
             value={first} onChange={(e) => setFirst(e.target.value)} />

      <div style={{ height: 12 }} />
      <label className="fld" htmlFor="su-last">Apellido</label>
      <input id="su-last" className="text-in" autoComplete="family-name"
             value={last} onChange={(e) => setLast(e.target.value)} />

      <div style={{ height: 12 }} />
      <label className="fld" htmlFor="su-pw">Contraseña</label>
      <div className="in-wrap">
        <input id="su-pw" className="text-in" type={show ? 'text' : 'password'}
               autoComplete="new-password" value={pw}
               onChange={(e) => setPw(e.target.value)} />
        <button type="button" className="in-act" onClick={() => setShow(!show)}>
          {show ? 'Ocultar' : 'Ver'}
        </button>
      </div>
      <div className="pw-bars">
        {[0, 1, 2, 3].map((i) => <i key={i} className={i < strength ? 'on' : ''} />)}
      </div>
      <div className="note">
        {pw.length === 0 ? 'Mínimo 8 caracteres.'
          : pw.length < 8 ? 'Le faltan ' + (8 - pw.length) + ' caracteres.'
          : strength >= 3 ? 'Buena contraseña.' : 'Agrega un número o un símbolo.'}
      </div>
      <div className="note" style={{ marginTop: 6 }}>Cuenta: {email}</div>
    </Step>
  );
}

/* ---------------------------- A7 objective ------------------------------- */

const MODES = [
  { k: 'max', t: 'Sácale todo el jugo',
    d: 'Siempre te decimos la mejor opción, aunque implique usar varias tarjetas y mover dinero entre cuentas.' },
  { k: 'simple', t: 'Máximo, pero simple', tag: 'Recomendado',
    d: 'Optimizamos con pocos productos. Solo te pedimos cambiar cuando la diferencia realmente vale la pena.' },
  { k: 'learn', t: 'Solo quiero entender',
    d: 'Te mostramos las comparaciones sin empujarte a contratar ni cambiar nada.' },
];

function PrefMode({ value, onChange, onNext, onBack }) {
  return (
    <Step onBack={onBack} progress={[true, false, false]}
          footer={<button className="btn" onClick={onNext}>Siguiente</button>}>
      <h1 className="onb-h">¿Cómo quieres que te ayudemos?</h1>
      <p className="onb-p">Puedes cambiarlo cuando quieras desde tu perfil.</p>
      {MODES.map((m) => (
        <Choice key={m.k} selected={value === m.k} onSelect={() => onChange(m.k)}
                title={m.t} desc={m.d} tag={m.tag} />
      ))}
    </Step>
  );
}

/* ------------------------- A8 simplicity settings ------------------------ */

function PrefSimplicity({ cap, threshold, onCap, onThreshold, onNext, onBack }) {
  return (
    <Step onBack={onBack} progress={[true, true, false]}
          footer={<button className="btn" onClick={onNext}>Siguiente</button>}>
      <h1 className="onb-h">¿Qué tan simple?</h1>
      <p className="onb-p">Elegiste "máximo, pero simple". Dinos dónde está tu límite.</p>

      <label className="fld">Máximo de productos que quieres usar</label>
      <Segmented value={String(cap)} onChange={(v) => onCap(Number(v))}
                 options={[['2', '2'], ['3', '3'], ['4', '4'], ['0', 'Sin límite']]} />

      <div style={{ height: 18 }} />
      <label className="fld">Avísame de un cambio solo si gano al menos</label>
      <Segmented value={String(threshold)} onChange={(v) => onThreshold(Number(v))}
                 options={[['20', '$20'], ['50', '$50'], ['100', '$100'], ['250', '$250']]} />
      <div className="note">Al mes. Debajo de eso, te dejamos en paz.</div>

      {/* Honest about sequencing: the engine does not read these yet. */}
      <div className="panel soft" style={{ marginTop: 16 }}>
        <div className="note" style={{ margin: 0 }}>
          Guardamos esto ahora y lo usaremos para no saturarte de recomendaciones.
        </div>
      </div>
    </Step>
  );
}

/* ---------------------------- A9 fine tuning ----------------------------- */

const TOGGLES = [
  ['show_new_picks', 'Muéstrame productos que podría contratar', 'Tarjetas y cuentas que no tienes.'],
  ['include_annual_fee', 'Incluir productos con anualidad', 'Solo si el beneficio supera la comisión.'],
  ['insured_only', 'Solo con seguro de depósito', 'IPAB, PROSOFIPO o FOCOOP.'],
  ['no_requirements_only', 'Sin requisitos de saldo o nómina', 'Oculta cuentas con condiciones para el rendimiento.'],
];

function PrefExtras({ prefs, onChange, onNext, onBack }) {
  return (
    <Step onBack={onBack} progress={[true, true, true]}
          footer={<button className="btn" onClick={onNext}>Siguiente</button>}>
      <h1 className="onb-h">Un par de ajustes</h1>
      <p className="onb-p">Nada de esto es definitivo.</p>

      <label className="fld">Quiero optimizar</label>
      <Segmented value={prefs.focus} onChange={(v) => onChange({ focus: v })}
                 options={[['cards', 'Tarjetas'], ['cash', 'Ahorro'], ['both', 'Ambos']]} />

      <div style={{ height: 8 }} />
      <div className="panel">
        {TOGGLES.map(([k, t, d]) => (
          <button key={k} className="tog" onClick={() => onChange({ [k]: !prefs[k] })}>
            <span className="tog-t"><b>{t}</b><br /><span className="dim">{d}</span></span>
            <span className={'sw' + (prefs[k] ? ' on' : '')} />
          </button>
        ))}
      </div>
    </Step>
  );
}

/* --------------------------- A10/A12 product pick ------------------------ */

/**
 * One component for both cards and accounts: the interaction is identical and
 * only the labels and the id field differ.
 */
function PickProducts({ kind, market, selected, onToggle, onNext, onSkip, onBack }) {
  const [q, setQ] = useState('');
  const [issuer, setIssuer] = useState('');

  const isCard = kind === 'card';
  const items = isCard ? (market.cards || []) : (market.accounts || []);
  const idOf = (p) => (isCard ? p.card_id : p.account_id);
  const issuerOf = (p) =>
    (market.issuers || []).find((i) => i.issuer_id === p.issuer_id) || {};

  // Issuers with the most products first: the long tail is reachable by search.
  const issuers = useMemo(() => {
    const count = {};
    items.forEach((p) => { count[p.issuer_id] = (count[p.issuer_id] || 0) + 1; });
    return Object.keys(count)
      .map((id) => (market.issuers || []).find((i) => i.issuer_id === id))
      .filter(Boolean)
      .sort((a, b) => count[b.issuer_id] - count[a.issuer_id])
      .slice(0, 8);
  }, [items, market.issuers]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((p) => {
      if (issuer && p.issuer_id !== issuer) return false;
      if (!needle) return true;
      const iss = issuerOf(p);
      return (String(p.display_name || '') + ' ' + String(iss.display_name || ''))
        .toLowerCase().includes(needle);
    }).slice(0, 60);
  }, [items, q, issuer]);

  const sub = (p) => {
    if (isCard) {
      const fee = knownNum(p.annual_fee_mxn);
      const feeTxt = fee === null ? 'anualidad no publicada'
                   : fee === 0 ? 'sin anualidad' : 'anualidad ' + mxn(fee);
      return feeTxt + ' · ' + rtl(p.base_reward_type);
    }
    const rate = knownNum(p.flat_rate_pct);
    return (rate === null ? 'rendimiento variable' : pct(rate)) +
           (p.insurance_scheme ? ' · ' + p.insurance_scheme : '');
  };

  const n = selected.length;

  return (
    <Step onBack={onBack} onSkip={onSkip}
          footer={
            <button className="btn" onClick={onNext}>
              {n === 0 ? 'Continuar'
                : 'Continuar con ' + n + (isCard
                    ? (n === 1 ? ' tarjeta' : ' tarjetas')
                    : (n === 1 ? ' cuenta' : ' cuentas'))}
            </button>
          }>
      <h1 className="onb-h">{isCard ? '¿Qué tarjetas tienes?' : '¿Dónde tienes tu dinero?'}</h1>
      <p className="onb-p">
        {isCard
          ? 'Búscalas por banco o nombre. Puedes agregar más después.'
          : 'Cuentas de ahorro, nómina o inversión. Puedes agregar más después.'}
      </p>

      <div className="search-wrap">
        <Ico n="search" s={17} />
        <input className="search-in" value={q} placeholder="Buscar por banco o nombre"
               onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="chips scroll">
        <button className={'chip' + (issuer === '' ? ' on' : '')}
                onClick={() => setIssuer('')}>Todos</button>
        {issuers.map((i) => (
          <button key={i.issuer_id}
                  className={'chip' + (issuer === i.issuer_id ? ' on' : '')}
                  onClick={() => setIssuer(issuer === i.issuer_id ? '' : i.issuer_id)}>
            {i.display_name}
          </button>
        ))}
      </div>

      <div className="panel tight">
        {shown.length === 0 && (
          <div className="note" style={{ margin: '6px 0' }}>
            No encontramos nada con esa búsqueda. Puedes seguir y agregarlo
            después desde Productos.
          </div>
        )}
        {shown.map((p) => {
          const id = idOf(p);
          const iss = issuerOf(p);
          const on = selected.includes(id);
          return (
            <button key={id} className={'prow' + (on ? ' on' : '')}
                    onClick={() => onToggle(id)}>
              <BankMark name={iss.display_name} url={iss.logo_url} size={34} />
              <span className="prow-t">
                <b>{p.display_name}</b><br />
                <span className="dim">{sub(p)}</span>
              </span>
              <span className={'chk' + (on ? ' on' : '')} />
            </button>
          );
        })}
      </div>
    </Step>
  );
}

/* --------------------------- A12b balances ------------------------------- */

/**
 * Exact amounts, not ranges: tiered yield is scored against the real balance,
 * so a band would land on the wrong tier and quietly produce a wrong number.
 */
function Balances({ market, accountIds, balances, onChange, onNext, onSkip, onBack }) {
  const accts = accountIds
    .map((id) => (market.accounts || []).find((a) => a.account_id === id))
    .filter(Boolean);

  return (
    <Step onBack={onBack} onSkip={onSkip}
          footer={<button className="btn" onClick={onNext}>Continuar</button>}>
      <h1 className="onb-h">¿Cuánto tienes en cada una?</h1>
      <p className="onb-p">
        Lo usamos para calcular cuánto podrías ganar. Un aproximado sirve; puedes
        ajustarlo después.
      </p>
      {accts.map((a) => (
        <div className="panel" key={a.account_id}>
          <div className="fld">{a.display_name}</div>
          <AmountInput value={balances[a.account_id] || ''}
                       onChange={(v) => onChange(a.account_id, v)}
                       placeholder="0" />
        </div>
      ))}
    </Step>
  );
}

/* ------------------------------- A13 done -------------------------------- */

function Done({ name, cards, accounts, mode, onEnter, busy }) {
  const modeLabel = (MODES.find((m) => m.k === mode) || {}).t || '';
  return (
    <div className="onb">
      <div className="onb-body" style={{ paddingTop: 28 }}>
        <div className="done-check"><Ico n="check" s={30} /></div>
        <h1 className="onb-h center">Todo listo{name ? ', ' + name : ''}</h1>
        <p className="onb-p center">Ya podemos ayudarte en tu próxima compra.</p>
        <div className="panel">
          <div className="sumrow"><span className="dim">Tarjetas</span><span className="num">{cards}</span></div>
          <div className="sumrow"><span className="dim">Cuentas</span><span className="num">{accounts}</span></div>
          <div className="sumrow"><span className="dim">Modo</span><span className="num">{modeLabel}</span></div>
        </div>
      </div>
      <div className="onb-foot">
        <button className="btn teal" onClick={onEnter} disabled={busy}>
          {busy ? <span className="spin" /> : 'Entrar a Norte'}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ orchestrator ----------------------------- */

function Onboarding({ onDone, onLogin }) {
  const [screen, setScreen] = useState('welcome');
  const [slide, setSlide] = useState(0);
  const [email, setEmail] = useState('');
  const [session, setSession] = useState(null);   // set once the account exists
  const [market, setMarket] = useState({ issuers: [], cards: [], accounts: [] });
  const [prefs, setPrefs] = useState({
    optimization_mode: 'simple', simplicity_cap: 3, switch_threshold_mxn: 50,
    focus: 'both', show_new_picks: true, include_annual_fee: true,
    insured_only: false, no_requirements_only: false,
  });
  const [cards, setCards] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [balances, setBalances] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Market data is public, so it can load during onboarding without a session.
  useEffect(() => {
    apiGet({ action: 'market' })
      .then((r) => { if (r.ok) setMarket(r.data); })
      .catch(() => {});
  }, []);

  const patchPrefs = (p) => setPrefs((prev) => ({ ...prev, ...p }));
  const toggle = (list, set) => (id) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : list.concat(id));

  const registerEmail = async (mail) => {
    setEmail(mail);
    setError('');
    setScreen('name');
  };

  const createAccount = async ({ first_name, last_name, password }) => {
    setBusy(true);
    setError('');
    try {
      const r = await apiPost({ action: 'register', email, password,
                                first_name, last_name, preferences: prefs });
      if (r.ok) { setSession(r); setScreen('mode'); }
      else setError(r.error || 'No se pudo crear la cuenta');
    } catch (e) {
      setError('Sin conexión con el servidor');
    }
    setBusy(false);
  };

  const google = async (credential) => {
    setBusy(true);
    setError('');
    try {
      const r = await apiPost({ action: 'googleLogin', id_token: credential,
                                preferences: prefs });
      if (r.ok) {
        setSession(r);
        // Already onboarded on another device: don't make them do it twice.
        if (r.user && r.user.onboarding_completed_at) onDone(r);
        else setScreen('mode');
      } else {
        setError(r.error || 'No se pudo entrar con Google');
      }
    } catch (e) {
      setError('Sin conexión con el servidor');
    }
    setBusy(false);
  };

  /** Products are written one at a time: the Sheet is edited by row lookup. */
  const finish = async () => {
    setBusy(true);
    const token = session && session.token;
    const uid = session && session.user && session.user.user_id;
    try {
      await apiPost({ action: 'savePreferences', token, user_id: uid, preferences: prefs });
      for (const id of cards) {
        await apiPost({ action: 'addUserProduct', user_id: uid,
                        product_type: 'card', product_id: id });
      }
      for (const id of accounts) {
        await apiPost({ action: 'addUserProduct', user_id: uid,
                        product_type: 'account', product_id: id,
                        current_balance: num(balances[id], '') });
      }
      await apiPost({ action: 'completeOnboarding', token, user_id: uid });
    } catch (e) {
      // The account exists and works; a failed product write is recoverable
      // from the Productos screen, so don't strand them here.
    }
    setBusy(false);
    onDone(session);
  };

  const go = (s) => () => setScreen(s);
  const afterMode = () =>
    setScreen(prefs.optimization_mode === 'simple' ? 'simplicity' : 'extras');

  switch (screen) {
    case 'welcome':
      return <Welcome onCreate={() => { setSlide(0); setScreen('value'); }}
                      onLogin={onLogin} />;

    case 'value':
      return <ValueSlides step={slide}
                          onNext={() => (slide === 2 ? setScreen('signup') : setSlide(slide + 1))}
                          onBack={() => (slide === 0 ? setScreen('welcome') : setSlide(slide - 1))}
                          onSkip={go('signup')} />;

    case 'signup':
      return <SignUp onEmail={registerEmail} onGoogle={google}
                     onBack={() => { setSlide(2); setScreen('value'); }}
                     onHasAccount={onLogin} busy={busy}
                     error={error} setError={setError} />;

    case 'name':
      return <NameAndPassword email={email} onSubmit={createAccount}
                              onBack={go('signup')} busy={busy} error={error} />;

    case 'mode':
      return <PrefMode value={prefs.optimization_mode}
                       onChange={(v) => patchPrefs({ optimization_mode: v })}
                       onNext={afterMode} onBack={null} />;

    case 'simplicity':
      return <PrefSimplicity cap={prefs.simplicity_cap}
                             threshold={prefs.switch_threshold_mxn}
                             onCap={(v) => patchPrefs({ simplicity_cap: v })}
                             onThreshold={(v) => patchPrefs({ switch_threshold_mxn: v })}
                             onNext={go('extras')} onBack={go('mode')} />;

    case 'extras':
      return <PrefExtras prefs={prefs} onChange={patchPrefs}
                         onNext={go('cards')}
                         onBack={() => setScreen(prefs.optimization_mode === 'simple'
                           ? 'simplicity' : 'mode')} />;

    case 'cards':
      return <PickProducts kind="card" market={market} selected={cards}
                           onToggle={toggle(cards, setCards)}
                           onNext={go('accounts')} onSkip={go('accounts')}
                           onBack={go('extras')} />;

    case 'accounts':
      return <PickProducts kind="account" market={market} selected={accounts}
                           onToggle={toggle(accounts, setAccounts)}
                           onNext={() => setScreen(accounts.length ? 'balances' : 'done')}
                           onSkip={go('done')} onBack={go('cards')} />;

    case 'balances':
      return <Balances market={market} accountIds={accounts} balances={balances}
                       onChange={(id, v) => setBalances((b) => ({ ...b, [id]: v }))}
                       onNext={go('done')} onSkip={go('done')} onBack={go('accounts')} />;

    case 'done':
      return <Done name={(session && session.user && session.user.first_name) || ''}
                   cards={cards.length} accounts={accounts.length}
                   mode={prefs.optimization_mode} onEnter={finish} busy={busy} />;

    default:
      return null;
  }
}

/* -------------------------------- entry ---------------------------------- */

/**
 * Decides which screen a signed-out person sees.
 *
 * A device that has signed in before goes straight to the login form: making
 * the six existing testers tap through a marketing screen every time they sign
 * out would be a tax on the people who already know what Norte is. A device
 * that has never seen it gets the welcome screen — that is someone who just
 * installed the app.
 *
 * Both link to each other, so nobody is stuck on the wrong one.
 */
function Entry({ onLogin }) {
  const seen = LS.get(ONB_SEEN_KEY);
  const [where, setWhere] = useState(seen ? 'login' : 'onboarding');

  if (where === 'login') {
    return <Login onLogin={onLogin}
                  onCreateAccount={() => setWhere('onboarding')} />;
  }
  return <Onboarding onDone={onLogin} onLogin={() => setWhere('login')} />;
}
