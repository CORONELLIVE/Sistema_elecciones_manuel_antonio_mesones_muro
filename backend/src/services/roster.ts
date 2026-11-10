import {createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID} from 'node:crypto';
import {readFile, rename, rm, writeFile} from 'node:fs/promises';
import {z} from 'zod';
import {privateChange, privateSnapshot} from './private-store.js';
import {HttpError} from '../errors.js';
import {namesSchema, type Names} from '../validation.js';

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const rosterSchema = z.looseObject({
  keyCheck: hashSchema,
  students: z.array(z.looseObject({grado: z.number().int().min(1).max(5).nullable().optional(), seccion: z.string().optional(), studentKey: hashSchema, dniHash: hashSchema.optional(), documentoCifrado: z.string().optional(), names: namesSchema, matricula: z.string(), tipoDocumento: z.string()})),
});

type RosterData = z.infer<typeof rosterSchema>;

export const rosterInput = z.strictObject({
  id: hashSchema.optional(),
  dni: z.string().regex(/^[0-9]{8}$/).optional(),
  names: namesSchema.strict(),
  matricula: z.enum(['DEFINITIVA', 'TRASLADADO']),
  grado: z.number().int().min(1).max(5).nullable(),
  seccion: z.string().trim().max(12).toUpperCase(),
});

function checkRoster(value: unknown, secret: string) {
  const data = rosterSchema.parse(value);
  const expected = createHmac('sha256', Buffer.from(secret, 'hex')).update('padron:clave:v1').digest('hex');
  if (data.keyCheck !== expected) throw new Error('El padrón requiere la misma DNI_HMAC_KEY con la que fue importado.');
  return data;
}

async function readRoster(file: string, secret: string, cloud: boolean) {
  return checkRoster(cloud ? (await privateSnapshot('padron.json'))?.data : JSON.parse(await readFile(file, 'utf8')), secret);
}

export function rosterStore(file: string, secret: string, cloud: boolean) {
  const hmac = (value: string) => createHmac('sha256', Buffer.from(secret, 'hex')).update(value).digest();
  const key = hmac('padron:documento:cifrado:v1');
  let pending = Promise.resolve();
  function change(update: (data: RosterData) => void) {
    if (cloud) return privateChange('padron.json', value => checkRoster(value, secret), update);
    const operation = pending.then(async () => {
      const data = await readRoster(file, secret, cloud);
      update(data);
      const temp = file + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temp, JSON.stringify(data, null, 2) + '\n', {flag: 'wx', mode: 0o600});
        await rename(temp, file);
      } finally {
        await rm(temp, {force: true});
      }
    });
    pending = operation.catch(() => undefined);
    return operation;
  }

  return {
    load: () => loadRoster(file, secret, cloud),
    async list(query: string, page: number) {
      const search = normalize(query);
      const hash = /^[0-9]{8}$/.test(search) ? hmac(search).toString('hex') : undefined;
      const matches = (await readRoster(file, secret, cloud)).students.filter(student =>
        (hash && student.dniHash === hash) ||
        normalize([student.names.nombres, student.names.apellidoPaterno, student.names.apellidoMaterno,
          student.grado, student.seccion].filter(Boolean).join(' ')).includes(search),
      );
      const pages = Math.max(1, Math.ceil(matches.length / 20));
      const current = Math.min(page, pages);
      return {total: matches.length, page: current, pages, students: matches.slice((current - 1) * 20, current * 20).map(student => ({
        id: student.studentKey, names: student.names, dni: decodeDni(student, secret, key),
        tieneDni: Boolean(student.dniHash), tipoDocumento: student.tipoDocumento, matricula: student.matricula,
        grado: student.grado ?? null, seccion: student.seccion ?? '',
      }))};
    },
    save(input: z.infer<typeof rosterInput>) {
      return change(data => {
        const previous = input.id ? data.students.find(student => student.studentKey === input.id) : undefined;
        if (input.id && !previous) throw new HttpError(404, 'ALUMNO_NO_ENCONTRADO', 'El registro ya no existe.');
        const dniHash = input.dni ? hmac(input.dni).toString('hex') : previous?.dniHash;
        if (dniHash && data.students.some(student => student.dniHash === dniHash && student !== previous)) {
          throw new HttpError(409, 'DNI_DUPLICADO', 'Ese DNI ya figura en otro registro.');
        }
        let documentoCifrado = previous?.documentoCifrado;
        if (input.dni) {
          const nonce = randomBytes(12);
          const cipher = createCipheriv('aes-256-gcm', key, nonce);
          documentoCifrado = Buffer.concat([nonce, cipher.update(input.dni), cipher.final(), cipher.getAuthTag()]).toString('base64url');
        }
        const updated = {...previous, studentKey: previous?.studentKey ?? hmac(randomUUID()).toString('hex'),
          dniHash, documentoCifrado, names: input.names, matricula: input.matricula, grado: input.grado,
          seccion: input.seccion, tipoDocumento: input.dni ? 'DNI' : previous?.tipoDocumento ?? ''};
        if (!updated.dniHash && !updated.tipoDocumento && updated.matricula === 'DEFINITIVA' && data.students.some(student =>
          student !== previous && !student.dniHash && !student.tipoDocumento && student.matricula === 'DEFINITIVA'
          && nameKey(student.names) === nameKey(updated.names))) {
          throw new HttpError(409, 'PADRON_DUPLICADO', 'Ya existe un registro con ese nombre sin documento.');
        }
        if (previous) data.students[data.students.indexOf(previous)] = updated;
        else data.students.unshift(updated);
      });
    },
    remove(id: string) {
      return change(data => {
        const index = data.students.findIndex(student => student.studentKey === id);
        if (index < 0) throw new HttpError(404, 'ALUMNO_NO_ENCONTRADO', 'El registro ya no existe.');
        data.students.splice(index, 1);
      });
    },
  };
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function decodeDni(student: RosterData['students'][number], secret: string, key: Buffer) {
  if (!student.documentoCifrado || !student.dniHash) return null;
  const encrypted = Buffer.from(student.documentoCifrado, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(0, 12));
  decipher.setAuthTag(encrypted.subarray(-16));
  const dni = Buffer.concat([decipher.update(encrypted.subarray(12, -16)), decipher.final()]).toString('utf8');
  if (!/^[0-9]{8}$/.test(dni) || createHmac('sha256', Buffer.from(secret, 'hex')).update(dni).digest('hex') !== student.dniHash) {
    throw new Error('Documento del padrón incoherente.');
  }
  return dni;
}

function nameKey({nombres, apellidoPaterno, apellidoMaterno}: Names) {
  return JSON.stringify([nombres, apellidoPaterno, apellidoMaterno].map(value =>
    value.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toUpperCase(),
  ));
}

export async function loadRoster(file: string, secret: string, cloud = false) {
  const {students} = await readRoster(file, secret, cloud);
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
      return decodeDni(student, secret, cipherKey)!;
    },
    accepts(hash: string, studentKey: string) {
      const student = known.get(hash);
      if (student) return student.studentKey === studentKey && student.matricula === 'DEFINITIVA';
      return [...missing.values()].some(item => item.studentKey === studentKey);
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
