import {z} from 'zod';
import {HttpError} from './errors.js';

export const namesSchema = z.object({
  nombres: z.string().trim().min(1).max(120),
  apellidoPaterno: z.string().trim().min(1).max(100),
  apellidoMaterno: z.string().trim().max(100),
});

export const professorSchema = z.object({
  id: z.number().int().positive(),
  nombre: z.string().trim().min(1).max(100),
});

export const lookupSchema = z.strictObject({
  dni: z.string().regex(/^[0-9]{8}$/),
  datos: namesSchema.strict().optional(),
  eleccionId: z.number().int().positive().optional(),
  codigo: z.string().min(1).max(128).optional(),
});
export const ballotSchema = z.strictObject({
  ticket: z.string().regex(/^[\w-]{43}$/),
  profesorId: z.number().int().positive(),
});
export const loginSchema = z.strictObject({password: z.string().min(1).max(256)});

export function parseBody<T>(schema: z.ZodType<T>, body: unknown, message: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, 'SOLICITUD_INVALIDA', message);
  return parsed.data;
}

export type Names = z.infer<typeof namesSchema>;
export type Professor = z.infer<typeof professorSchema>;
