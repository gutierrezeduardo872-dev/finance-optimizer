/* ===========================================================================
   Norte — authentication screens (L1–L4)
   ---------------------------------------------------------------------------
   Loaded after ui.jsx, before app.jsx. Plain script, shared scope — see
   SETUP.md. Load order matters: app.jsx renders <Login>.

   Replaces the old pick-a-user-and-type-a-NIP screen. What changed and why:

     - No user list. The old screen fetched every account before authenticating,
       so anyone who opened the app saw who was registered. Now you type who
       you are.
     - One identifier field. It accepts email, username or the old display
       name, so Pichi / Bomber / Lalu / Laura / Jorge / Tester keep signing in
       with what they already know while new accounts use email.
     - NIP migration (L2) fires automatically. The backend flags
       needsPasswordUpgrade when an account still has a plain-text pin and no
       password_hash; that routes here once, then never again.
     - Google Sign-In. The button is rendered by Google's own library — it has
       to be, their branding rules require it — and the resulting token is
       verified server side, never trusted here.
   =========================================================================== */

const GOOGLE_CLIENT_ID =
  '169214993014-aubous9u0vl6i6js7dkum15a6pp1a274.apps.googleusercontent.com';

/* ---------------------------- Google button ----------------------------- */

/**
 * Google's library loads async from index.html. It may not be ready when this
 * mounts, so poll briefly rather than assuming — and if it never arrives
 * (blocked script, offline, ad blocker), render nothing at all instead of a
 * dead button. Email and password still work in that case.
 */
function GoogleButton({ onCredential, onError }) {
  const box = useRef(null);
  const [ready, setReady] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let tries = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const g = window.google && window.google.accounts && window.google.accounts.id;
      if (g) {
        try {
          g.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: (res) => {
              if (res && res.credential) onCredential(res.credential);
              else onError('No se recibió la credencial de Google');
            },
          });
          if (box.current) {
            g.renderButton(box.current, {
              type: 'standard',
              theme: 'outline',
              size: 'large',
              shape: 'pill',
              text: 'continue_with',
              locale: 'es-419',
              width: Math.min(360, (box.current.offsetWidth || 320)),
            });
          }
          setReady(true);
        } catch (e) {
          setGone(true);
        }
        return;
      }
      // ~6s of patience, then give up quietly.
      if (++tries > 60) { setGone(true); return; }
      setTimeout(tick, 100);
    };

    tick();
    return () => { cancelled = true; };
  }, []);

  if (gone) return null;

  return (
    <div className="gwrap">
      <div ref={box} className="gbtn-host" />
      {!ready && <div className="gbtn-skel" />}
    </div>
  );
}

/* ------------------------------- L1 login -------------------------------- */

function Login({ onLogin, onCreateAccount }) {
  const [mode, setMode] = useState('login');   // login | upgrade | recover
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null); // session awaiting NIP upgrade

  const canSubmit = identifier.trim() && password && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setError('');
    setBusy(true);
    try {
      const r = await apiPost({
        action: 'login',
        identifier: identifier.trim(),
        password,
      });
      if (!r.ok) {
        setError(r.error || 'Usuario o contraseña incorrectos');
      } else if (r.needsPasswordUpgrade) {
        // Signed in with a legacy NIP. Hold the session and force a password
        // before letting them through.
        setPending(r);
        setMode('upgrade');
      } else {
        onLogin(r);
      }
    } catch (e) {
      setError('Sin conexión con el servidor');
    }
    setBusy(false);
  };

  const google = async (credential) => {
    setError('');
    setBusy(true);
    try {
      const r = await apiPost({ action: 'googleLogin', id_token: credential });
      if (r.ok) onLogin(r);
      else setError(r.error || 'No se pudo entrar con Google');
    } catch (e) {
      setError('Sin conexión con el servidor');
    }
    setBusy(false);
  };

  if (mode === 'upgrade') {
    return <NipUpgrade session={pending}
                       onDone={onLogin}
                       onCancel={() => { setPending(null); setMode('login'); setPassword(''); }} />;
  }

  if (mode === 'recover') {
    return <Recover identifier={identifier} onBack={() => setMode('login')} />;
  }

  return (
    <div className="auth">
      <div className="auth-inner">
        <div className="auth-brand">
          <Logo size={52} />
          <h1>Norte</h1>
          <p>Tu norte financiero.</p>
        </div>

        <div className="panel">
          <GoogleButton onCredential={google} onError={setError} />

          <div className="divide"><span>o</span></div>

          <label className="fld" htmlFor="norte-id">Correo o usuario</label>
          <input id="norte-id" className="text-in" type="text" autoComplete="username"
                 autoCapitalize="none" autoCorrect="off" spellCheck="false"
                 value={identifier}
                 onChange={(e) => { setIdentifier(e.target.value); setError(''); }}
                 onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />

          <div style={{ height: 12 }} />

          <label className="fld" htmlFor="norte-pw">Contraseña</label>
          <div className="in-wrap">
            <input id="norte-pw" className="text-in" type={show ? 'text' : 'password'}
                   autoComplete="current-password" value={password}
                   onChange={(e) => { setPassword(e.target.value); setError(''); }}
                   onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
            <button type="button" className="in-act" onClick={() => setShow(!show)}
                    aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
              {show ? 'Ocultar' : 'Ver'}
            </button>
          </div>

          {/* L4: after a failure the recovery link is promoted to a button. */}
          {!error && (
            <div className="right-link">
              <button className="link" onClick={() => setMode('recover')}>
                ¿Olvidaste tu contraseña?
              </button>
            </div>
          )}

          {error && <div className="err">{error}</div>}

          <div style={{ height: 14 }} />
          <button className="btn" disabled={!canSubmit} onClick={submit}>
            {busy ? <span className="spin" /> : 'Entrar'}
          </button>

          {error && (
            <>
              <div style={{ height: 10 }} />
              <button className="btn ghost" onClick={() => setMode('recover')}>
                ¿Olvidaste tu contraseña?
              </button>
            </>
          )}

          <div className="note center">Se recordará tu sesión en este dispositivo.</div>
        </div>

        {onCreateAccount && (
          <div className="note center">
            ¿Primera vez?{' '}
            <button className="link" onClick={onCreateAccount}>Crea tu cuenta</button>
          </div>
        )}

        <div className="note center">
          Norte es informativo. No movemos tu dinero ni pedimos claves de banca en línea.
        </div>
      </div>
    </div>
  );
}

/* --------------------------- L2 NIP migration ---------------------------- */

/**
 * Reached only by signing in with a legacy NIP. The session token is already
 * valid, so setPassword is authorised by the token rather than re-asking for
 * the NIP. The reassurance line is there because the real fear is losing the
 * history, not the password.
 */
function NipUpgrade({ session, onDone, onCancel }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const short = pw.length > 0 && pw.length < 8;
  const mismatch = pw2.length > 0 && pw !== pw2;
  const ready = pw.length >= 8 && pw === pw2 && !busy;

  const save = async () => {
    if (!ready) return;
    setError('');
    setBusy(true);
    try {
      const r = await apiPost({ action: 'setPassword', token: session.token, password: pw });
      if (r.ok) onDone(r);
      else setError(r.error || 'No se pudo guardar la contraseña');
    } catch (e) {
      setError('Sin conexión con el servidor');
    }
    setBusy(false);
  };

  const name = (session && session.user && session.user.first_name) ||
               (session && session.user && session.user.name) || '';

  return (
    <div className="auth">
      <div className="auth-inner">
        <div className="auth-brand">
          <Logo size={44} />
          <h1>Actualiza tu acceso</h1>
          <p>{name ? 'Hola, ' + name + '. ' : ''}Tu cuenta todavía usa NIP.</p>
        </div>

        <div className="panel">
          <label className="fld" htmlFor="np1">Nueva contraseña</label>
          <div className="in-wrap">
            <input id="np1" className="text-in" type={show ? 'text' : 'password'}
                   autoComplete="new-password" value={pw}
                   onChange={(e) => { setPw(e.target.value); setError(''); }} />
            <button type="button" className="in-act" onClick={() => setShow(!show)}>
              {show ? 'Ocultar' : 'Ver'}
            </button>
          </div>
          <div className={'note' + (short ? ' warn' : '')}>
            Mínimo 8 caracteres.
          </div>

          <div style={{ height: 12 }} />
          <label className="fld" htmlFor="np2">Confírmala</label>
          <input id="np2" className="text-in" type={show ? 'text' : 'password'}
                 autoComplete="new-password" value={pw2}
                 onChange={(e) => { setPw2(e.target.value); setError(''); }}
                 onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
          {mismatch && <div className="note warn">Las contraseñas no coinciden.</div>}

          {error && <div className="err">{error}</div>}

          <div style={{ height: 14 }} />
          <button className="btn" disabled={!ready} onClick={save}>
            {busy ? <span className="spin" /> : 'Guardar y entrar'}
          </button>
        </div>

        <div className="panel" style={{ background: 'var(--teal-soft)', borderColor: '#BCDCD4' }}>
          <div className="note" style={{ margin: 0, color: 'var(--teal)' }}>
            Tus tarjetas, cuentas e historial se quedan exactamente como están.
          </div>
        </div>

        <button className="link block" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

/* ---------------------------- L3 recover --------------------------------- */

/**
 * Password reset by email is not built yet — it needs MailApp plus a signed
 * reset link, and it is not on the critical path for six known testers. Being
 * honest about that beats a form that pretends to send something.
 */
function Recover({ identifier, onBack }) {
  return (
    <div className="auth">
      <div className="auth-inner">
        <div className="auth-brand">
          <Logo size={44} />
          <h1>Recupera tu acceso</h1>
          <p>Todavía estamos construyendo esta parte.</p>
        </div>

        <div className="panel">
          <div className="note" style={{ marginTop: 0 }}>
            Por ahora, escríbele a Eduardo y él restablece tu contraseña
            directamente{identifier ? ' (tu usuario: ' + identifier + ')' : ''}.
          </div>
          <div style={{ height: 14 }} />
          <button className="btn ghost" onClick={onBack}>Volver</button>
        </div>

        <div className="note center">
          Si entraste con Google, usa el botón de Google — esa cuenta no tiene contraseña.
        </div>
      </div>
    </div>
  );
}
