/* ===========================================================================
   Norte — asesor de tarjeta, primera pantalla nativa
   ---------------------------------------------------------------------------
   El objetivo de esta pantalla no es verse bien todavía. Es contestar una
   pregunta: ¿corre el motor de core/ en un iPhone y da los mismos números que
   la web?

   Por eso el usuario, los productos y los movimientos son idénticos al
   fixture de tools/golden.mjs. Si el resultado aquí no coincide con
   tools/golden.json, el puerto está mal y hay que saberlo ahora y no en la
   Fase 4 con cinco pantallas encima.
   =========================================================================== */

import { useMemo, useState } from 'react';
import {
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ccRecommend, mxn, mxn2, pct, shortIssuer } from '@core/index.js';
import { CATEGORIES, db, issuerName, USER_ID } from '@/norte/data';
import { T } from '@/norte/theme';

export default function CardAdvisor() {
  const [category, setCategory] = useState('supermarket');
  const [raw, setRaw] = useState('2500');

  const amount = Number(String(raw).replace(/[^0-9.]/g, '')) || 0;

  const result = useMemo(
    () => ccRecommend(db, USER_ID, category, amount, {}),
    [category, amount],
  );

  const best = result.best;
  const rest = result.ranked.slice(1);

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        <Text style={s.kicker}>Asesor de tarjeta</Text>
        <Text style={s.h1}>¿Con cuál pago?</Text>

        <View style={s.field}>
          <Text style={s.label}>Monto</Text>
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

        <Text style={s.label}>Categoría</Text>
        <View style={s.chips}>
          {CATEGORIES.map((c) => {
            const on = c.category_key === category;
            return (
              <TouchableOpacity
                key={c.category_key}
                onPress={() => setCategory(c.category_key)}
                style={[s.chip, on && s.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[s.chipText, on && s.chipTextOn]}>{c.display_label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {best ? (
          <View style={s.winner}>
            <Text style={s.winnerKicker}>Usa esta</Text>
            <Text style={s.winnerName}>{best.card.display_name}</Text>
            <Text style={s.winnerIssuer}>{shortIssuer(issuerName(best.card.issuer_id))}</Text>

            <View style={s.winnerRow}>
              <View>
                <Text style={s.metricLabel}>Ganas</Text>
                <Text style={s.metricBig}>{mxn2(best.reward + best.perkValue)}</Text>
              </View>
              <View>
                <Text style={s.metricLabel}>Tasa</Text>
                <Text style={s.metricBig}>{pct(best.rate)}</Text>
              </View>
            </View>

            {best.capped ? (
              <Text style={s.note}>Tope alcanzado este mes. Queda {mxn2(best.capRemaining)}.</Text>
            ) : null}
            {best.pointsEstimated ? (
              <Text style={s.note}>Valor en puntos estimado, no publicado por el emisor.</Text>
            ) : null}
          </View>
        ) : (
          <View style={s.winner}>
            <Text style={s.winnerName}>Sin recomendación</Text>
            <Text style={s.note}>
              Ninguna de tus tarjetas tiene datos suficientes para esta categoría.
            </Text>
          </View>
        )}

        {rest.length > 0 && (
          <>
            <Text style={[s.label, s.restLabel]}>El resto</Text>
            {rest.map((r: any) => (
              <View key={r.card.card_id} style={s.row}>
                <View style={s.rowMain}>
                  <Text style={s.rowName} numberOfLines={1}>{r.card.display_name}</Text>
                  <Text style={s.rowIssuer}>{shortIssuer(issuerName(r.card.issuer_id))}</Text>
                </View>
                <View style={s.rowRight}>
                  <Text style={s.rowReward}>{mxn2(r.reward + r.perkValue)}</Text>
                  <Text style={s.rowRate}>{pct(r.rate)}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {result.unvaluable.length > 0 && (
          <Text style={s.footnote}>
            {result.unvaluable.length} tarjeta(s) fuera de la comparación: el emisor no publica
            lo suficiente para ponerles precio. Un cero conocido gana a un desconocido.
          </Text>
        )}

        <Text style={s.footnote}>
          Datos: {db.cards.length} tarjetas, {db.accounts.length} cuentas.
          Cartera de prueba de {db.userProducts.filter((p: any) => p.product_type === 'card').length} tarjetas,
          la misma del golden. Gasto del mes ya considerado: {mxn(2500)} aprox.
        </Text>

      </ScrollView>
    </SafeAreaView>
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

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: T.surface2, borderColor: T.line2, borderWidth: 1,
    borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8,
  },
  chipOn: { backgroundColor: T.copperSoft, borderColor: T.copper },
  chipText: { color: T.ink2, fontSize: 13, fontWeight: '500' },
  chipTextOn: { color: T.copper, fontWeight: '700' },

  winner: {
    backgroundColor: T.surface, borderColor: T.copper, borderWidth: 1,
    borderRadius: 16, padding: 18, gap: 4, marginTop: 6,
  },
  winnerKicker: {
    color: T.copper, fontSize: 11, fontWeight: '700',
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

  restLabel: { marginTop: 14 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: T.surface2, borderColor: T.line2, borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { color: T.ink, fontSize: 15, fontWeight: '600' },
  rowIssuer: { color: T.ink3, fontSize: 12, marginTop: 1 },
  rowRight: { alignItems: 'flex-end' },
  rowReward: { color: T.ink, fontSize: 15, fontWeight: '700' },
  rowRate: { color: T.ink3, fontSize: 12, marginTop: 1 },

  footnote: { color: T.ink3, fontSize: 11.5, lineHeight: 17, marginTop: 8 },
});
