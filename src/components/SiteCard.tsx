import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { Site } from '../lib/types';
import { Colors, Spacing, FontSize } from '../lib/theme';

interface Props {
  site: Site;
  sessionCount?: number;
  onPress: () => void;
  onLongPress?: () => void;
}

export function SiteCard({ site, sessionCount = 0, onPress, onLongPress }: Props) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.75}
    >
      <View style={styles.codeTag}>
        <Text style={styles.codeText}>{site.siteCode}</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.name} numberOfLines={1}>
          {site.name}
        </Text>
        {site.description ? (
          <Text style={styles.description} numberOfLines={1}>
            {site.description}
          </Text>
        ) : null}
        <Text style={styles.meta}>
          {sessionCount} session{sessionCount !== 1 ? 's' : ''}
          {site.latitude != null ? `  •  ${site.latitude.toFixed(4)}° N` : ''}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.xs,
    padding: Spacing.md,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  codeTag: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 70,
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  codeText: {
    color: '#fff',
    fontSize: FontSize.sm,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  content: {
    flex: 1,
  },
  name: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  description: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  meta: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 4,
  },
  chevron: {
    fontSize: 24,
    color: Colors.textMuted,
    marginLeft: Spacing.sm,
  },
});
