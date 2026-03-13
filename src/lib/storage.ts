import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Site, DigiSession } from './types';

const SITES_KEY = 'h2odigraph:sites';
const SESSIONS_KEY = 'h2odigraph:sessions';

// ── Sites ──────────────────────────────────────────────────────────────────

export async function getSites(): Promise<Site[]> {
  const raw = await AsyncStorage.getItem(SITES_KEY);
  return raw ? (JSON.parse(raw) as Site[]) : [];
}

export async function saveSite(site: Site): Promise<void> {
  const sites = await getSites();
  const idx = sites.findIndex((s) => s.id === site.id);
  if (idx >= 0) {
    sites[idx] = site;
  } else {
    sites.push(site);
  }
  await AsyncStorage.setItem(SITES_KEY, JSON.stringify(sites));
}

export async function deleteSite(siteId: string): Promise<void> {
  const sites = await getSites();
  const filtered = sites.filter((s) => s.id !== siteId);
  await AsyncStorage.setItem(SITES_KEY, JSON.stringify(filtered));
}

// ── Sessions ───────────────────────────────────────────────────────────────

export async function getSessions(): Promise<DigiSession[]> {
  const raw = await AsyncStorage.getItem(SESSIONS_KEY);
  return raw ? (JSON.parse(raw) as DigiSession[]) : [];
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
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export async function deleteSession(sessionId: string): Promise<void> {
  const sessions = await getSessions();
  const filtered = sessions.filter((s) => s.id !== sessionId);
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(filtered));
}
