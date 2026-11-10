import {createCipheriv, createDecipheriv, createHmac, randomBytes} from 'node:crypto';
import {privateChange, privateSnapshot} from './private-store.js';

type Entries<T> = Record<string, {value: T; expires: number}>;

function parseEntries<T>(data: unknown): Entries<T> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Sesiones inválidas.');
  return data as Entries<T>;
}

export function sharedTokens<T>(path: string, ttl: number, max: number, secret: string) {
  const parse = parseEntries<string>;
  const key = createHmac('sha256', Buffer.from(secret, 'hex')).update('tokens:' + path).digest();
  function encrypt(value: T, token: string) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(token));
    return Buffer.concat([nonce, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64url');
  }

  function decrypt(value: string, token: string): T {
    const bytes = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(token));
    decipher.setAuthTag(bytes.subarray(-16));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8')) as T;
  }
  return {
    async issue(value: T) {
      return privateChange(path, parse, entries => {
        const now = Date.now();
        for (const [id, entry] of Object.entries(entries)) {
          if (entry.expires <= now) delete entries[id];
        }
        if (Object.keys(entries).length >= max) return undefined;
        const token = randomBytes(32).toString('base64url');
        entries[token] = {value: encrypt(value, token), expires: now + ttl};
        return token;
      }, (): Entries<string> => ({}));
    },
    async get(token: string) {
      if (!/^[\w-]{43}$/.test(token)) return undefined;
      const stored = await privateSnapshot(path);
      const entry = stored && parse(stored.data)[token];
      return entry && entry.expires > Date.now() ? decrypt(entry.value, token) : undefined;
    },
    async remove(token: string) {
      if (!/^[\w-]{43}$/.test(token)) return;
      await privateChange(path, parse, entries => {delete entries[token];}, (): Entries<string> => ({}));
    },
  };
}


export function expiringTokens<T>(ttl: number, max: number) {
  const entries = new Map<string, {value: T; expires: number}>();
  return {
    issue(value: T) {
      const now = Date.now();
      for (const [token, entry] of entries) {
        if (entry.expires > now) break;
        entries.delete(token);
      }
      if (entries.size >= max) return undefined;
      const token = randomBytes(32).toString('base64url');
      entries.set(token, {value, expires: now + ttl});
      return token;
    },
    get(token: string) {
      const entry = entries.get(token);
      if (entry && entry.expires > Date.now()) return entry.value;
      entries.delete(token);
    },
    remove(token: string) {
      entries.delete(token);
    },
  };
}
