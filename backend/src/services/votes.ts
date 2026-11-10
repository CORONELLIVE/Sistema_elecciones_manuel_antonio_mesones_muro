import {createCipheriv, createHmac, randomBytes, randomUUID} from 'node:crypto';
import {mkdir, open, readFile, rename, rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {z} from 'zod';
import {duplicateVote, HttpError} from '../errors.js';
import {namesSchema, professorSchema, type Names} from '../validation.js';

const voteFields = z.strictObject({
  id: z.uuid(),
  dniHash: z.string().regex(/^[0-9a-f]{64}$/),
  dniCifrado: z.string().regex(/^[A-Za-z0-9_-]{48}$/).optional(),
  studentKey: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  profesorId: z.number().int().positive(),
  fechaVoto: z.iso.datetime(),
});
const voteSchema = z.union([voteFields.extend(namesSchema.shape), voteFields]);
const voteList = z.array(voteSchema).refine(votos =>
  new Set(votos.map(vote => vote.dniHash)).size === votos.length
  && new Set(votos.map(vote => vote.id)).size === votos.length,
);
const electionSchema = z.object({id: z.number().int().positive(), nombre: z.string().trim().min(1).max(100)});
const archivedSchema = electionSchema.extend({
  cierre: z.iso.datetime(), votos: voteList, candidatos: z.array(professorSchema),
});
const votesSchema = z.strictObject({
  votos: voteList,
  eleccion: electionSchema.default({id: 1, nombre: 'Elección de Profesores'}),
  historial: z.array(archivedSchema).default([]),
});
type Votes = z.infer<typeof votesSchema>;

export function makeVoteStore(file: string, secret: string, professors: {has(id: number): boolean; isActive(id: number): boolean}) {
  const encryptionKey = createHmac('sha256', Buffer.from(secret, 'hex')).update('votos:dni:cifrado:v1').digest();
  function encryptDni(dni: string) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
    return Buffer.concat([nonce, cipher.update(dni, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64url');
  }

  let pending = Promise.resolve();

  async function read() {
    const data = votesSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    if (data.votos.some(vote => !professors.has(vote.profesorId))) {
      throw new Error('Hay votos asociados a profesores que no existen en la configuración.');
    }
    return data;
  }

  async function write(data: Votes) {
    const temp = file + '.' + randomUUID() + '.tmp';
    try {
      const handle = await open(temp, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(votesSchema.parse(data), null, 2) + '\n', 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, file);
    } finally {
      await rm(temp, {force: true}).catch(() => undefined);
    }
  }

  function serialize<T>(action: () => Promise<T>) {
    const operation = pending.then(action);
    pending = operation.then(() => undefined, () => undefined);
    return operation;
  }

  return {
    async initialize() {
      await mkdir(dirname(file), {recursive: true, mode: 0o700});
      try {
        await read();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await write(votesSchema.parse({votos: []}));
      }
    },
    hash(dni: string) {
      return createHmac('sha256', Buffer.from(secret, 'hex')).update(dni).digest('hex');
    },
    async hasVoted(hash: string, studentKey?: string) {
      return (await read()).votos.some(vote => vote.dniHash === hash || (studentKey !== undefined && vote.studentKey === studentKey));
    },
    snapshot: read,
    startElection(expectedId: number, nombre: string, candidates: (votedIds: Set<number>) => z.infer<typeof professorSchema>[]) {
      return serialize(async () => {
        const data = await read();
        if (data.eleccion.id !== expectedId) throw new HttpError(409, 'ELECCION_CAMBIO', 'La votación activa cambió. Actualiza el panel.');
        data.historial.push({...data.eleccion, cierre: new Date().toISOString(), votos: data.votos, candidatos: candidates(new Set(data.votos.map(vote => vote.profesorId)))});
        data.eleccion = {id: expectedId + 1, nombre};
        data.votos = [];
        await write(data);
        return data.eleccion;
      });
    },
    register(electionId: number, hash: string, names: Names | null, professorId: number, dni?: string, studentKey?: string) {
      return serialize(async () => {
        const data = await read();
        if (electionId !== data.eleccion.id) throw new HttpError(409, 'ELECCION_CAMBIO', 'Empezó otra votación. Identifícate nuevamente para participar.');
        if (!professors.isActive(professorId)) throw new HttpError(400, 'PROFESOR_INVALIDO', 'Selecciona un profesor válido.');
        if (data.votos.some(vote => vote.dniHash === hash || (studentKey !== undefined && vote.studentKey === studentKey))) throw duplicateVote();
        const vote = {...names, id: randomUUID(), dniHash: hash, profesorId: professorId, fechaVoto: new Date().toISOString()};
        data.votos.push({...vote, ...(dni && {dniCifrado: encryptDni(dni)}), ...(studentKey && {studentKey})});
        await write(data);
        return {fechaVoto: vote.fechaVoto};
      });
    },
  };
}

export type VoteStore = ReturnType<typeof makeVoteStore>;
