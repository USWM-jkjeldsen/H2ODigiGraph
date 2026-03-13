import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { getSites, getSessionsForSite, deleteSite, deleteSession } from '../../src/lib/storage';
import type { Site, DigiSession } from '../../src/lib/types';
import { Colors, Spacing, FontSize } from '../../src/lib/theme';

const STATUS_LABEL: Record<DigiSession['status'], string> = {
  captured: 'Photo captured',
  bounded: 'Boundaries set',
  digitized: 'Digitized',
  exported: 'Exported',
};

const STATUS_COLOR: Record<DigiSession['status'], string> = {
  captured: Colors.warning,
  bounded: Colors.accent,
  digitized: Colors.primaryLight,
  exported: Colors.success,
};

export default function SiteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [site, setSite] = useState<Site | null>(null);
  const [sessions, setSessions] = useState<DigiSession[]>([]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const sites = await getSites();
        const found = sites.find((s) => s.id === id) ?? null;
        setSite(found);
        if (found) {
          const s = await getSessionsForSite(found.id);
          setSessions(s.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)));
        }
      })();
    }, [id]),
  );

  const handleDeleteSite = () => {
    Alert.alert('Delete Site', `Delete "${site?.name}" and all its sessions?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteSite(id!);
          router.back();
        },
      },
    ]);
  };

  const handleDeleteSession = (sessionId: string) => {
    Alert.alert('Delete Session', 'Delete this chart session?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteSession(sessionId);
          setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        },
      },
    ]);
  };

  if (!site) {
    return (
      <View style={styles.centered}>
        <Text style={styles.notFound}>Site not found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Site header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.siteName}>{site.name}</Text>
          <Text style={styles.siteCode}>{site.siteCode}</Text>
          {site.description ? <Text style={styles.siteDesc}>{site.description}</Text> : null}
          {site.latitude != null ? (
            <Text style={styles.siteMeta}>
              {site.latitude.toFixed(5)}°N, {site.longitude?.toFixed(5)}°W
            </Text>
          ) : null}
        </View>
        <TouchableOpacity onPress={handleDeleteSite} style={styles.deleteBtn}>
          <Text style={styles.deleteBtnText}>Delete</Text>
        </TouchableOpacity>
      </View>

      {/* Sessions list */}
      <Text style={styles.sectionHead}>Chart Sessions</Text>
      {sessions.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No chart images yet. Capture one in the field!</Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.sessionCard}
              onPress={() =>
                item.status === 'digitized' || item.status === 'bounded'
                  ? router.push(`/digitize/${item.id}`)
                  : item.status === 'exported'
                    ? router.push(`/export/${item.id}`)
                    : router.push(`/digitize/${item.id}`)
              }
              onLongPress={() => handleDeleteSession(item.id)}
            >
              <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[item.status] }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.sessionDate}>{item.capturedAt.slice(0, 10)}</Text>
                <Text style={styles.sessionStatus}>{STATUS_LABEL[item.status]}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}
          contentContainerStyle={{ paddingBottom: 100 }}
        />
      )}

      {/* Capture FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push({ pathname: '/capture', params: { siteId: site.id } })}
      >
        <Text style={styles.fabText}>📷</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFound: { fontSize: FontSize.md, color: Colors.textSecondary },
  header: {
    backgroundColor: Colors.primaryDark,
    padding: Spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  siteName: { fontSize: FontSize.xl, fontWeight: '700', color: '#fff' },
  siteCode: { fontSize: FontSize.md, color: Colors.accent, marginTop: 2 },
  siteDesc: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.75)', marginTop: 4 },
  siteMeta: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.5)', marginTop: 4 },
  deleteBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,80,80,0.5)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  deleteBtnText: { color: '#ff8080', fontSize: FontSize.sm },
  sectionHead: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.text,
    margin: Spacing.md,
    marginBottom: Spacing.xs,
  },
  empty: { padding: Spacing.xl, alignItems: 'center' },
  emptyText: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.xs,
    borderRadius: 10,
    padding: Spacing.md,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  statusDot: { width: 12, height: 12, borderRadius: 6, marginRight: Spacing.md },
  sessionDate: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sessionStatus: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  chevron: { fontSize: 22, color: Colors.textMuted },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  fabText: { fontSize: 26 },
});
