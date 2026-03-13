import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { getSessions, getSites, saveSession } from '../../src/lib/storage';
import { interpolateDailyValues } from '../../src/lib/digitizer';
import { exportCsv } from '../../src/lib/csvExport';
import type { DigiSession, Site, DailyRecord } from '../../src/lib/types';
import { Colors, Spacing, FontSize } from '../../src/lib/theme';

export default function ExportScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [session, setSession] = useState<DigiSession | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [records, setRecords] = useState<DailyRecord[]>([]);
  const [exporting, setExporting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const sessions = await getSessions();
        const found = sessions.find((s) => s.id === sessionId) ?? null;
        setSession(found);
        if (found?.bounds && found.points && found.points.length >= 2) {
          const r = interpolateDailyValues(found.points, found.bounds);
          setRecords(r);
        }
        if (found) {
          const sites = await getSites();
          setSite(sites.find((s) => s.id === found.siteId) ?? null);
        }
      })();
    }, [sessionId]),
  );

  const handleExport = async () => {
    if (!session || !site || records.length === 0) return;
    setExporting(true);
    try {
      await exportCsv(records, site, session);
      await saveSession({ ...session, status: 'exported', exportedAt: new Date().toISOString() });
      Alert.alert('Export complete', `${records.length} daily records exported.`);
    } catch (err) {
      Alert.alert('Export failed', String(err));
    } finally {
      setExporting(false);
    }
  };

  if (!session) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Summary header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {site?.name ?? '—'} ({site?.siteCode ?? '—'})
        </Text>
        <Text style={styles.headerMeta}>
          {records.length} daily records • {session.bounds?.unit ?? 'ft'}
        </Text>
        {session.bounds ? (
          <Text style={styles.headerMeta}>
            {session.bounds.startDate} → {session.bounds.endDate}
          </Text>
        ) : null}
      </View>

      {/* Preview table */}
      <FlatList
        data={records}
        keyExtractor={(r) => r.date}
        ListHeaderComponent={
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCell, styles.tableCellHead]}>Date</Text>
            <Text style={[styles.tableCell, styles.tableCellHead, styles.tableCellRight]}>
              Stage ({records[0]?.unit ?? 'ft'})
            </Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <View style={[styles.tableRow, index % 2 === 0 && styles.tableRowAlt]}>
            <Text style={styles.tableCell}>{item.date}</Text>
            <Text style={[styles.tableCell, styles.tableCellRight]}>
              {item.stageHeight.toFixed(3)}
            </Text>
          </View>
        )}
        contentContainerStyle={{ paddingBottom: 100 }}
      />

      {/* Export button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.exportBtn, (exporting || records.length === 0) && styles.disabled]}
          onPress={handleExport}
          disabled={exporting || records.length === 0}
        >
          {exporting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.exportBtnText}>⬇  Export CSV ({records.length} rows)</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: Colors.primaryDark, padding: Spacing.md },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: '#fff' },
  headerMeta: { fontSize: FontSize.sm, color: Colors.accent, marginTop: 2 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceDim,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
  },
  tableRowAlt: { backgroundColor: Colors.surfaceDim },
  tableCell: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  tableCellHead: { fontWeight: '700', color: Colors.text },
  tableCellRight: { textAlign: 'right' },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  exportBtn: {
    backgroundColor: Colors.success,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  exportBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
