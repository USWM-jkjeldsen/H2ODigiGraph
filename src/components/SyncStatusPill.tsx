import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { manualCloudRefresh } from '../lib/storage';
import { subscribeSyncState, getSyncState, type SyncState, type SyncStatus } from '../lib/syncState';

const LABELS: Record<SyncStatus, string> = {
  local: 'Local',
  syncing: 'Syncing',
  synced: 'Synced',
  error: 'Sync Error',
};

const COLORS: Record<SyncStatus, string> = {
  local: 'rgba(255,255,255,0.22)',
  syncing: 'rgba(255,190,80,0.9)',
  synced: 'rgba(36,180,115,0.9)',
  error: 'rgba(230,80,80,0.92)',
};

export function SyncStatusPill() {
  const [syncState, setSyncState] = useState<SyncState>(getSyncState());

  useEffect(() => {
    return subscribeSyncState(setSyncState);
  }, []);

  const status = syncState.status;

  const handlePress = () => {
    const lines: string[] = [];
    lines.push(`Status: ${LABELS[status]}`);
    lines.push(
      `Last sync: ${syncState.lastSyncedAt ? new Date(syncState.lastSyncedAt).toLocaleString() : 'Never'}`,
    );
    if (syncState.lastError) {
      lines.push(`Last error: ${syncState.lastError}`);
    }

    Alert.alert('Sync Status', lines.join('\n'), [
      { text: 'Close', style: 'cancel' },
      {
        text: status === 'syncing' ? 'Syncing…' : 'Retry Now',
        onPress: () => {
          if (status === 'syncing') {
            return;
          }
          void manualCloudRefresh().catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            Alert.alert('Sync failed', message);
          });
        },
        style: 'default',
      },
    ]);
  };

  return (
    <Pressable
      style={[styles.pill, { backgroundColor: COLORS[status] }]}
      onPress={handlePress}
      hitSlop={8}
    >
      <Text style={styles.text}>{LABELS[status]}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
  },
  text: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
