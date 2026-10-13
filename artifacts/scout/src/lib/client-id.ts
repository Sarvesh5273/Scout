import { setAuthTokenGetter } from '@workspace/api-client-react';

const STORAGE_KEY = 'scout.clientId';

function randomId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

let memoryId: string | null = null;

/**
 * Scout has no accounts: each browser keeps a random id and sends it as a bearer token, so your hunts
 * stay yours. Falls back to an in-memory id when storage is blocked (e.g. some private modes).
 */
export function getClientId(): string {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const id = randomId();
    window.localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    memoryId ??= randomId();
    return memoryId;
  }
}

export function installClientId(): void {
  setAuthTokenGetter(() => getClientId());
}
