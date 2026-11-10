import type {Config} from '../config.js';
import {HttpError} from '../errors.js';
import {makeScrallProvider} from './scrall.js';
import {namesSchema, type Names} from '../validation.js';

export type DniProvider = (dni: string) => Promise<Names | null>;

const mock: Record<string, Names> = {
  '00000001': {nombres: 'ANA LUCÍA', apellidoPaterno: 'EJEMPLO', apellidoMaterno: 'FICTICIA'},
  '00000002': {nombres: 'JUAN CARLOS', apellidoPaterno: 'PRUEBA', apellidoMaterno: 'FICTICIO'},
  '00000003': {nombres: 'MARÍA ELENA', apellidoPaterno: 'DEMOSTRACIÓN', apellidoMaterno: 'FICTICIA'},
  '00000004': {nombres: 'DIEGO ANDRÉS', apellidoPaterno: 'MODELO', apellidoMaterno: 'FICTICIO'},
};

function field(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) =>
    value && typeof value === 'object' && Object.hasOwn(value, key)
      ? (value as Record<string, unknown>)[key]
      : undefined, source);
}

function unavailable() {
  return new HttpError(503, 'DNI_NO_VERIFICADO', 'No pudimos verificar tu DNI. Intenta nuevamente en unos minutos.');
}

type LookupRequest = (dni: string) => URL;
type ReadNames = (data: unknown, dni: string) => unknown;

function httpLookup(request: LookupRequest, readNames: ReadNames, timeout: number, headers: Headers): DniProvider {
  return async dni => {
    try {
      const response = await fetch(request(dni), {
        headers, redirect: 'error', signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404) {
          throw new HttpError(404, 'DNI_NO_ENCONTRADO', 'No encontramos ese DNI. Revisa los dígitos ingresados.');
        }
        throw unavailable();
      }

      const data: unknown = await response.json();
      const names = namesSchema.parse(readNames(data, dni));
      const normalize = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').toLocaleUpperCase('es-PE');
      return namesSchema.parse({
        nombres: normalize(names.nombres),
        apellidoPaterno: normalize(names.apellidoPaterno),
        apellidoMaterno: normalize(names.apellidoMaterno),
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw unavailable();
    }
  };
}

function peruConsult(env: NodeJS.ProcessEnv, timeout: number, headers: Headers): DniProvider {
  const origin = new URL(env.PERU_CONSULT_ORIGIN || 'http://127.0.0.1:8080');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  const token = env.PERU_CONSULT_TOKEN?.trim();
  if (!token || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || !(origin.protocol === 'https:' || (origin.protocol === 'http:' && loopback))) {
    throw unavailable();
  }
  return httpLookup(dni => {
    const url = new URL('/api/v1/dni/' + encodeURIComponent(dni), origin);
    url.searchParams.set('token', token);
    return url;
  }, (data, dni) => {
    if (field(data, 'dni') !== dni) throw unavailable();
    return {
      nombres: field(data, 'nombres'),
      apellidoPaterno: field(data, 'apellidoPaterno'),
      apellidoMaterno: field(data, 'apellidoMaterno'),
    };
  }, timeout, headers);
}

function genericLookup(env: NodeJS.ProcessEnv, timeout: number, headers: Headers): DniProvider {
  const template = env.DNI_API_URL || '';
  if (env.DNI_API_AUTH_VALUE) headers.set(env.DNI_API_AUTH_HEADER || 'Authorization', env.DNI_API_AUTH_VALUE);
  const url = new URL(template.replaceAll('{dni}', '00000000'));
  const alternative = new URL(template.replaceAll('{dni}', '11111111'));
  if (url.protocol !== 'https:' || url.origin !== alternative.origin
    || url.username || url.password || url.hash
    || (url.pathname === alternative.pathname && url.search === alternative.search)) {
    throw unavailable();
  }
  return httpLookup(dni => new URL(template.replaceAll('{dni}', dni)), data => ({
    nombres: field(data, env.DNI_API_NAMES_PATH || 'nombres'),
    apellidoPaterno: field(data, env.DNI_API_PATERNAL_PATH || 'apellidoPaterno'),
    apellidoMaterno: field(data, env.DNI_API_MATERNAL_PATH || 'apellidoMaterno'),
  }), timeout, headers);
}

export function makeDniProvider(mode: Config['mode'], env = process.env): DniProvider {
  if (mode === 'scrall') return makeScrallProvider(env.SCRALL_API_KEY);
  if (mode === 'dni-local' || mode === 'padron') return async () => null;
  if (mode === 'mock') {
    return async dni => {
      const result = mock[dni];
      if (!result) throw new HttpError(404, 'DNI_NO_ENCONTRADO', 'DNI ficticio no encontrado. Usa un número del 00000001 al 00000004.');
      return result;
    };
  }

  try {
    const timeout = Number(env.DNI_API_TIMEOUT_MS || 5000);
    if (!Number.isInteger(timeout) || timeout < 100 || timeout > 15000) throw unavailable();
    const headers = new Headers({Accept: 'application/json'});
    return mode === 'peru-consult' ? peruConsult(env, timeout, headers) : genericLookup(env, timeout, headers);
  } catch {
    return async () => {throw unavailable();};
  }
}
