import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const env = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const configured = env
  .replace(/^ADMIN_PASSWORD=\r?$/m, 'ADMIN_PASSWORD=' + randomBytes(18).toString('base64url'))
  .replace(/^DNI_HMAC_KEY=\r?$/m, 'DNI_HMAC_KEY=' + randomBytes(32).toString('hex'));
try {
  await writeFile(new URL('../.env', import.meta.url), configured, {flag: 'wx', mode: 0o600});
  console.log('Configuración local creada. Consulta ADMIN_PASSWORD en .env para entrar a /admin.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('La configuración .env ya existe.');
}
