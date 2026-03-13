import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { GraphCanvas, type CanvasMode } from '../../src/components/GraphCanvas';
import { BoundaryEditor } from '../../src/components/BoundaryEditor';
import { getSessions, saveSession } from '../../src/lib/storage';
import { interpolateDailyValues } from '../../src/lib/digitizer';
import type { DigiSession, GraphBounds, DigiPoint } from '../../src/lib/types';
import { Colors, Spacing, FontSize } from '../../src/lib/theme';

export default function DigitizeScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<DigiSession | null>(null);
  const [mode, setMode] = useState<CanvasMode>('idle');
  const [showBoundaryEditor, setShowBoundaryEditor] = useState(false);
  const [pendingOrigin, setPendingOrigin] = useState<{ x: number; y: number } | null>(null);
  const [pendingFar, setPendingFar] = useState<{ x: number; y: number } | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const sessions = await getSessions();
        const found = sessions.find((s) => s.id === sessionId) ?? null;
        setSession(found);
      })();
    }, [sessionId]),
  );

  const updateSession = async (updates: Partial<DigiSession>) => {
    if (!session) return;
    const updated = { ...session, ...updates };
    setSession(updated);
    await saveSession(updated);
  };

  // Step 1: user taps origin corner
  const handleOriginSet = (px: { x: number; y: number }) => {
    setPendingOrigin(px);
    setMode('setFar');
  };

  // Step 2: user taps far corner → open value editor
  const handleFarSet = (px: { x: number; y: number }) => {
    setPendingFar(px);
    setMode('idle');
    setShowBoundaryEditor(true);
  };

  // Step 3: user fills in axis values
  const handleBoundsSave = async (bounds: GraphBounds) => {
    const finalBounds: GraphBounds = {
      ...bounds,
      originPx: pendingOrigin ?? session?.bounds?.originPx ?? { x: 0, y: 0 },
      farPx: pendingFar ?? session?.bounds?.farPx ?? { x: 100, y: 100 },
    };
    setShowBoundaryEditor(false);
    setPendingOrigin(null);
    setPendingFar(null);
    await updateSession({ bounds: finalBounds, status: 'bounded' });
    setMode('digitize');
  };

  const handlePointAdded = async (point: DigiPoint) => {
    if (!session) return;
    const points = [...(session.points ?? []), point];
    await updateSession({ points, status: 'digitized' });
  };

  const handlePointRemoved = async (index: number) => {
    if (!session) return;
    const points = [...(session.points ?? [])];
    points.splice(index, 1);
    await updateSession({ points });
  };

  const handleExport = async () => {
    if (!session?.bounds || !session.points || session.points.length < 2) {
      Alert.alert('Not ready', 'Set boundaries and add at least 2 points before exporting.');
      return;
    }
    const records = interpolateDailyValues(session.points, session.bounds);
    if (records.length === 0) {
      Alert.alert('No data', 'Interpolation produced no records. Check boundaries and points.');
      return;
    }
    router.push(`/export/${session.id}`);
  };

  if (!session) {
    return (
      <View style={styles.centered}>
        <Text>Loading session…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Canvas */}
      <View style={styles.canvas}>
        <GraphCanvas
          imageUri={session.imageUri}
          mode={mode}
          bounds={session.bounds}
          points={session.points ?? []}
          onOriginSet={handleOriginSet}
          onFarSet={handleFarSet}
          onPointAdded={handlePointAdded}
          onPointRemoved={handlePointRemoved}
        />
      </View>

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbarInner}>
          <ToolBtn
            label="Set Bounds"
            active={mode === 'setOrigin' || mode === 'setFar'}
            onPress={() => {
              setMode('setOrigin');
            }}
          />
          <ToolBtn
            label="Digitize"
            active={mode === 'digitize'}
            disabled={!session.bounds}
            onPress={() => setMode('digitize')}
          />
          <ToolBtn
            label={`Points: ${session.points?.length ?? 0}`}
            active={false}
            onPress={() => {
              Alert.alert(
                'Clear Points',
                'Remove all digitized points?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Clear', style: 'destructive', onPress: () => updateSession({ points: [] }) },
                ],
              );
            }}
          />
          <ToolBtn label="Edit Values" active={false} onPress={() => setShowBoundaryEditor(true)} />
          <ToolBtn
            label="Export CSV"
            active={false}
            highlight
            disabled={!session.bounds || (session.points?.length ?? 0) < 2}
            onPress={handleExport}
          />
        </ScrollView>
      </View>

      {/* Boundary editor modal */}
      <Modal visible={showBoundaryEditor} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Set Axis Values</Text>
          <TouchableOpacity onPress={() => setShowBoundaryEditor(false)}>
            <Text style={styles.modalClose}>Cancel</Text>
          </TouchableOpacity>
        </View>
        <BoundaryEditor initial={session.bounds} onSave={handleBoundsSave} />
      </Modal>
    </View>
  );
}

function ToolBtn({
  label,
  active,
  highlight,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  highlight?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.toolBtn,
        active && styles.toolBtnActive,
        highlight && styles.toolBtnHighlight,
        disabled && styles.toolBtnDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text
        style={[
          styles.toolBtnText,
          active && styles.toolBtnTextActive,
          highlight && styles.toolBtnTextHighlight,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  canvas: { flex: 1 },
  toolbar: {
    backgroundColor: Colors.primaryDark,
    paddingVertical: Spacing.sm,
  },
  toolbarInner: { paddingHorizontal: Spacing.sm, gap: Spacing.xs, flexDirection: 'row' },
  toolBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  toolBtnActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.accent },
  toolBtnHighlight: { backgroundColor: Colors.success, borderColor: Colors.success },
  toolBtnDisabled: { opacity: 0.35 },
  toolBtnText: { color: 'rgba(255,255,255,0.8)', fontSize: FontSize.sm },
  toolBtnTextActive: { color: '#fff', fontWeight: '700' },
  toolBtnTextHighlight: { color: '#fff', fontWeight: '700' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.primary,
    padding: Spacing.md,
  },
  modalTitle: { color: '#fff', fontSize: FontSize.lg, fontWeight: '700' },
  modalClose: { color: Colors.accent, fontSize: FontSize.md },
});
