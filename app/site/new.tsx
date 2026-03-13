import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { saveSite } from '../../src/lib/storage';
import type { Site } from '../../src/lib/types';
import { Colors, Spacing, FontSize } from '../../src/lib/theme';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

export default function NewSiteScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [siteCode, setSiteCode] = useState('');
  const [description, setDescription] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Required', 'Site name is required.');
      return;
    }
    if (!siteCode.trim()) {
      Alert.alert('Required', 'Site code is required (e.g. USGS gage ID).');
      return;
    }
    setSaving(true);
    const site: Site = {
      id: uuidv4(),
      name: name.trim(),
      siteCode: siteCode.trim().toUpperCase(),
      description: description.trim() || undefined,
      latitude: latitude ? parseFloat(latitude) : undefined,
      longitude: longitude ? parseFloat(longitude) : undefined,
      createdAt: new Date().toISOString(),
    };
    await saveSite(site);
    setSaving(false);
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.label}>Site Name *</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Cache Creek at Yolo"
          placeholderTextColor={Colors.textMuted}
        />

        <Text style={styles.label}>Site Code *</Text>
        <TextInput
          style={styles.input}
          value={siteCode}
          onChangeText={setSiteCode}
          placeholder="e.g. 11452500"
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="characters"
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          placeholder="Optional notes about this site"
          placeholderTextColor={Colors.textMuted}
          multiline
          numberOfLines={3}
        />

        <Text style={styles.sectionHead}>Location (optional)</Text>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Latitude</Text>
            <TextInput
              style={styles.input}
              value={latitude}
              onChangeText={setLatitude}
              placeholder="38.7249"
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={{ width: Spacing.sm }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Longitude</Text>
            <TextInput
              style={styles.input}
              value={longitude}
              onChangeText={setLongitude}
              placeholder="-121.9019"
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Add Site'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: Spacing.md, paddingBottom: 40 },
  sectionHead: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.primary,
    marginTop: Spacing.lg,
    marginBottom: 4,
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
    marginTop: Spacing.md,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: FontSize.md,
    color: Colors.text,
    backgroundColor: Colors.surface,
  },
  multiline: { height: 80, textAlignVertical: 'top' },
  row: { flexDirection: 'row' },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: Spacing.xl,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: '700' },
});
