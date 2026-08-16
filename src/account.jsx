/* ===========================================================================
   Norte — login, history, profile, menu and admin
   ---------------------------------------------------------------------------
   Loaded after screens.jsx. Plain script, shared scope — see SETUP.md.
   Migration notes are marked MIGRATED.
   =========================================================================== */

/* -------------------------------- login ---------------------------------
   MOVED to src/auth.jsx (2026-08). The old pick-a-user-and-type-a-NIP screen
   fetched every account before authenticating, which is what leaked the user
   list. Declaring Login here as well would shadow the new one — plain
   scripts share one scope.
   ------------------------------------------------------------------------ */

/* ------------------------------- history -------------------------------- */

function History({ d, user, deleteMovement }) {
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [openSwipeId, setOpenSwipeId] = useState(null);

  // MIGRATED: card_name / account_name -> display_name
  const productName = (id) => {
    const c = d.cards.find((x) => x.card_id === id);
    if (c) return c.display_name;
    const a = d.accounts.find((x) => x.account_id === id);
    return a ? a.display_name : id;
  };
  const issuerOfProduct = (id) => {
    const p = d.cards.find((x) => x.card_id === id) ||
              d.accounts.find((x) => x.account_id === id);
    return p ? (d.issuers.find((i) => i.issuer_id === p.issuer_id) || {}) : {};
  };
  const catLabel = (key) => {
    const c = d.categories.find((x) => x.category_key === key);
    return c ? c.display_label : key;
  };

  const rows = useMemo(
    () => d.movements
      .filter((m) => m.user_id === user.user_id)
      .filter((m) => filter === 'all' ? true
        : filter === 'cc' ? m.flow === 'cc' : m.flow === 'debit')
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))),
    [d, user, filter]);

  const ccBenefit = (list) => list.filter((m) => m.flow === 'cc')
    .reduce((s, m) => s + num(m.computed_benefit_mxn), 0);
  const debitBenefit = (list) => list.filter((m) => m.flow === 'debit')
    .reduce((s, m) => s + num(m.computed_benefit_mxn), 0);

  const totals = useMemo(() => ({
    count: rows.length,
    amount: rows.reduce((s, m) => s + num(m.amount), 0),
    benefit: filter === 'debit' ? debitBenefit(rows) : ccBenefit(rows),
  }), [rows, filter]);

  const byMonth = useMemo(() => {
    const m = {};
    rows.forEach((r) => {
      const key = String(r.timestamp).slice(0, 7);
      (m[key] = m[key] || []).push(r);
    });
    return Object.keys(m).sort().reverse().map((k) => ({
      k, items: m[k],
      benefit: filter === 'debit' ? debitBenefit(m[k]) : ccBenefit(m[k]),
    }));
  }, [rows, filter]);

  const confirmDelete = () => {
    deleteMovement(detail.movement_id);
    setConfirming(false);
    setDetail(null);
  };

  return (
    <>
      <div className="panel sticky-tools">
        <Segmented value={filter} onChange={setFilter}
                   options={[{ v: 'all', l: 'Todo' }, { v: 'cc', l: 'Tarjetas' },
                             { v: 'debit', l: 'Cuentas' }]} />
      </div>

      <div className="hint">
        <Ico n="info" s={16} /> Desliza un movimiento a la izquierda para eliminarlo.
      </div>

      <div className="mini-grid three">
        <Stat label="Movimientos" value={totals.count} />
        <Stat label="Monto" value={mxn(totals.amount)} />
        <Stat label={filter === 'debit' ? 'Rendimiento' : 'Generado'}
              value={mxn2(totals.benefit)} tone="teal"
              sub={filter === 'debit' ? 'estimado al año' : null} />
      </div>

      {!rows.length && (
        <div className="panel">
          <Empty icon="clock" title="Nada registrado aquí">
            {filter === 'all'
              ? 'Usa los asesores y registra tus movimientos para construir tu historial.'
              : 'No hay movimientos de este tipo todavía.'}
          </Empty>
        </div>
      )}

      {byMonth.map((group) => (
        <div className="panel" key={group.k}>
          <div className="panel-head">
            <div className="ph-l cap">{monthLabel(group.k)}</div>
            <span className="ph-r teal">
              {group.benefit > 0 ? '+' + mxn2(group.benefit) : '—'}
            </span>
          </div>
          {group.items.map((m) => {
            const iss = issuerOfProduct(m.recommended_product_id);
            return (
              <SwipeRow key={m.movement_id} id={m.movement_id}
                        openId={openSwipeId} setOpenId={setOpenSwipeId}
                        onDelete={() => deleteMovement(m.movement_id)}>
                <Row
                  mark={<BankMark name={iss.display_name} url={iss.logo_url} size={34} />}
                  title={m.flow === 'cc' ? catLabel(m.merchant_category)
                         : m.direction === 'in' ? 'Depósito' : 'Retiro'}
                  meta={productName(m.recommended_product_id) + ' · ' + dayLabel(m.timestamp)}
                  right={mxn(num(m.amount))}
                  rightSub={num(m.computed_benefit_mxn) > 0
                    ? '+' + mxn2(num(m.computed_benefit_mxn)) : null}
                  tone={num(m.computed_benefit_mxn) > 0 ? 'teal-sub' : null}
                  onClick={() => {
                    // A swipe that opened a delete button should not also open
                    // the detail sheet on release.
                    if (openSwipeId) { setOpenSwipeId(null); return; }
                    setDetail(m);
                    setConfirming(false);
                  }} />
              </SwipeRow>
            );
          })}
        </div>
      ))}

      <Sheet open={!!detail} onClose={() => setDetail(null)}
             title="Detalle del movimiento"
             footer={confirming
               ? <div className="confirm">
                   <div className="confirm-t">
                     ¿Eliminar este movimiento? No se puede deshacer.
                   </div>
                   <div className="confirm-b">
                     <button className="btn ghost" onClick={() => setConfirming(false)}>
                       Cancelar
                     </button>
                     <button className="btn danger" onClick={confirmDelete}>Eliminar</button>
                   </div>
                 </div>
               : <button className="btn danger-ghost" onClick={() => setConfirming(true)}>
                   <Ico n="trash" s={16} /> Eliminar movimiento
                 </button>}>
        {detail && (
          <div className="detail">
            <div className="drow">
              <span>Tipo</span>
              <span>{detail.flow === 'cc' ? 'Compra con tarjeta'
                     : detail.direction === 'in' ? 'Depósito' : 'Retiro'}</span>
            </div>
            {detail.flow === 'cc' && (
              <div className="drow">
                <span>Categoría</span>
                <span>{catLabel(detail.merchant_category)}</span>
              </div>
            )}
            <div className="drow">
              <span>Producto</span>
              <span>{productName(detail.recommended_product_id)}</span>
            </div>
            <div className="drow">
              <span>Monto</span>
              <span>{mxn2(num(detail.amount))}</span>
            </div>
            <div className="drow">
              <span>{detail.flow === 'cc' ? 'Recompensa de esta compra'
                     : 'Rendimiento estimado al año'}</span>
              <span>{mxn2(num(detail.computed_benefit_mxn))}</span>
            </div>
            {/* MIGRATED: reward is stored apart from total benefit because
                monthly caps apply to reward only. Show it when they differ. */}
            {detail.flow === 'cc' &&
             knownNum(detail.computed_reward_mxn) !== null &&
             num(detail.computed_reward_mxn) !== num(detail.computed_benefit_mxn) && (
              <div className="drow">
                <span>De la cual, recompensa</span>
                <span>{mxn2(num(detail.computed_reward_mxn))}</span>
              </div>
            )}
            <div className="drow">
              <span>Fecha</span>
              <span>{String(detail.timestamp).slice(0, 10)}</span>
            </div>
            {detail.notes && (
              <div className="drow"><span>Notas</span><span>{detail.notes}</span></div>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}

/* -------------------------------- profile ------------------------------- */

function Profile({ d, user, onSignOut, onSwitch, saveName, go }) {
  const port = useMemo(() => portfolio(d, user.user_id), [d, user]);
  const me = d.users.find((u) => u.user_id === user.user_id) || user;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me.name || '');

  const since = port.mv.length
    ? port.mv.map((m) => String(m.timestamp)).sort()[0].slice(0, 7)
    : null;

  // MIGRATED: min_risk_score is gone; eligibility now uses published income
  // requirements, so we show the user's own income instead of a score.
  const income = knownNum(me.monthly_income_mxn);

  return (
    <>
      <div className="profile-head">
        <div className="p-avatar" style={{ background: bankColor(me.name) }}>
          {String(me.name || '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="p-name">{me.name}</div>
        <div className="p-role">
          {me.is_admin ? 'Administrador' : 'Miembro'} · {me.user_id}
        </div>
      </div>

      <div className="mini-grid">
        <Stat label="Generado a la fecha" value={mxn2(port.lifeBenefit)} tone="teal"
              sub={port.mv.length + ' movimientos'} />
        <Stat label="Saldo total" value={mxn(port.balance)}
              sub={port.balance > 0 ? pct(port.avgRate) + ' promedio' : '—'} />
      </div>

      <div className="panel">
        <div className="panel-head"><div className="ph-l">Mis productos</div></div>
        <Row icon="card" title="Tarjetas de crédito"
             meta={port.fees ? mxn(port.fees) + '/año en anualidades' : 'Sin anualidades'}
             right={port.cards.length} onClick={() => go('products')} />
        <Row icon="savings" title="Cuentas"
             meta={port.projYield > 0 ? mxn(port.projYield) + '/año proyectado'
                                      : 'Sin rendimiento proyectado'}
             right={port.accts.length} onClick={() => go('products')} />
      </div>

      <div className="panel">
        <div className="panel-head"><div className="ph-l">Datos</div></div>
        <div className="detail">
          <div className="drow"><span>Nombre</span><span>{me.name}</span></div>
          <div className="drow"><span>Usuario</span><span>{me.user_id}</span></div>
          <div className="drow">
            <span>Ingreso mensual</span>
            <span>{income !== null ? mxn(income) : 'Sin registrar'}</span>
          </div>
          <div className="drow">
            <span>Gasto del mes</span><span>{mxn(port.monthSpend)}</span>
          </div>
          <div className="drow">
            <span>Activo desde</span>
            <span className="cap">{since ? monthLabel(since) : '—'}</span>
          </div>
        </div>
        <div className="note">
          Tu ingreso mensual sólo se usa para filtrar qué tarjetas puedes solicitar
          en Sugerencias. Se administra desde la hoja de datos.
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><div className="ph-l">Cuenta</div></div>
        <Row icon="edit" title="Editar nombre"
             onClick={() => { setName(me.name || ''); setEditing(true); }} />
        <Row icon="user" title="Cambiar de usuario" onClick={onSwitch} />
        <Row icon="logout" title="Cerrar sesión" onClick={onSignOut} />
      </div>

      <Sheet open={editing} onClose={() => setEditing(false)} title="Editar nombre"
             footer={<button className="btn" disabled={!name.trim()}
                             onClick={() => { saveName(name.trim()); setEditing(false); }}>
                       Guardar
                     </button>}>
        <label className="fld">Nombre</label>
        <input className="text-in" value={name}
               onChange={(e) => setName(e.target.value)} maxLength={40} />
      </Sheet>
    </>
  );
}

/* --------------------------------- menu --------------------------------- */

function Menu({ open, onClose, d, user, go, onRefresh, syncing, lastSync, onSignOut }) {
  const port = useMemo(() => (open ? portfolio(d, user.user_id) : null), [d, user, open]);
  if (!open) return null;

  return (
    <Sheet open={open} onClose={onClose}
           title={
             <div className="sheet-prod">
               <div className="uavatar"
                    style={{ background: bankColor(user.name), width: 38, height: 38,
                             fontSize: 16 }}>
                 {String(user.name || '?').slice(0, 1).toUpperCase()}
               </div>
               <div>
                 <div className="sheet-prod-n">{user.name}</div>
                 <div className="sheet-prod-i">
                   {user.is_admin ? 'Administrador' : 'Miembro'}
                 </div>
               </div>
             </div>
           }>
      <Row icon="clock" title="Historial" meta="Todos tus movimientos"
           right={port.mv.length || null} onClick={() => go('history')} />
      <Row icon="user" title="Perfil" meta="Tus datos y productos"
           onClick={() => go('profile')} />
      {user.is_admin && (
        <Row icon="shield" title="Admin" meta="Estado de los datos"
             onClick={() => go('admin')} />
      )}
      <Row icon="refresh" title={syncing ? 'Actualizando…' : 'Actualizar datos'}
           meta={lastSync ? 'Última sincronización ' + lastSync
                          : 'Datos del mercado y tus movimientos'}
           onClick={syncing ? null : onRefresh} />
      <Row icon="logout" title="Cerrar sesión" onClick={onSignOut} />
      <div className="version">Norte · versión 2.1</div>
    </Sheet>
  );
}

/* --------------------------------- admin -------------------------------- */

function Admin({ d }) {
  // MIGRATED: the dataset is no longer edited in the Sheet. The Sheet is a
  // generated view of data/market/*.json in git, so this screen reports what
  // arrived rather than inviting edits.
  const insurance = useMemo(() => {
    const m = {};
    d.issuers.forEach((i) => {
      const inst = instOf(i);
      const key = inst ? inst.l : 'Sin clasificar';
      m[key] = (m[key] || 0) + 1;
    });
    return m;
  }, [d.issuers]);

  const uninsured = d.accounts.filter((a) => {
    const iss = d.issuers.find((i) => i.issuer_id === a.issuer_id);
    const inst = instOf(iss);
    return inst && inst.tone === 'warn' && takesDeposits(iss);
  }).length;

  const pending = d.issuers.filter((i) => i.status === 'pending_conversion');

  const rows = [
    ['Usuarios', d.users.length, d.users.map((u) => u.name).join(', ')],
    ['Emisores', d.issuers.length,
      Object.entries(insurance).map(([k, v]) => v + ' ' + k).join(' · ')],
    ['Tarjetas', d.cards.length,
      d.cardRewards.length + ' bonus · ' + d.cardPerks.length + ' beneficios'],
    ['Cuentas', d.accounts.length,
      d.yieldTiers.length + ' niveles · ' +
      ((d.conditionalBoosts || []).length) + ' condicionados'],
    ['Categorías', d.categories.length,
      d.categories.map((c) => c.display_label).join(', ')],
    ['Movimientos', d.movements.length, 'registrados por ti'],
  ];

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div className="ph-l"><Ico n="shield" s={16} /> Estado de los datos</div>
        </div>
        <div className="sub">
          Los datos de mercado viven en el repositorio y se publican a la hoja.
          Editar la hoja directamente se detecta como divergencia en la siguiente
          publicación.
        </div>
        {rows.map(([label, value, meta]) => (
          <Row key={label} title={label} meta={meta} right={value} />
        ))}
      </div>

      {(uninsured > 0 || pending.length > 0) && (
        <div className="panel">
          <div className="panel-head">
            <div className="ph-l"><Ico n="alert" s={16} /> Requiere atención</div>
          </div>
          {uninsured > 0 && (
            <Row title="Cuentas sin seguro de depósito" right={uninsured}
                 meta="Se marcan como tal en el detalle y en Sugerencias" />
          )}
          {/* A licence granted but not yet effective changes the insurance on a
              known date; it must not be discovered after the fact. */}
          {pending.map((i) => (
            <Row key={i.issuer_id} title={i.display_name}
                 meta={'Cambia de figura regulatoria el ' + i.conversion_effective_date}
                 right="pendiente" />
          ))}
        </div>
      )}
    </>
  );
}
