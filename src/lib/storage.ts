import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Site, DigiSession, UserTraceSettings } from './types';
import {
  fetchSessionsFromCloud,
  fetchSitesFromCloud,
  deleteSessionFromCloud,
  deleteSiteFromCloud,
  syncSessionToCloud,
  syncSiteToCloud,
} from './cloudSync';
import { isFirebaseConfigured } from './firebase';
import { setSyncStatus } from './syncState';

const SITES_KEY = 'h2odigraph:sites';
const SESSIONS_KEY = 'h2odigraph:sessions';
const USER_TRACE_SETTINGS_KEY = 'h2odigraph:user-trace-settings';
const DEFAULT_USER_TRACE_SETTINGS: UserTraceSettings = {
  pencilColor: '#6d6d6d',
  gridColor: '#3e9bd1',
};

function toErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return String(err);
}

async function writeSites(sites: Site[]): Promise<void> {
  await AsyncStorage.setItem(SITES_KEY, JSON.stringify(sites));
}

async function writeSessions(sessions: DigiSession[]): Promise<void> {
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

async function patchSession(sessionId: string, patch: Partial<DigiSession>): Promise<void> {
  const sessions = await getSessions();
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return;

  sessions[idx] = { ...sessions[idx], ...patch };
  await writeSessions(sessions);
}

function mergeById<T extends { id: string }>(localItems: T[], cloudItems: T[]): T[] {
  const merged = new Map<string, T>();

  for (const item of localItems) {
    merged.set(item.id, item);
  }
  for (const item of cloudItems) {
    // Cloud should win when both exist, so remote edits propagate to this device.
    merged.set(item.id, item);
  }

  return Array.from(merged.values());
}

// ── Sites ──────────────────────────────────────────────────────────────────

export async function getSites(): Promise<Site[]> {
  const raw = await AsyncStorage.getItem(SITES_KEY);
  const localSites = raw ? (JSON.parse(raw) as Site[]) : [];

  if (!isFirebaseConfigured()) {
    setSyncStatus('local');
    return localSites;
  }

  try {
    setSyncStatus('syncing');
    const cloudSites = await fetchSitesFromCloud();
    if (!cloudSites) {
      setSyncStatus('local');
      return localSites;
    }

    const mergedSites = mergeById(localSites, cloudSites);
    await writeSites(mergedSites);
    setSyncStatus('synced');
    return mergedSites;
  } catch (err) {
    console.warn('Cloud site fetch failed', err);
    setSyncStatus('error', toErrorMessage(err));
    return localSites;
  }
}

export async function saveSite(site: Site): Promise<void> {
  const sites = await getSites();
  const idx = sites.findIndex((s) => s.id === site.id);
  if (idx >= 0) {
    sites[idx] = site;
  } else {
    sites.push(site);
  }
  await writeSites(sites);

  if (!isFirebaseConfigured()) {
    setSyncStatus('local');
    return;
  }

  setSyncStatus('syncing');

  void syncSiteToCloud(site)
    .then(() => {
      setSyncStatus('synced');
    })
    .catch((err: unknown) => {
      console.warn('Cloud site sync failed', err);
      setSyncStatus('error', toErrorMessage(err));
    });
}

export async function deleteSite(siteId: string): Promise<void> {
  const sites = await getSites();
  const filtered = sites.filter((s) => s.id !== siteId);
  await writeSites(filtered);

  if (!isFirebaseConfigured()) {
    setSyncStatus('local');
    return;
  }

  setSyncStatus('syncing');

  void deleteSiteFromCloud(siteId)
    .then(() => {
      setSyncStatus('synced');
    })
    .catch((err: unknown) => {
      console.warn('Cloud site delete failed', err);
      setSyncStatus('error', toErrorMessage(err));
    });
}

// ── Sessions ───────────────────────────────────────────────────────────────

export async function getSessions(): Promise<DigiSession[]> {
  const raw = await AsyncStorage.getItem(SESSIONS_KEY);
  const localSessions = raw ? (JSON.parse(raw) as DigiSession[]) : [];

  if (!isFirebaseConfigured()) {
    setSyncStatus('local');
    return localSessions;
  }

  try {
    setSyncStatus('syncing');
    const cloudSessions = await fetchSessionsFromCloud();
    if (!cloudSessions) {
      setSyncStatus('local');
      return localSessions;
    }

    const mergedSessions = mergeById(localSessions, cloudSessions);
    await writeSessions(mergedSessions);
    setSyncStatus('synced');
    return mergedSessions;
  } catch (err) {
    console.warn('Cloud session fetch failed', err);
    setSyncStatus('error', toErrorMessage(err));
    return localSessions;
  }
}

export async function getSessionsForSite(siteId: string): Promise<DigiSession[]> {
  const sessions = await getSessions();
  return sessions.filter((s) => s.siteId === siteId);
}

export async function saveSession(session: DigiSession): Promise<void> {
  const sessions = await getSessions();
  const idx = sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.push(session);
  }
  await writeSessions(sessions);

  if (!isFirebaseConfigured()) {
    setSyncStatus('local');
    return;
  }

  setSyncStatus('syncing');

  void syncSessionToCloud(session)
    .then((patch: Partial<DigiSession> | null) => {
      if (patch) {
        return patchSession(session.id, patch).then(() => {
          setSyncStatus('synced');
        });
      }
      setSyncStatus('synced');
      return undefined;
    })
    .catch((err: unknown) => {
      console.warn('Cloud session sync failed', err);
      setSyncStatus('error', toErrorMessage(err));
    });
}

export async function deleteSession(sessionId: string): Promise<void> {
  const sessions = await getSessions();
  const filtered = sessions.filter((s) => s.id !== sessionId);
  const deleted = sessions.find((s) => s.id === sessionId);
  await writeSessions(filtered);

  if (!isFirebaseConfigured()) {
    setSyncStatus('local');
    return;
  }

  setSyncStatus('syncing');

  void deleteSessionFromCloud(
    sessionId,
    deleted?.cloudImagePath,
    deleted?.cloudCroppedImagePath,
  )
    .then(() => {
      setSyncStatus('synced');
    })
    .catch((err: unknown) => {
      console.warn('Cloud session delete failed', err);
      setSyncStatus('error', toErrorMessage(err));
    });
}

export async function manualCloudRefresh(): Promise<{ sites: number; sessions: number }> {
  const rawSites = await AsyncStorage.getItem(SITES_KEY);
  const rawSessions = await AsyncStorage.getItem(SESSIONS_KEY);
  const localSites = rawSites ? (JSON.parse(rawSites) as Site[]) : [];
  const localSessions = rawSessions ? (JSON.parse(rawSessions) as DigiSession[]) : [];

  if (!isFirebaseConfigured()) {
    setSyncStatus('local');
    return { sites: localSites.length, sessions: localSessions.length };
  }

  setSyncStatus('syncing');

  try {
    const [cloudSites, cloudSessions] = await Promise.all([
      fetchSitesFromCloud(),
      fetchSessionsFromCloud(),
    ]);

    const mergedSites = cloudSites ? mergeById(localSites, cloudSites) : localSites;
    const mergedSessions = cloudSessions
      ? mergeById(localSessions, cloudSessions)
      : localSessions;

    await Promise.all([writeSites(mergedSites), writeSessions(mergedSessions)]);
    setSyncStatus('synced');
    return { sites: mergedSites.length, sessions: mergedSessions.length };
  } catch (err) {
    console.warn('Manual cloud refresh failed', err);
    setSyncStatus('error', toErrorMessage(err));
    throw err;
  }
}

export async function getUserTraceSettings(): Promise<UserTraceSettings> {
  const raw = await AsyncStorage.getItem(USER_TRACE_SETTINGS_KEY);
  if (!raw) {
    return DEFAULT_USER_TRACE_SETTINGS;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<UserTraceSettings>;
    return {
      pencilColor: parsed.pencilColor ?? DEFAULT_USER_TRACE_SETTINGS.pencilColor,
      gridColor: parsed.gridColor ?? DEFAULT_USER_TRACE_SETTINGS.gridColor,
    };
  } catch {
    return DEFAULT_USER_TRACE_SETTINGS;
  }
}

export async function saveUserTraceSettings(settings: UserTraceSettings): Promise<void> {
  await AsyncStorage.setItem(USER_TRACE_SETTINGS_KEY, JSON.stringify(settings));
}
