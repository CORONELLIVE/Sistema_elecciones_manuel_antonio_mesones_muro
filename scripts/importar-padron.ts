import {spawnSync} from 'node:child_process';
import {createCipheriv, createHmac, randomBytes, randomUUID} from 'node:crypto';
import {rename, rm, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {loadRoster} from '../backend/src/services/roster.js';

const root = process.argv[2];
const key = process.env.DNI_HMAC_KEY || '';
if (!root || !/^[a-f0-9]{64}$/i.test(key)) {
  throw new Error('Indica la carpeta que contiene los cinco grados y configura DNI_HMAC_KEY en .env.');
}
const reader = fileURLToPath(new URL('./leer-padron.py', import.meta.url));
const result = spawnSync(process.env.PYTHON || 'python', [reader, root], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
if (result.status !== 0) throw new Error('No se pudieron leer los Excel. Revisa las carpetas y la instalación de openpyxl.');
const rows = z.array(z.object({
  codigoEstudiante: z.string().min(1), numeroDocumento: z.string(), tipoDocumento: z.string(),
}).passthrough()).min(1).parse(JSON.parse(result.stdout));

const hmac = (value: string) => createHmac('sha256', Buffer.from(key, 'hex')).update(value).digest();
const cipherKey = hmac('padron:documento:cifrado:v1');
const students = rows.map(({numeroDocumento, ...row}) => {
  const dni = row.tipoDocumento === 'DNI';
  if (dni && !/^[0-9]{8}$/.test(numeroDocumento)) throw new Error('Hay un DNI con formato incorrecto.');
  let documentoCifrado: string | undefined;
  if (numeroDocumento) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', cipherKey, nonce);
    documentoCifrado = Buffer.concat([nonce, cipher.update(numeroDocumento, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64url');
  }
  return {
    ...row, studentKey: hmac('padron:estudiante:' + row.codigoEstudiante).toString('hex'),
    dniHash: dni ? hmac(numeroDocumento).toString('hex') : undefined, documentoCifrado,
  };
});
const file = fileURLToPath(new URL('../backend/data/padron.json', import.meta.url));
const temporary = file + '.' + randomUUID() + '.tmp';
try {
  await writeFile(temporary, JSON.stringify({keyCheck: hmac('padron:clave:v1').toString('hex'), students}, null, 2) + '\n',
    {flag: 'wx', mode: 0o600});
  await loadRoster(temporary, key);
  await rename(temporary, file);
} finally {
  await rm(temporary, {force: true});
}
console.log(students.length + ' registros guardados en el padrón privado.');
