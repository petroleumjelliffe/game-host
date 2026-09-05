/**
 * The device's notification identity: a bearer secret the /notify API keys
 * every profile on. Minted once per browser, never sent anywhere but the
 * notify endpoints. base64url of 18 crypto-random bytes = 24 chars, inside
 * the server's accepted 16–128 range.
 */
const STORAGE_KEY = 'notify.key';

function mint(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Null when storage is unavailable — notifications degrade to absent. */
export function getPlayerKey(): string | null {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing !== null && existing !== '') return existing;
    const key = mint();
    localStorage.setItem(STORAGE_KEY, key);
    return key;
  } catch {
    return null;
  }
}
