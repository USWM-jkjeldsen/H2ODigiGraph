import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { SiteCard } from '../src/components/SiteCard';
import { getSites, getSessionsForSite } from '../src/lib/storage';
import type { Site } from '../src/lib/types';
import { Colors, Spacing, FontSize } from '../src/lib/theme';

export default function HomeScreen() {
  const router = useRouter();
  const [sites, setSites] = useState<Site[]>([]);
  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    const loaded = await getSites();
    setSites(loaded);
    const counts: Record<string, number> = {};
    await Promise.all(
      loaded.map(async (s) => {
        const sessions = await getSessionsForSite(s.id);
        counts[s.id] = sessions.length;
      }),
    );
    setSessionCounts(counts);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  return (
    <View style={styles.root}>
      {sites.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🌊</Text>
          <Text style={styles.emptyTitle}>No sites yet</Text>
          <Text style={styles.emptyBody}>
            Add your first stream gage site to start digitizing chart records.
          </Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/site/new')}>
            <Text style={styles.emptyBtnText}>+ Add Site</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sites}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <SiteCard
              site={item}
              sessionCount={sessionCounts[item.id] ?? 0}
              onPress={() => router.push(`/site/${item.id}`)}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => router.push('/site/new')}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { paddingVertical: Spacing.sm, paddingBottom: 80 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  emptyIcon: { fontSize: 56, marginBottom: Spacing.md },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  emptyBody: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  emptyBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 14,
  },
  emptyBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: '700' },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  fabText: { color: '#fff', fontSize: 32, lineHeight: 36 },
});
