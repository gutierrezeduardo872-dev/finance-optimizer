/* ===========================================================================
   Norte — inicio
   ---------------------------------------------------------------------------
   Las otras tres pantallas contestan preguntas que el usuario hace. Esta
   contesta la que no sabe que tiene: qué está dejando sobre la mesa ahora
   mismo.

   El orden no es por tamaño de la cifra, es por lo que cuesta cobrarla:

     1. Boosts sin cumplir. Ya tienes la cuenta; solo falta una condición.
     2. Reallocar. Mover dinero entre cuentas que ya son tuyas, sin abrir nada.
     3. Abrir una cuenta.
     4. Sacar una tarjeta.

   Poner primero la ganancia más grande sería el orden equivocado: sugerir un
   producto nuevo antes de haber exprimido lo que ya trae convierte al asesor
   en un catálogo.
   =========================================================================== */

import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  boostOpportunity, heldAccounts, mxn, newAccountPicks, newCardPicks, pct, portfolio,
} from '@core/index.js';
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

export default function Home() {
  const { db, userId } = useNorte();

  const p = useMemo(() => portfolio(db, userId), [db, userId]);

  /* Boosts sin cumplir sobre lo que ya tiene. Es la única categoría de consejo
     que no le pide abrir nada ni mover nada. */
  const boosts = useMemo(() => {
    return heldAccounts(db, userId)
      .map((a: any) => {
        const op = boostOpportunity(db, userId, a, Number(a.current_balance) || 0);
        return op ? { acct: a, op } : null;
      })
      .filter(Boolean)
      .sort((x: any, y: any) => y.op.extraPerYear - x.op.extraPerYear);
  }, [db, userId]);

  const acctPicks = useMemo(() => newAccountPicks(db, userId), [db, userId]);
  const cardPicks = useMemo(() => newCardPicks(db, userId), [db, userId]);

  const realloc = acctPicks.find((x: any) => x.type === 'reallocation');
  const newAccounts = acctPicks.filter((x: any) => x.type === 'account').slice(0, 2);
  const closes = acctPicks.filter((x: any) => x.type === 'close');

  const totalOnTable =
    boosts.reduce((s: number, b: any) => s + b.op.extraPerYear, 0) +
    (realloc?.uplift || 0) +
    (newAccounts[0]?.upliftOverBest || 0) +
    (cardPicks[0]?.uplift || 0) * 12;

  const nothing =
    boosts.length === 0 && !realloc && newAccounts.length === 0 &&
    cardPicks.length === 0 && closes.length === 0;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll}>

        <Text style={s.kicker}>Tu norte</Text>
        <Text style={s.h1}>
          {nothing ? 'Todo en orden' : 'Estás dejando dinero en la mesa'}
        </Text>

        <View style={s.hero}>
          <View style={s.heroRow}>
            <View style={s.heroCell}>
              <Text style={s.heroLabel}>Hoy ganas</Text>
              <Text style={s.heroValue}>{mxn(p.projYield)}</Text>
              <Text style={s.heroSub}>al año, {pct(p.avgRate)} sobre {mxn(p.balance)}</Text>
            </View>
            {totalOnTable > 1 ? (
              <View style={s.heroCell}>
                <Text style={s.heroLabel}>Podrías ganar</Text>
                <Text style={[s.heroValue, { color: T.copper }]}>
                  +{mxn(totalOnTable)}
                </Text>
                <Text style={s.heroSub}>más al año, con lo de abajo</Text>
              </View>
            ) : null}
          </View>
        </View>

        {nothing ? (
          <Text style={s.empty}>
            Con los productos que traes y lo que gastas, no hay nada mejor disponible
            en los datos que tenemos. Eso puede cambiar cuando cambien las tasas.
          </Text>
        ) : null}

        {boosts.length > 0 && (
          <Section
            title="Sin abrir nada"
            note="Ya tienes estas cuentas. Solo falta cumplir una condición."
          >
            {boosts.map(({ acct, op }: any) => (
              <View key={acct.account_id} style={[s.item, s.itemCopper]}>
                <Text style={s.itemGain}>+{mxn(op.extraPerYear)} al año</Text>
                <Text style={s.itemName}>{acct.display_name}</Text>
                <Text style={s.itemBody}>
                  Pasa de {pct(op.currentRate)} a {pct(op.potentialRate)} al{' '}
                  {CONDITION_LABEL[op.conditionType] || op.conditionType}
                  {op.conditionAmount ? ` ${mxn(op.conditionAmount)}` : ''}
                  {op.maxBalance ? `, sobre los primeros ${mxn(op.maxBalance)}` : ''}.
                </Text>
              </View>
            ))}
          </Section>
        )}

        {realloc && (
          <Section
            title="Mover lo que ya tienes"
            note="Mismo dinero, mismas cuentas, distinta repartición."
          >
            <View style={[s.item, s.itemTeal]}>
              <Text style={[s.itemGain, { color: T.teal }]}>
                +{mxn(realloc.uplift)} al año
              </Text>
              <Text style={s.itemBody}>
                De {mxn(realloc.currentYield)} a {mxn(realloc.optimisedYield)} al año
                sobre los mismos {mxn(realloc.total)}.
              </Text>
              {realloc.moves
                .filter((m: any) => m.delta !== 0)
                .map((m: any) => (
                  <View key={m.acct.account_id} style={s.move}>
                    <Text style={s.moveName} numberOfLines={1}>{m.acct.display_name}</Text>
                    <Text style={[s.moveDelta, { color: m.delta > 0 ? T.teal : T.ink3 }]}>
                      {m.delta > 0 ? '+' : ''}{mxn(m.delta)}
                    </Text>
                  </View>
                ))}
            </View>
          </Section>
        )}

        {closes.length > 0 && (
          <Section
            title="Dejar de pagar"
            note="Cuentas que se quedarían vacías y siguen cobrando manejo."
          >
            {closes.map((c: any) => (
              <View key={c.acct.account_id} style={[s.item, s.itemCopper]}>
                <Text style={s.itemGain}>+{mxn(c.uplift)} al año</Text>
                <Text style={s.itemName}>{c.acct.display_name}</Text>
                <Text style={s.itemBody}>
                  Cobra {mxn(c.monthlyFee)} al mes y no le corresponde saldo.
                </Text>
              </View>
            ))}
          </Section>
        )}

        {newAccounts.length > 0 && (
          <Section title="Abrir una cuenta" note="Además de reacomodar lo que ya traes.">
            {newAccounts.map((a: any) => (
              <View key={a.acct.account_id} style={s.item}>
                <Text style={[s.itemGain, { color: T.teal }]}>
                  +{mxn(a.upliftOverBest)} al año
                </Text>
                <Text style={s.itemName}>{a.acct.display_name}</Text>
                <Text style={s.itemIssuer}>{issuerName(a.acct.issuer_id)}</Text>
                <Text style={s.itemBody}>
                  Mandarías {mxn(a.suggestedAmount)} y rendirían {pct(a.rate)}
                  {a.headlineRate > a.rate
                    ? ` (anuncia ${pct(a.headlineRate)}, pero no sobre todo el saldo)`
                    : ''}
                  .
                </Text>
                {a.insuranceScheme === 'none' ? (
                  <Text style={s.itemWarn}>Sin seguro de depósito.</Text>
                ) : null}
                {a.locked ? <Text style={s.itemWarn}>A plazo forzoso.</Text> : null}
              </View>
            ))}
          </Section>
        )}

        {cardPicks.length > 0 && (
          <Section
            title="Sacar una tarjeta"
            note="Calculado sobre lo que ya gastas, no sobre un gasto hipotético."
          >
            {cardPicks.slice(0, 2).map((c: any) => (
              <View key={c.card.card_id} style={s.item}>
                <Text style={[s.itemGain, { color: T.teal }]}>
                  +{mxn(c.uplift * 12)} al año
                </Text>
                <Text style={s.itemName}>{c.card.display_name}</Text>
                <Text style={s.itemIssuer}>{issuerName(c.card.issuer_id)}</Text>
                {c.reasons.slice(0, 3).map((r: any) => (
                  <Text key={r.cat} style={s.itemBody}>
                    {r.cat}: {pct(r.rate)} sobre los {mxn(r.spend)} que ya gastas ahí,
                    {' '}+{mxn(r.gain)}.
                  </Text>
                ))}
                {c.fee > 0 ? (
                  <Text style={s.itemWarn}>
                    Cuesta {mxn(c.fee)} al año, ya descontado de la cifra de arriba.
                  </Text>
                ) : null}
              </View>
            ))}
          </Section>
        )}

        <Text style={s.footnote}>
          Todo lo de arriba se calcula sobre lo que realmente gastas y el saldo que
          realmente traes. Nada asume un gasto que no has hecho.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, note, children }: any) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <Text style={s.sectionNote}>{note}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.canvas },
  scroll: { padding: 20, paddingBottom: 48 },

  kicker: {
    color: T.ink3, fontSize: 12, fontWeight: '600',
    letterSpacing: 1.4, textTransform: 'uppercase',
  },
  h1: { color: T.ink, fontSize: 29, fontWeight: '700', letterSpacing: -0.5, marginBottom: 16 },

  hero: {
    backgroundColor: T.surface, borderColor: T.line, borderWidth: 1,
    borderRadius: 16, padding: 16,
  },
  heroRow: { flexDirection: 'row', gap: 18 },
  heroCell: { flex: 1 },
  heroLabel: {
    color: T.ink3, fontSize: 10, fontWeight: '600',
    letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: 3,
  },
  heroValue: { color: T.ink, fontSize: 25, fontWeight: '700' },
  heroSub: { color: T.ink3, fontSize: 11.5, marginTop: 3, lineHeight: 16 },

  section: { marginTop: 26 },
  sectionTitle: { color: T.ink, fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  sectionNote: { color: T.ink3, fontSize: 12.5, marginTop: 2, marginBottom: 10, lineHeight: 18 },

  item: {
    backgroundColor: T.surface, borderColor: T.line, borderWidth: 1,
    borderRadius: 14, padding: 15, marginBottom: 8,
  },
  itemCopper: { borderColor: T.copper, backgroundColor: T.copperSoft },
  itemTeal: { borderColor: T.teal },
  itemGain: { color: T.copper, fontSize: 19, fontWeight: '700', marginBottom: 5 },
  itemName: { color: T.ink, fontSize: 15.5, fontWeight: '600' },
  itemIssuer: { color: T.ink3, fontSize: 12, marginTop: 1 },
  itemBody: { color: T.ink2, fontSize: 13, lineHeight: 19, marginTop: 6 },
  itemWarn: { color: T.copper, fontSize: 12.5, lineHeight: 18, marginTop: 6 },

  move: {
    flexDirection: 'row', justifyContent: 'space-between', gap: 12,
    marginTop: 9, paddingTop: 9, borderTopWidth: 1, borderTopColor: T.line2,
  },
  moveName: { color: T.ink2, fontSize: 13.5, flex: 1 },
  moveDelta: { fontSize: 14, fontWeight: '700' },

  empty: { color: T.ink2, fontSize: 14, lineHeight: 21, marginTop: 16 },
  footnote: { color: T.ink3, fontSize: 11.5, lineHeight: 17, marginTop: 24 },
});
