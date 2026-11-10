import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {HttpError} from '../errors.js';
import {namesSchema} from '../validation.js';
import type {DniProvider} from './dni.js';

const endpoint = 'https://api.scrall.net/v1/reniec/basico';
const spacingMs = 5100;
const upstreamTimeoutMs = 5000;
const maxPending = 5;
const maxWaitMs = 30_000;
const responseSchema = z.object({
  message: z.string(),
  result: z.unknown().optional(),
});
const personSchema = z.object({
  nuDni: z.string(),
  preNombres: z.string(),
  apePaterno: z.string(),
  apeMaterno: z.string(),
});

function unavailable() {
  return new HttpError(503, 'DNI_NO_VERIFICADO', 'No pudimos verificar tu DNI. Intenta nuevamente en unos minutos.');
}

export function makeScrallProvider(key: string | undefined, request = fetch): DniProvider {
  const token = key?.trim().replace(/^Basic\s+/i, '');
  let queue = Promise.resolve();
  let nextStart = 0;
  let pending = 0;

  return async dni => {
    if (!token) throw unavailable();
    if (pending >= maxPending) {
      throw new HttpError(429, 'COLA_DNI_LLENA', 'Hay varias consultas pendientes. Espera unos segundos y reintenta.');
    }

    pending++;
    const deadline = performance.now() + maxWaitMs;
    const lookup = queue.then(async () => {
      const now = performance.now();
      if (Math.max(now, nextStart) > deadline) throw unavailable();
      const wait = nextStart - now;
      if (wait > 0) await delay(Math.ceil(wait));
      nextStart = performance.now() + spacingMs;
      try {
        const response = await request(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(upstreamTimeoutMs),
          headers: {
            Authorization: 'Basic ' + token,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({dni}),
        });
        if (!response.ok) {
          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after') ?? '';
            const seconds = /^\d+$/.test(retryAfter) ? Number(retryAfter) : 10;
            nextStart = performance.now() + Math.max(10, Math.min(seconds, 120)) * 1000;
          }
          await response.body?.cancel();
          throw unavailable();
        }

        const {message, result} = responseSchema.parse(await response.json());
        if (message === 'not found data') {
          throw new HttpError(404, 'DNI_NO_ENCONTRADO', 'No encontramos ese DNI. Revisa los dígitos ingresados.');
        }
        if (message !== 'found data') throw unavailable();

        const person = personSchema.parse(result);
        if (person.nuDni !== dni) throw unavailable();
        const normalize = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').toLocaleUpperCase('es-PE');
        return namesSchema.parse({
          nombres: normalize(person.preNombres),
          apellidoPaterno: normalize(person.apePaterno),
          apellidoMaterno: normalize(person.apeMaterno),
        });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw unavailable();
      }
    });
    queue = lookup.then(() => undefined, () => undefined);
    try {
      return await lookup;
    } finally {
      pending--;
    }
  };
}
