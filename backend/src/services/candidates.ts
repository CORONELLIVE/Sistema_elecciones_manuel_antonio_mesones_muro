import {createHash, randomUUID} from 'node:crypto';
import {readFile, rename, rm, writeFile} from 'node:fs/promises';
import {z} from 'zod';
import {HttpError} from '../errors.js';
import {professorSchema, type Professor} from '../validation.js';

const types = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
const photoSchema = z.strictObject({
  type: z.enum(types),
  data: z.string().min(4).max(2_796_204).regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
const candidateSchema = professorSchema.extend({active: z.boolean(), photo: photoSchema.optional()});
const fileSchema = z.object({nextId: z.number().int().positive(), candidates: z.array(candidateSchema)})
  .refine(({nextId, candidates}) => new Set(candidates.map(item => item.id)).size === candidates.length
    && candidates.every(item => item.id < nextId));
type Candidate = z.infer<typeof candidateSchema>;

export const candidateInput = z.strictObject({
  id: professorSchema.shape.id.optional(),
  nombre: professorSchema.shape.nombre,
  photo: photoSchema.optional(),
});

function validatePhoto(photo: z.infer<typeof photoSchema>) {
  const data = Buffer.from(photo.data, 'base64');
  const signatures = {
    'image/png': () => data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    'image/jpeg': () => data.subarray(0, 3).toString('hex') === 'ffd8ff',
    'image/gif': () => ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6)),
    'image/webp': () => data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP',
  };
  if (data.length > 2 * 1024 * 1024 || data.toString('base64') !== photo.data || !signatures[photo.type]()) {
    throw new HttpError(400, 'FOTO_INVALIDA', 'Elige una imagen PNG, JPG, WebP o GIF válida de hasta 2 MB.');
  }
}

function publicCandidate({id, nombre, photo}: Candidate) {
  const version = photo && createHash('sha256').update(photo.data).digest('hex').slice(0, 16);
  return {id, nombre, fotoUrl: version ? '/api/candidatos/' + id + '/foto?v=' + version : undefined};
}

export async function loadCandidates(file: string, initial: Professor[]) {
  let current = {nextId: Math.max(0, ...initial.map(item => item.id)) + 1,
    candidates: initial.map(item => ({...item, active: true})) as Candidate[]};
  try {
    current = fileSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  let pending = Promise.resolve();
  function update(change: (draft: typeof current) => void) {
    const operation = pending.then(async () => {
      const draft = {nextId: current.nextId, candidates: [...current.candidates]};
      change(draft);
      const temporary = file + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, JSON.stringify(fileSchema.parse(draft), null, 2), {flag: 'wx', mode: 0o600});
        await rename(temporary, file);
        current = draft;
      } finally {
        await rm(temporary, {force: true}).catch(() => undefined);
      }
    });
    pending = operation.catch(() => undefined);
    return operation;
  }

  function findActive(id: number) {
    return current.candidates.find(item => item.id === id && item.active);
  }

  return {
    has: (id: number) => current.candidates.some(item => item.id === id),
    isActive: (id: number) => Boolean(findActive(id)),
    snapshot: (votedIds: Set<number>) => current.candidates.filter(item => item.active || votedIds.has(item.id)).map(publicCandidate),
    active: () => current.candidates.filter(item => item.active).map(publicCandidate),
    results: (counts: Map<number, number>) => current.candidates.filter(item => item.active || counts.has(item.id))
      .map(item => ({...publicCandidate(item), retirado: !item.active})),
    image: (id: number) => findActive(id)?.photo,
    save(input: z.infer<typeof candidateInput>) {
      if (input.photo) validatePhoto(input.photo);
      return update(draft => {
        if (input.id === undefined) {
          if (draft.candidates.filter(item => item.active).length >= 40) {
            throw new HttpError(400, 'LIMITE_CANDIDATOS', 'Se admiten hasta 40 candidatos activos.');
          }
          draft.candidates.push({id: draft.nextId++, nombre: input.nombre, active: true, photo: input.photo});
          return;
        }
        const index = draft.candidates.findIndex(item => item.id === input.id && item.active);
        if (index < 0) throw new HttpError(404, 'CANDIDATO_NO_ENCONTRADO', 'El candidato ya no está en la papeleta.');
        const previous = draft.candidates[index];
        draft.candidates[index] = {...previous, nombre: input.nombre, photo: input.photo ?? previous.photo};
      });
    },
    remove(id: number) {
      return update(draft => {
        const index = draft.candidates.findIndex(item => item.id === id && item.active);
        if (index < 0) throw new HttpError(404, 'CANDIDATO_NO_ENCONTRADO', 'El candidato ya no está en la papeleta.');
        draft.candidates[index] = {id, nombre: draft.candidates[index].nombre, active: false};
      });
    },
  };
}

export type Candidates = Awaited<ReturnType<typeof loadCandidates>>;
