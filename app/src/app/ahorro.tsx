/* ===========================================================================
   Norte — asesor de ahorro
   ---------------------------------------------------------------------------
   La otra mitad del producto, y la parte del motor con más aristas: tasas
   mezcladas por tramo, boosts condicionales, plazos forzosos y cobertura del
   seguro de depósito.

   Dos decisiones del motor que esta pantalla tiene que respetar y no
   maquillar:

   1. blendedRate, no headlineRate. Cajita Nu paga 13% sobre los primeros
      $25,000. Poner "13%" junto a un saldo de $950,000 afirma una tasa que el
      usuario no va a recibir sobre el 97% de su dinero.

   2. El seguro se muestra, nunca se puntúa. Castigar en el score a una
      SOFIPO por su cobertura menor sería un juicio que hacemos en silencio por
      el usuario, y no hay un número defendible para eso. Se enseña la
      exposición y él decide.
   =========================================================================== */

import { useMemo, useState } from 'react';
import {
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { mxn, pct, savingsIn } from '@core/index.js';
import { issuerName } from '@/norte/data';
import { useNorte } from '@/norte/store';
import { T } from '@/norte/theme';

const CONDITION_LABEL: Record<string, string> = {
  linked_card_spend: 'gastar con la tarjeta ligada',
  payroll_direct_deposit: 'domiciliar tu nómina',
  min_monthly_deposit: 'depositar al mes',
  min_transaction_count: 'hacer movimientos al mes',
  tier_membership: 'subir de plan',
  other: 'cumplir una condición del emisor',
};

export default function SavingsAdvisor() {
  const { db, userId, logMovement, setBalance } = useNorte();
  const [raw, setRaw] = useState('50000');
  const amount = Number(String(raw).replace(/[^0-9.]/g, '')) || 0;

  const result = useMemo(
    () => savingsIn(db, userId, amount, {}),
    [amount],
  );

  const best = result.best;
  const rest = result.ranked.slice(1);
  const split = result.split;

  // Repartir solo se sugiere cuando gana de verdad. Un peso de diferencia no
  // justifica pedirle a alguien que abra dos apps del banco.
  const splitWorthIt =
    split && split.parts.length > 1 && best && split.total > best.benefit + 1;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        <Text style={s.kicker}>Asesor de ahorro</Text>
        <Text style={s.h1}>¿Dónde lo guardo?</Text>

        <View style={s.field}>
          <Text style={s.label}>Monto a depositar</Text>
          <TextInput
            style={s.input}
            value={raw}
            onChangeText={setRaw}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={T.ink3}
            selectionColor={T.copper}
          />
        </View>

        {best ? (
          <View style={s.winner}>
            <Text style={s.winnerKicker}>Aquí</Text>
            <Text style={s.winnerName}>{best.acct.display_name}</Text>
            <Text style={s.winnerIssuer}>{issuerName(best.acct.issuer_id)}</Text>

            <View style={s.winnerRow}>
              <View>
                <Text style={s.metricLabel}>Ganas al año</Text>
                <Text style={s.metricBig}>{mxn(best.benefit)}</Text>
              </View>
              <View>
                <Text style={s.metricLabel}>Tasa real</Text>
                <Text style={s.metricBig}>{pct(best.rate)}</Text>
              </View>
            </View>

            {best.rateCapped && best.headline > best.rate ? (
              <Text style={s.note}>
                La cuenta anuncia {pct(best.headline)}, pero solo sobre una parte del saldo.
                Sobre {mxn(amount)} la tasa efectiva es {pct(best.rate)}.
              </Text>
            ) : null}

            {best.locked ? (
              <Text style={s.warn}>
                Plazo forzoso{best.lockDays ? ` de ${best.lockDays} días` : ''}. No puedes sacarlo antes.
              </Text>
            ) : null}

            {best.feeUnknown ? (
              <Text style={s.warn}>
                El emisor no publica la comisión de manejo, así que este rendimiento es un techo,
                no una cifra.
              </Text>
            ) : best.monthlyFee ? (
              <Text style={s.note}>
                Comisión de manejo: {mxn(best.monthlyFee)} al mes, ya descontada.
              </Text>
            ) : null}

            <Insurance item={best} amount={amount} />

            {/* Depositar mueve el saldo además de registrar el movimiento: si
                solo se registrara, la próxima consulta seguiría razonando con
                el saldo viejo. */}
            <TouchableOpacity
              style={s.action}
              disabled={amount <= 0}
              onPress={() => {
                logMovement({
                  flow: 'debit', direction: 'in', amount,
                  productId: best.acct.account_id, benefit: best.benefit,
                });
                setBalance(best.acct.account_id,
                  (Number(best.acct.current_balance) || 0) + amount);
                setRaw('');
              }}
              accessibilityRole="button"
            >
              <Text style={s.actionText}>Deposité aquí, registrar {mxn(amount)}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.winner}>
            <Text style={s.winnerName}>Sin recomendación</Text>
            <Text style={s.note}>Ninguna de tus cuentas admite este monto.</Text>
          </View>
        )}

        {best?.opportunity ? (
          <View style={s.boost}>
            <Text style={s.boostKicker}>Puedes subir la tasa</Text>
            <Text style={s.boostText}>
              {pct(best.opportunity.currentRate)} pasa a {pct(best.opportunity.potentialRate)} si{' '}
              {CONDITION_LABEL[best.opportunity.conditionType] || best.opportunity.conditionType}
              {best.opportunity.conditionAmount
                ? ` ${mxn(best.opportunity.conditionAmount)}`
                : ''}
              .
            </Text>
            <Text style={s.boostGain}>
              +{mxn(best.opportunity.extraPerYear)} al año
              {best.opportunity.maxBalance
                ? `, sobre los primeros ${mxn(best.opportunity.maxBalance)}`
                : ''}
            </Text>
          </View>
        ) : null}

        {splitWorthIt ? (
          <View style={s.split}>
            <Text style={s.splitKicker}>Repartido rinde más</Text>
            <Text style={s.splitTotal}>{mxn(split.total)} al año</Text>
            <Text style={s.note}>
              {mxn(split.total - best.benefit)} más que dejarlo todo en una sola cuenta.
            </Text>
            {split.parts.map((p: any) => (
              <View key={p.acct.account_id} style={s.splitRow}>
                <Text style={s.splitName} numberOfLines={1}>{p.acct.display_name}</Text>
                <Text style={s.splitAmount}>{mxn(p.amount)}</Text>
              </View>
            ))}
            {split.unallocated > 0 ? (
              <Text style={s.warn}>
                {mxn(split.unallocated)} sin colocar: tus cuentas ya llegaron a su tope.
              </Text>
            ) : null}
          </View>
        ) : null}

        {rest.length > 0 && (
          <>
            <Text style={[s.label, s.restLabel]}>El resto</Text>
            {rest.map((r: any) => (
              <View key={r.acct.account_id} style={s.row}>
                <View style={s.rowTop}>
                  <View style={s.rowMain}>
                    <Text style={s.rowName} numberOfLines={1}>{r.acct.display_name}</Text>
                    <Text style={s.rowIssuer}>
                      {issuerName(r.acct.issuer_id)}
                      {r.locked ? ' · a plazo' : ''}
                      {!r.eligible ? ' · monto insuficiente' : ''}
                      {r.coverageMxn === null ? ' · sin seguro' : ''}
                    </Text>
                  </View>
                  <View style={s.rowRight}>
                    <Text style={s.rowReward}>{mxn(r.benefit)}</Text>
                    <Text style={s.rowRate}>{pct(r.rate)}</Text>
                  </View>
                </View>

                {/* Una cuenta que hoy va en cuarto lugar puede ser la mejor en
                    cuanto se cumpla su condición. Esconder eso porque no ganó
                    es esconder precisamente el consejo que la app existe para
                    dar. */}
                {r.opportunity ? (
                  <Text style={s.rowBoost}>
                    Sube a {pct(r.opportunity.potentialRate)} si{' '}
                    {CONDITION_LABEL[r.opportunity.conditionType] || r.opportunity.conditionType}
                    {r.opportunity.conditionAmount ? ` ${mxn(r.opportunity.conditionAmount)}` : ''}
                    {'. '}+{mxn(r.opportunity.extraPerYear)} al año.
                  </Text>
                ) : null}
              </View>
            ))}
          </>
        )}

        <Text style={s.footnote}>
          Las tasas mostradas son las que ese monto realmente gana, no la tasa de escaparate.
          Una cuenta que paga 13% sobre los primeros $25,000 no paga 13% sobre un millón.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}

/* El seguro se enseña, no se puntúa. IPAB cubre 400,000 UDIS, PROSOFIPO
   25,000, y esas cifras no significan nada hasta convertirlas a pesos, que es
   lo que hace coverageMxn. */
function Insurance({ item, amount }: { item: any; amount: number }) {
  if (item.coverageMxn === null) {
    return (
      <Text style={s.warn}>
        Sin seguro de depósito. Si la institución quiebra, no hay quien responda.
      </Text>
    );
  }
  if (item.uninsuredMxn > 0) {
    return (
      <Text style={s.warn}>
        {item.insuranceScheme} cubre hasta {mxn(item.coverageMxn)}.
        De {mxn(amount)}, quedan {mxn(item.uninsuredMxn)} fuera del seguro.
      </Text>
    );
  }
  return (
    <Text style={s.ok}>
      Cubierto por {item.insuranceScheme} hasta {mxn(item.coverageMxn)}.
    </Text>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.canvas },
  scroll: { padding: 20, paddingBottom: 48, gap: 14 },

  kicker: {
    color: T.ink3, fontSize: 12, fontWeight: '600',
    letterSpacing: 1.4, textTransform: 'uppercase',
  },
  h1: { color: T.ink, fontSize: 30, fontWeight: '700', letterSpacing: -0.5, marginBottom: 6 },

  field: { gap: 6 },
  label: {
    color: T.ink3, fontSize: 11, fontWeight: '600',
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  input: {
    backgroundColor: T.surface, borderColor: T.line, borderWidth: 1, borderRadius: 12,
    color: T.ink, fontSize: 26, fontWeight: '700',
    paddingHorizontal: 14, paddingVertical: 12,
  },

  winner: {
    backgroundColor: T.surface, borderColor: T.teal, borderWidth: 1,
    borderRadius: 16, padding: 18, gap: 4, marginTop: 6,
  },
  winnerKicker: {
    color: T.teal, fontSize: 11, fontWeight: '700',
    letterSpacing: 1.4, textTransform: 'uppercase',
  },
  winnerName: { color: T.ink, fontSize: 21, fontWeight: '700', letterSpacing: -0.3 },
  winnerIssuer: { color: T.ink3, fontSize: 13 },
  winnerRow: { flexDirection: 'row', gap: 32, marginTop: 14 },
  metricLabel: {
    color: T.ink3, fontSize: 10, fontWeight: '600',
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 2,
  },
  metricBig: { color: T.teal, fontSize: 26, fontWeight: '700' },

  note: { color: T.ink2, fontSize: 12.5, marginTop: 10, lineHeight: 18 },
  warn: { color: T.copper, fontSize: 12.5, marginTop: 10, lineHeight: 18 },
  ok: { color: T.ink3, fontSize: 12.5, marginTop: 10, lineHeight: 18 },
  action: {
    backgroundColor: T.teal, borderRadius: 12, paddingVertical: 13,
    alignItems: 'center', marginTop: 16,
  },
  actionText: { color: '#05201C', fontSize: 15, fontWeight: '700' },

  boost: {
    backgroundColor: T.copperSoft, borderColor: T.copper, borderWidth: 1,
    borderRadius: 14, padding: 16, gap: 4,
  },
  boostKicker: {
    color: T.copper, fontSize: 11, fontWeight: '700',
    letterSpacing: 1.4, textTransform: 'uppercase',
  },
  boostText: { color: T.ink, fontSize: 14.5, lineHeight: 21, marginTop: 4 },
  boostGain: { color: T.copper, fontSize: 18, fontWeight: '700', marginTop: 6 },

  split: {
    backgroundColor: T.surface, borderColor: T.line, borderWidth: 1,
    borderRadius: 14, padding: 16, gap: 4,
  },
  splitKicker: {
    color: T.ink3, fontSize: 11, fontWeight: '700',
    letterSpacing: 1.4, textTransform: 'uppercase',
  },
  splitTotal: { color: T.teal, fontSize: 24, fontWeight: '700', marginTop: 2 },
  splitRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    gap: 12, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: T.line2,
  },
  splitName: { color: T.ink2, fontSize: 14, flex: 1 },
  splitAmount: { color: T.ink, fontSize: 15, fontWeight: '700' },

  restLabel: { marginTop: 14 },
  row: {
    backgroundColor: T.surface2, borderColor: T.line2, borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowBoost: {
    color: T.copper, fontSize: 12.5, lineHeight: 18, marginTop: 9,
    paddingTop: 9, borderTopWidth: 1, borderTopColor: T.line2,
  },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { color: T.ink, fontSize: 15, fontWeight: '600' },
  rowIssuer: { color: T.ink3, fontSize: 12, marginTop: 1 },
  rowRight: { alignItems: 'flex-end' },
  rowReward: { color: T.ink, fontSize: 15, fontWeight: '700' },
  rowRate: { color: T.ink3, fontSize: 12, marginTop: 1 },

  footnote: { color: T.ink3, fontSize: 11.5, lineHeight: 17, marginTop: 8 },
});
