export type SyncStatus = 'local' | 'syncing' | 'synced' | 'error';

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
}

type Listener = (state: SyncState) => void;

let currentState: SyncState = {
  status: 'local',
  lastSyncedAt: null,
  lastError: null,
};
const listeners = new Set<Listener>();

export function getSyncStatus(): SyncStatus {
  return currentState.status;
}

export function getSyncState(): SyncState {
  return currentState;
}

export function setSyncStatus(status: SyncStatus, errorMessage?: string | null): void {
  const nextState: SyncState = {
    status,
    lastSyncedAt: status === 'synced' ? new Date().toISOString() : currentState.lastSyncedAt,
    lastError: status === 'error' ? (errorMessage ?? 'Unknown sync error') : null,
  };

  if (
    currentState.status === nextState.status &&
    currentState.lastSyncedAt === nextState.lastSyncedAt &&
    currentState.lastError === nextState.lastError
  ) {
    return;
  }

  currentState = nextState;
  listeners.forEach((listener) => listener(currentState));
}

export function subscribeSyncState(listener: Listener): () => void {
  listeners.add(listener);
  listener(currentState);

  return () => {
    listeners.delete(listener);
  };
}

export function subscribeSyncStatus(listener: (status: SyncStatus) => void): () => void {
  return subscribeSyncState((state) => listener(state.status));
}
