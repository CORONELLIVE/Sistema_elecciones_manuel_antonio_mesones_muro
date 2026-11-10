import {createDecipheriv, createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import {privateSnapshot} from './private-store.js';
import {HttpError} from '../errors.js';
import {namesSchema, type Names} from '../validation.js';

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const rosterSchema = z.object({
  keyCheck: hashSchema,
  students: z.array(z.object({studentKey: hashSchema, dniHash: hashSchema.optional(), documentoCifrado: z.string().optional(), names: namesSchema, matricula: z.string(), tipoDocumento: z.string()})).min(1),
});

function nameKey({nombres, apellidoPaterno, apellidoMaterno}: Names) {
  return JSON.stringify([nombres, apellidoPaterno, apellidoMaterno].map(value =>
    value.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toUpperCase(),
  ));
}

export async function loadRoster(file: string, secret: string, cloud = false) {
  const {keyCheck, students} = rosterSchema.parse(cloud ? (await privateSnapshot('padron.json'))?.data : JSON.parse(await readFile(file, 'utf8')));
  const expected = createHmac('sha256', Buffer.from(secret, 'hex')).update('padron:clave:v1').digest('hex');
  if (keyCheck !== expected) throw new Error('El padrón requiere la misma DNI_HMAC_KEY con la que fue importado.');
  const known = new Map<string, (typeof students)[number]>();
  const missing = new Map<string, (typeof students)[number]>();
  const keys = new Set<string>();
  const byName = new Map<string, (typeof students)[number][]>();
  const cipherKey = createHmac('sha256', Buffer.from(secret, 'hex')).update('padron:documento:cifrado:v1').digest();
  for (const student of students) {
    if (keys.has(student.studentKey)) throw new Error('El padrón contiene códigos de estudiante duplicados.');
    keys.add(student.studentKey);
    if (student.matricula === 'DEFINITIVA') {
      const key = nameKey(student.names);
      const matches = byName.get(key) ?? [];
      matches.push(student);
      byName.set(key, matches);
    }
    if (!student.dniHash && (student.matricula !== 'DEFINITIVA' || student.tipoDocumento)) continue;
    const map = student.dniHash ? known : missing;
    const index = student.dniHash ?? nameKey(student.names);
    if (map.has(index)) throw new Error('El padrón contiene registros ambiguos.');
    map.set(index, student);
  }
  return {
    eligibleCount: [...known.values()].filter(student => student.matricula === "DEFINITIVA").length + missing.size,
    findDni(names: Names) {
      const matches = byName.get(nameKey(names));
      const student = matches?.length === 1 ? matches[0] : undefined;
      if (!student?.documentoCifrado || !student.dniHash) {
        throw new HttpError(404, 'NOMBRE_NO_UNICO', 'No se encontró un DNI único. Revisa tus nombres y apellidos o pide ayuda al encargado.');
      }
      const encrypted = Buffer.from(student.documentoCifrado, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', cipherKey, encrypted.subarray(0, 12));
      decipher.setAuthTag(encrypted.subarray(-16));
      const dni = Buffer.concat([decipher.update(encrypted.subarray(12, -16)), decipher.final()]).toString('utf8');
      if (!/^[0-9]{8}$/.test(dni) || createHmac('sha256', Buffer.from(secret, 'hex')).update(dni).digest('hex') !== student.dniHash) {
        throw new Error('Documento del padrón incoherente.');
      }
      return dni;
    },
    find(hash: string, supplied?: Names) {
      const knownStudent = known.get(hash);
      if (knownStudent) {
        if (knownStudent.matricula !== 'DEFINITIVA') {
          throw new HttpError(403, 'MATRICULA_NO_HABILITADA', 'Esta matrícula no está habilitada para votar.');
        }
        return knownStudent;
      }
      if (!missing.size) {
        throw new HttpError(404, 'DNI_NO_EN_PADRON', 'Este DNI no figura en el padrón escolar. Revisa los dígitos o busca por nombre completo.');
      }
      if (!supplied) throw new HttpError(422, 'COMPLETAR_DATOS', 'Si tu DNI no figura en el padrón, completa tus nombres y apellidos tal como aparecen en tu matrícula.');
      const student = missing.get(nameKey(supplied));
      if (!student) throw new HttpError(422, 'DATOS_NO_COINCIDEN', 'Los datos no coinciden con una matrícula definitiva sin DNI registrado.');
      return student;
    },
  };
}

export type Roster = Awaited<ReturnType<typeof loadRoster>>;
