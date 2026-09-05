/* ===========================================================================
   Norte — mis productos
   ---------------------------------------------------------------------------
   Qué traes y qué te cuesta traerlo.

   El encabezado enseña dos cifras de costo, no una, y esa separación es
   deliberada. La anualidad sola subestima lo que cuesta una cartera: hay
   tarjetas facturadas a $0 al año que cobran una penalización mensual si no
   gastas un mínimo, y sumadas a la anualidad aparecerían como gratuitas.
   Meterlas en el mismo número le cobraría de más a quien sí cumple sus
   umbrales, así que la exposición se reporta aparte.

   Agregar y quitar productos vive en memoria por ahora. Cuando entre auth,
   esto escribe a Supabase y no cambia nada de esta pantalla, porque ya pide
   todo al hook en vez de asumir quién está firmado.
   =========================================================================== */

import { useMemo, useState } from 'react';
import {
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { feeLabel, mxn, norm, pct, portfolio } from '@core/index.js';
import { issuerName } from '@/norte/data';
import { useNorte } from '@/norte/store';
import { T } from '@/norte/theme';

type Kind = 'card' | 'account';

export default function Products() {
  const { db, userId, isHeld, addProduct, removeProduct } = useNorte();
  const [kind, setKind] = useState<Kind>('card');
  const [query, setQuery] = useState('');

  const p = useMemo(() => portfolio(db, userId), [db, userId]);

  const all = kind === 'card' ? db.cards : db.accounts;
  const idOf = (x: any) => (kind === 'card' ? x.card_id : x.account_id);

  const mine = useMemo(
    () => all.filter((x: any) => isHeld(kind, idOf(x))),
    [all, kind, db.userProducts],
  );

  /* La búsqueda solo mira productos mapeados. Un esqueleto sin tasas ni
     comisiones no se puede puntuar, y ofrecerlo prometería un consejo que el
     motor no puede dar. */
  const results = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return null;
    return all
      .filter((x: any) => String(x.mapping_status).toLowerCase() === 'mapped')
      .filter((x: any) => !isHeld(kind, idOf(x)))
      .filter((x: any) =>
        norm(x.display_name).includes(q) ||
        norm(issuerName(x.issuer_id)).includes(q) ||
        norm(x.tier).includes(q))
      .slice(0, 25);
  }, [query, all, kind, db.userProducts]);

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        <Text style={s.kicker}>Mis productos</Text>
        <Text style={s.h1}>Lo que traes</Text>

        <View style={s.summary}>
          <View style={s.summaryRow}>
            <Metric label="Saldo total" value={mxn(p.balance)} />
            <Metric label="Rinde al año" value={mxn(p.projYield)} tone={T.teal} />
            <Metric label="Tasa media" value={pct(p.avgRate)} />
          </View>
          <View style={[s.summaryRow, s.summaryRowLast]}>
            <Metric label="Anualidades" value={mxn(p.fees)} tone={p.fees > 0 ? T.copper : undefined} />
            <Metric
              label="En riesgo"
              value={mxn(p.feesAtRisk)}
              tone={p.feesAtRisk > 0 ? T.copper : undefined}
            />
          </View>

          {p.penaltyCards.length > 0 ? (
            <Text style={s.summaryNote}>
              {p.penaltyCards.length === 1
                ? '1 tarjeta cobra'
                : `${p.penaltyCards.length} tarjetas cobran`}{' '}
              una penalización si no gastas un mínimo. Eso no entra en la anualidad,
              por eso va aparte: son hasta {mxn(p.feesAtRisk)} extra al año si dejas
              de usarlas.
            </Text>
          ) : null}
        </View>

        <View style={s.seg}>
          {(['card', 'account'] as Kind[]).map((k) => {
            const on = k === kind;
            return (
              <TouchableOpacity
                key={k}
                onPress={() => { setKind(k); setQuery(''); }}
                style={[s.segItem, on && s.segItemOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[s.segText, on && s.segTextOn]}>
                  {k === 'card' ? `Tarjetas (${p.cards.length})` : `Cuentas (${p.accts.length})`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {mine.map((x: any) => (
          <View key={idOf(x)} style={s.card}>
            <View style={s.cardTop}>
              <View style={s.cardMain}>
                <Text style={s.cardName}>{x.display_name}</Text>
                <Text style={s.cardIssuer}>{issuerName(x.issuer_id)}</Text>
              </View>
              <TouchableOpacity
                onPress={() => removeProduct(kind, idOf(x))}
                style={s.remove}
                accessibilityRole="button"
                accessibilityLabel={`Quitar ${x.display_name}`}
              >
                <Text style={s.removeText}>Quitar</Text>
              </TouchableOpacity>
            </View>
            {kind === 'card'
              ? <CardFacts card={x} />
              : <AccountFacts db={db} userId={userId} account={x} />}
          </View>
        ))}

        {mine.length === 0 ? (
          <Text style={s.empty}>
            No traes {kind === 'card' ? 'tarjetas' : 'cuentas'} todavía. Búscalas abajo.
          </Text>
        ) : null}

        <Text style={[s.label, s.addLabel]}>Agregar</Text>
        <TextInput
          style={s.search}
          value={query}
          onChangeText={setQuery}
          placeholder={kind === 'card' ? 'Buscar tarjeta o banco' : 'Buscar cuenta o banco'}
          placeholderTextColor={T.ink3}
          selectionColor={T.copper}
          autoCorrect={false}
          autoCapitalize="none"
        />

        {results?.map((x: any) => (
          <TouchableOpacity
            key={idOf(x)}
            style={s.result}
            onPress={() => { addProduct(kind, idOf(x)); setQuery(''); }}
            accessibilityRole="button"
          >
            <View style={s.cardMain}>
              <Text style={s.resultName} numberOfLines={1}>{x.display_name}</Text>
              <Text style={s.cardIssuer}>{issuerName(x.issuer_id)}</Text>
            </View>
            <Text style={s.add}>Agregar</Text>
          </TouchableOpacity>
        ))}

        {results?.length === 0 ? (
          <Text style={s.empty}>
            Nada con ese nombre entre los productos con datos verificados.
          </Text>
        ) : null}

      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={s.metric}>
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={[s.metricValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

function CardFacts({ card }: { card: any }) {
  /* feeLabel dice lo que la tarjeta cuesta de verdad, nunca solo la anualidad:
     una tarjeta sin anualidad con penalización por inactividad no es gratis.
     Devuelve { text, conditional }, y conditional marca justo esos casos, los
     que se pintan en cobre porque el costo depende de lo que hagas. */
  const fee = feeLabel(card);
  const cat = Number(card.cat_promedio_pct);
  return (
    <View style={s.facts}>
      <Fact label="Costo" value={fee.text} tone={fee.conditional ? T.copper : undefined} />
      <Fact label="CAT" value={Number.isFinite(cat) && cat > 0 ? pct(cat) : 'no publicado'} />
      <Fact label="Red" value={String(card.network || '').replace(/_/g, ' ') || 'no publicada'} />
    </View>
  );
}

function AccountFacts({ db, userId, account }: { db: any; userId: string; account: any }) {
  const held = db.userProducts.find(
    (p: any) => p.product_type === 'account' && p.product_id === account.account_id);
  const balance = Number(held?.current_balance || 0);
  return (
    <View style={s.facts}>
      <Fact label="Saldo" value={mxn(balance)} />
      <Fact
        label="Seguro"
        value={account.insurance_scheme === 'none' ? 'ninguno' : String(account.insurance_scheme)}
        tone={account.insurance_scheme === 'none' ? T.copper : undefined}
      />
      <Fact
        label="Liquidez"
        value={String(account.liquidity) === 'term_locked' ? 'a plazo' : 'inmediata'}
      />
    </View>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={s.fact}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={[s.factValue, tone ? { color: tone } : null]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.canvas },
  scroll: { padding: 20, paddingBottom: 48, gap: 12 },

  kicker: {
    color: T.ink3, fontSize: 12, fontWeight: '600',
    letterSpacing: 1.4, textTransform: 'uppercase',
  },
  h1: { color: T.ink, fontSize: 30, fontWeight: '700', letterSpacing: -0.5, marginBottom: 6 },
  label: {
    color: T.ink3, fontSize: 11, fontWeight: '600',
    letterSpacing: 1.2, textTransform: 'uppercase',
  },

  summary: {
    backgroundColor: T.surface, borderColor: T.line, borderWidth: 1,
    borderRadius: 16, padding: 16,
  },
  summaryRow: {
    flexDirection: 'row', gap: 8,
    paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: T.line2,
  },
  summaryRowLast: { paddingBottom: 0, paddingTop: 14, borderBottomWidth: 0 },
  metric: { flex: 1 },
  metricLabel: {
    color: T.ink3, fontSize: 10, fontWeight: '600',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 3,
  },
  metricValue: { color: T.ink, fontSize: 18, fontWeight: '700' },
  summaryNote: { color: T.copper, fontSize: 12.5, lineHeight: 18, marginTop: 14 },

  seg: {
    flexDirection: 'row', gap: 6, backgroundColor: T.surface2,
    borderRadius: 12, padding: 4, marginTop: 6,
  },
  segItem: { flex: 1, borderRadius: 9, paddingVertical: 9, alignItems: 'center' },
  segItemOn: { backgroundColor: T.surface3 },
  segText: { color: T.ink3, fontSize: 13.5, fontWeight: '600' },
  segTextOn: { color: T.ink },

  card: {
    backgroundColor: T.surface, borderColor: T.line, borderWidth: 1,
    borderRadius: 14, padding: 15,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardMain: { flex: 1, minWidth: 0 },
  cardName: { color: T.ink, fontSize: 16, fontWeight: '600' },
  cardIssuer: { color: T.ink3, fontSize: 12.5, marginTop: 1 },
  remove: {
    borderColor: T.line, borderWidth: 1, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  removeText: { color: T.ink3, fontSize: 12.5, fontWeight: '600' },

  facts: {
    flexDirection: 'row', gap: 14, marginTop: 13,
    paddingTop: 13, borderTopWidth: 1, borderTopColor: T.line2,
  },
  fact: { flex: 1 },
  factLabel: {
    color: T.ink3, fontSize: 9.5, fontWeight: '600',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2,
  },
  factValue: { color: T.ink2, fontSize: 13, fontWeight: '500', lineHeight: 18 },

  addLabel: { marginTop: 16 },
  search: {
    backgroundColor: T.surface2, borderColor: T.line, borderWidth: 1, borderRadius: 12,
    color: T.ink, fontSize: 16, paddingHorizontal: 14, paddingVertical: 12,
  },
  result: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: T.surface2, borderColor: T.line2, borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  resultName: { color: T.ink, fontSize: 14.5, fontWeight: '600' },
  add: { color: T.copper, fontSize: 13, fontWeight: '700' },

  empty: { color: T.ink3, fontSize: 13, lineHeight: 19, paddingVertical: 6 },
});
