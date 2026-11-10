import {readFileSync} from 'node:fs';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {professorSchema} from './validation.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export function loadConfig(env = process.env) {
  const cloud = env.VERCEL === '1' || env.ELECTION_STORAGE === 'blob';
  const production = env.NODE_ENV === 'production';
  const provider = z.enum(['mock', 'api', 'peru-consult', 'dni-local', 'scrall', 'padron']).safeParse(env.DNI_PROVIDER || (production ? 'api' : 'peru-consult'));
  if (!provider.success) throw new Error('DNI_PROVIDER debe ser mock, api, peru-consult, dni-local, scrall o padron.');
  const mode = provider.data;
  const host = env.HOST || '127.0.0.1';
  const port = Number(env.PORT || 3000);
  const proxyHops = Number(env.TRUST_PROXY_HOPS || 0);
  const password = env.ADMIN_PASSWORD || '';
  const hmacKey = env.DNI_HMAC_KEY || '';
  if (production && mode === 'mock') throw new Error('El proveedor ficticio solo está disponible en desarrollo.');
  const minimumPasswordLength = !production && host === '127.0.0.1' && proxyHops === 0 ? 8 : 16;
  if (!/^[a-f0-9]{64}$/i.test(hmacKey) || password.length < minimumPasswordLength || password.length > 256) {
    throw new Error('Configura ADMIN_PASSWORD (' + minimumPasswordLength + ' a 256 caracteres) y DNI_HMAC_KEY (64 hexadecimales). Ejecuta el script setup para desarrollo.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(proxyHops) || proxyHops < 0) {
    throw new Error('Revisa PORT y TRUST_PROXY_HOPS.');
  }
  if (mode === 'dni-local' && (host !== '127.0.0.1' || proxyHops !== 0)) {
    throw new Error('El modo dni-local requiere HOST=127.0.0.1 y TRUST_PROXY_HOPS=0.');
  }
  const publicOrigin = env.PUBLIC_ORIGIN || (env.VERCEL_URL && 'https://' + env.VERCEL_URL) || ('http://127.0.0.1:' + port);
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(publicOrigin);
  } catch {
    throw new Error('PUBLIC_ORIGIN debe ser un origen válido.');
  }
  if (parsedOrigin.origin !== publicOrigin || !['http:', 'https:'].includes(parsedOrigin.protocol)
    || (production && parsedOrigin.protocol !== 'https:')) {
    throw new Error('PUBLIC_ORIGIN debe ser un origen sin ruta y usar HTTPS en producción.');
  }

  const professors = z.array(professorSchema).length(4).parse(
    JSON.parse(readFileSync(resolve(cloud ? process.cwd() : projectRoot, 'backend/config/profesores.json'), 'utf8')),
  );
  if (new Set(professors.map(professor => professor.id)).size !== professors.length) {
    throw new Error('Los identificadores de los profesores deben ser únicos.');
  }
  const votesFile = resolve(projectRoot, env.VOTES_FILE || (mode === 'mock' ? 'backend/data/votos.mock.json' : 'backend/data/votos.json'));
  const staticDir = resolve(projectRoot, 'frontend/dist');
  const relativeToStatic = relative(staticDir, votesFile);
  if (!isAbsolute(relativeToStatic) && !relativeToStatic.startsWith('..' + sep) && relativeToStatic !== '..') {
    throw new Error('VOTES_FILE debe estar fuera de la carpeta pública.');
  }
  return {
    cloud, production, mode, port, proxyHops, password, hmacKey, professors,
    host,
    allowedOrigins: production ? [...new Set([publicOrigin, env.VERCEL_URL && 'https://' + env.VERCEL_URL].filter(Boolean))] : [publicOrigin, 'http://127.0.0.1:5173', 'http://localhost:5173'],
    votesFile, staticDir, candidatesFile: resolve(dirname(votesFile), mode === 'mock' ? 'candidatos.mock.json' : 'candidatos.json'), rosterFile: resolve(projectRoot, 'backend/data/padron.json'),
  };
}

export type Config = ReturnType<typeof loadConfig>;
