import {randomBytes} from 'node:crypto';

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
