import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import type { GraphBounds } from '../lib/types';
import { Colors, Spacing, FontSize } from '../lib/theme';

/** Inputs for simplified chart calibration. */
export interface BoundaryValues {
  startDateTime: string;
  startStageFt: number;
  useAdvancedCalibration: boolean;
  xStartDateTime?: string;
  xEndDateTime?: string;
  yRefStageFt?: number;
}

interface Props {
  initial?: Partial<GraphBounds>;
  defaultUseAdvancedCalibration?: boolean;
  calibrationPointStatus?: {
    xStart: boolean;
    xEnd: boolean;
    yRef: boolean;
  };
  onPickCalibrationPoints?: () => void;
  onSave: (values: BoundaryValues) => void;
  onCancel: () => void;
}

type Draft = {
  startDateTime: string;
  startStageFt: string;
  useAdvancedCalibration: boolean;
  xStartDateTime: string;
  xEndDateTime: string;
  yRefStageFt: string;
};

export function BoundaryEditor({
  initial,
  defaultUseAdvancedCalibration,
  calibrationPointStatus,
  onPickCalibrationPoints,
  onSave,
  onCancel,
}: Props) {
  const [draft, setDraft] = useState<Draft>({
    startDateTime: initial?.startDate ?? '',
    startStageFt: initial?.yMin != null ? String(initial.yMin) : '',
    useAdvancedCalibration: Boolean(defaultUseAdvancedCalibration),
    xStartDateTime: initial?.startDate ?? '',
    xEndDateTime: initial?.endDate ?? '',
    yRefStageFt: initial?.yMin != null ? String(initial.yMin) : '',
  });
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof Draft, val: string) => setDraft((d) => ({ ...d, [key]: val }));
  const pointStatus = calibrationPointStatus ?? { xStart: false, xEnd: false, yRef: false };

  const handleSave = () => {
    const startStageFt = parseFloat(draft.startStageFt);
    const startTs = Date.parse(draft.startDateTime);

    if (isNaN(startStageFt)) {
      setError('Starting stage height is required.');
      return;
    }
    if (!draft.startDateTime || Number.isNaN(startTs)) {
      setError('Start time is required. Use YYYY-MM-DD HH:mm.');
      return;
    }

    const payload: BoundaryValues = {
      startDateTime: draft.startDateTime,
      startStageFt,
      useAdvancedCalibration: draft.useAdvancedCalibration,
    };

    if (draft.useAdvancedCalibration) {
      const xStartTs = Date.parse(draft.xStartDateTime);
      const xEndTs = Date.parse(draft.xEndDateTime);
      const yRefStageFt = parseFloat(draft.yRefStageFt);
      if (!draft.xStartDateTime || Number.isNaN(xStartTs)) {
        setError('Advanced mode: known X start time is required.');
        return;
      }
      if (!draft.xEndDateTime || Number.isNaN(xEndTs)) {
        setError('Advanced mode: known X end time is required.');
        return;
      }
      if (xEndTs <= xStartTs) {
        setError('Advanced mode: known X end time must be after X start time.');
        return;
      }
      if (Number.isNaN(yRefStageFt)) {
        setError('Advanced mode: known Y stage value is required.');
        return;
      }
      payload.xStartDateTime = draft.xStartDateTime;
      payload.xEndDateTime = draft.xEndDateTime;
      payload.yRefStageFt = yRefStageFt;
    }

    setError(null);
    onSave(payload);
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {/* Bottom-sheet handle */}
      <View style={styles.handle} />

      <View style={styles.headerRow}>
        <Text style={styles.heading}>Graph Calibration</Text>
        <TouchableOpacity onPress={onCancel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.hint}>
        Enter chart start time and starting stage height. The app auto-detects graph-paper spacing to compute
        the x/y scale: 4 hours per small box and 0.1 ft per small box.
      </Text>

      <View style={styles.row}>
        <Field
          label="Start time (YYYY-MM-DD HH:mm)"
          value={draft.startDateTime}
          onChangeText={(v) => set('startDateTime', v)}
          placeholder="2026-03-13 00:00"
          keyboardType="default"
        />
      </View>

      <View style={styles.row}>
        <Field
          label="Starting stage height (ft)"
          value={draft.startStageFt}
          onChangeText={(v) => set('startStageFt', v)}
          placeholder="e.g. 2.50"
        />
      </View>

      <View style={styles.scaleCard}>
        <Text style={styles.scaleTitle}>Chart Scale</Text>
        <Text style={styles.scaleText}>Fine line: 4 hours (x), 0.1 ft (y)</Text>
        <Text style={styles.scaleText}>Bold line: 1 day (x), 1.0 ft (y)</Text>
      </View>

      <View style={styles.advancedCard}>
        <TouchableOpacity
          style={styles.advancedToggle}
          onPress={() => setDraft((d) => ({ ...d, useAdvancedCalibration: !d.useAdvancedCalibration }))}
        >
          <Text style={styles.advancedTitle}>Advanced Calibration</Text>
          <Text style={styles.advancedToggleState}>
            {draft.useAdvancedCalibration ? 'On' : 'Off'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.advancedHint}>
          Optional fallback when auto-scale is off. Pick 3 reference points: X start, X end, and known Y value.
        </Text>

        {draft.useAdvancedCalibration ? (
          <>
            <TouchableOpacity style={styles.pickBtn} onPress={onPickCalibrationPoints}>
              <Text style={styles.pickBtnText}>Pick / Re-pick 3 Reference Points</Text>
            </TouchableOpacity>
            <Text style={styles.pointStatusText}>
              X start: {pointStatus.xStart ? 'set' : 'missing'}  |  X end: {pointStatus.xEnd ? 'set' : 'missing'}  |  Y ref: {pointStatus.yRef ? 'set' : 'missing'}
            </Text>

            <View style={styles.row}>
              <Field
                label="Known X start time (YYYY-MM-DD HH:mm)"
                value={draft.xStartDateTime}
                onChangeText={(v) => set('xStartDateTime', v)}
                placeholder="2026-03-13 00:00"
                keyboardType="default"
              />
            </View>
            <View style={styles.row}>
              <Field
                label="Known X end time (YYYY-MM-DD HH:mm)"
                value={draft.xEndDateTime}
                onChangeText={(v) => set('xEndDateTime', v)}
                placeholder="2026-03-20 00:00"
                keyboardType="default"
              />
            </View>
            <View style={styles.row}>
              <Field
                label="Known Y stage at Y reference point (ft)"
                value={draft.yRefStageFt}
                onChangeText={(v) => set('yRefStageFt', v)}
                placeholder="e.g. 2.50"
              />
            </View>
          </>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
        <Text style={styles.saveBtnText}>Apply</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'decimal-pad',
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'decimal-pad' | 'default';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexShrink: 1 },
  container: { padding: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 32 : Spacing.lg },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  heading: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  cancelText: { fontSize: FontSize.md, color: Colors.accent },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.md },
  row: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  field: { flex: 1 },
  fieldLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: FontSize.md,
    color: Colors.text,
    backgroundColor: Colors.surfaceDim,
  },
  scaleCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceDim,
    borderRadius: 8,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  scaleTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, marginBottom: 2 },
  scaleText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  advancedCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  advancedToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  advancedTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  advancedToggleState: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.primary,
  },
  advancedHint: {
    marginTop: 6,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  pickBtn: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  pickBtnText: {
    color: '#fff',
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  pointStatusText: {
    marginTop: 8,
    marginBottom: 6,
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
  },
  error: { color: Colors.error, fontSize: FontSize.sm, marginBottom: Spacing.sm },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  saveBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: '700' },
});
