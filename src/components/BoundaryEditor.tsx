import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import type { GraphBounds } from '../lib/types';
import { Colors, Spacing, FontSize } from '../lib/theme';

interface Props {
  initial?: Partial<GraphBounds>;
  onSave: (bounds: GraphBounds) => void;
}

type Draft = {
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
  startDate: string;
  endDate: string;
  unit: 'ft' | 'm';
};

export function BoundaryEditor({ initial, onSave }: Props) {
  const [draft, setDraft] = useState<Draft>({
    xMin: String(initial?.xMin ?? '0'),
    xMax: String(initial?.xMax ?? '365'),
    yMin: String(initial?.yMin ?? '0'),
    yMax: String(initial?.yMax ?? '10'),
    startDate: initial?.startDate ?? '',
    endDate: initial?.endDate ?? '',
    unit: initial?.unit ?? 'ft',
  });
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof Draft, val: string) => setDraft((d) => ({ ...d, [key]: val }));

  const handleSave = () => {
    const xMin = parseFloat(draft.xMin);
    const xMax = parseFloat(draft.xMax);
    const yMin = parseFloat(draft.yMin);
    const yMax = parseFloat(draft.yMax);

    if ([xMin, xMax, yMin, yMax].some(isNaN)) {
      setError('All numeric fields are required.');
      return;
    }
    if (xMax <= xMin) {
      setError('X max must be greater than X min.');
      return;
    }
    if (yMax <= yMin) {
      setError('Y max must be greater than Y min.');
      return;
    }
    if (!draft.startDate || !draft.endDate) {
      setError('Start and end dates are required (YYYY-MM-DD).');
      return;
    }
    setError(null);

    // originPx / farPx will already be set by the parent from GraphCanvas taps;
    // we pass zeros here because BoundaryEditor only handles the numeric values.
    onSave({
      originPx: initial?.originPx ?? { x: 0, y: 0 },
      farPx: initial?.farPx ?? { x: 0, y: 0 },
      xMin,
      xMax,
      yMin,
      yMax,
      startDate: draft.startDate,
      endDate: draft.endDate,
      unit: draft.unit,
    });
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Axis Boundaries</Text>
      <Text style={styles.hint}>
        Match these values to the axis labels printed on the chart paper.
      </Text>

      <View style={styles.row}>
        <Field label="X min (day / value)" value={draft.xMin} onChangeText={(v) => set('xMin', v)} />
        <Field label="X max" value={draft.xMax} onChangeText={(v) => set('xMax', v)} />
      </View>

      <View style={styles.row}>
        <Field label={`Y min (stage, ${draft.unit})`} value={draft.yMin} onChangeText={(v) => set('yMin', v)} />
        <Field label={`Y max (stage, ${draft.unit})`} value={draft.yMax} onChangeText={(v) => set('yMax', v)} />
      </View>

      <Text style={styles.label}>Date range</Text>
      <View style={styles.row}>
        <Field label="Start date (YYYY-MM-DD)" value={draft.startDate} onChangeText={(v) => set('startDate', v)} />
        <Field label="End date (YYYY-MM-DD)" value={draft.endDate} onChangeText={(v) => set('endDate', v)} />
      </View>

      <Text style={styles.label}>Unit</Text>
      <View style={styles.unitRow}>
        {(['ft', 'm'] as const).map((u) => (
          <TouchableOpacity
            key={u}
            style={[styles.unitBtn, draft.unit === u && styles.unitBtnActive]}
            onPress={() => set('unit', u)}
          >
            <Text style={[styles.unitBtnText, draft.unit === u && styles.unitBtnTextActive]}>
              {u === 'ft' ? 'Feet (ft)' : 'Metres (m)'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
        <Text style={styles.saveBtnText}>Apply Boundaries</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={Colors.textMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: { padding: Spacing.md, paddingBottom: 40 },
  heading: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.md },
  row: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  field: { flex: 1 },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginTop: Spacing.sm, marginBottom: 4 },
  fieldLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: FontSize.md,
    color: Colors.text,
    backgroundColor: Colors.surface,
  },
  unitRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  unitBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  unitBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  unitBtnText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  unitBtnTextActive: { color: '#fff', fontWeight: '700' },
  error: { color: Colors.error, fontSize: FontSize.sm, marginTop: Spacing.sm },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  saveBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: '700' },
});
