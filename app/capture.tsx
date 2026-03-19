import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { saveSession } from '../src/lib/storage';
import type { CaptureLocation, CaptureSource, DigiSession } from '../src/lib/types';
import { Colors, Spacing, FontSize } from '../src/lib/theme';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

export default function CaptureScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const router = useRouter();
  const [preview, setPreview] = useState<string | null>(null);
  const [captureSource, setCaptureSource] = useState<CaptureSource | null>(null);
  const [captureLocation, setCaptureLocation] = useState<CaptureLocation | null>(null);
  const [saving, setSaving] = useState(false);

  const captureFieldLocation = async (): Promise<CaptureLocation | null> => {
    if (Platform.OS === 'web') return null;

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return null;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      return {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy,
        altitude: location.coords.altitude,
        heading: location.coords.heading,
        speed: location.coords.speed,
        capturedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.warn('Location capture failed', err);
      return null;
    }
  };

  const openCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Camera permission is needed to photograph chart records.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.92,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      const location = await captureFieldLocation();
      setPreview(result.assets[0].uri);
      setCaptureSource('camera');
      setCaptureLocation(location);
    }
  };

  const openLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Photo library access is needed to load chart images.');
      return;
    }
    if (Platform.OS !== 'web') {
      Alert.alert('Desktop only', 'Selecting from library is desktop-only. On phone, use Take Photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.92,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setPreview(result.assets[0].uri);
      setCaptureSource(Platform.OS === 'web' ? 'web-upload' : 'library');
      setCaptureLocation(null);
    }
  };

  const handleUseImage = async () => {
    if (!preview || !siteId) return;
    setSaving(true);
    const session: DigiSession = {
      id: uuidv4(),
      siteId,
      imageUri: preview,
      capturedAt: new Date().toISOString(),
      captureSource: captureSource ?? (Platform.OS === 'web' ? 'web-upload' : 'library'),
      captureLocation: captureLocation ?? undefined,
      status: 'captured',
    };
    await saveSession(session);
    setSaving(false);
    if (Platform.OS === 'web') {
      router.replace(`/digitize/${session.id}`);
      return;
    }
    router.replace(`/site/${siteId}`);
  };

  return (
    <View style={styles.root}>
      {preview ? (
        <>
          <Image source={{ uri: preview }} style={styles.preview} resizeMode="contain" />
          <View style={styles.metadataBar}>
            <Text style={styles.metadataText}>
              Source: {captureSource === 'camera' ? 'Field camera' : captureSource === 'web-upload' ? 'Web upload' : 'Photo library'}
            </Text>
            <Text style={styles.metadataText}>
              {captureLocation
                ? `GPS: ${captureLocation.latitude.toFixed(5)}, ${captureLocation.longitude.toFixed(5)}`
                : 'GPS: not attached'}
            </Text>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => {
                setPreview(null);
                setCaptureSource(null);
                setCaptureLocation(null);
              }}
            >
              <Text style={styles.secondaryBtnText}>Retake / Choose Again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, saving && styles.disabled]}
              onPress={handleUseImage}
              disabled={saving}
            >
              <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : 'Use This Image →'}</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <View style={styles.chooser}>
          <Text style={styles.title}>Add Chart Image</Text>
          <Text style={styles.subtitle}>
            Photograph the paper stage height chart or choose an existing image from your library.
          </Text>
          {Platform.OS !== 'web' ? (
            <TouchableOpacity style={styles.bigBtn} onPress={openCamera}>
              <Text style={styles.bigBtnIcon}>📷</Text>
              <Text style={styles.bigBtnLabel}>Take Photo</Text>
              <Text style={styles.bigBtnSub}>Use your device camera</Text>
            </TouchableOpacity>
          ) : null}
          {Platform.OS === 'web' ? (
            <TouchableOpacity style={styles.bigBtn} onPress={openLibrary}>
              <Text style={styles.bigBtnIcon}>🖼️</Text>
              <Text style={styles.bigBtnLabel}>Choose from Library</Text>
              <Text style={styles.bigBtnSub}>Select an existing image</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  preview: { flex: 1, backgroundColor: '#000' },
  metadataBar: {
    backgroundColor: Colors.primaryDark,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: 2,
  },
  metadataText: {
    color: '#dceefe',
    fontSize: FontSize.sm,
  },
  actions: {
    flexDirection: 'row',
    padding: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryBtnText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600' },
  primaryBtn: {
    flex: 2,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  chooser: { flex: 1, padding: Spacing.xl, alignItems: 'center', justifyContent: 'center' },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.xl,
    lineHeight: 22,
  },
  bigBtn: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: Spacing.lg,
    alignItems: 'center',
    marginBottom: Spacing.md,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  bigBtnIcon: { fontSize: 42, marginBottom: 8 },
  bigBtnLabel: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  bigBtnSub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
});
