import {BlobPreconditionFailedError, get, put} from '@vercel/blob';
import {HttpError} from '../errors.js';

export async function privateSnapshot(path: string) {
  const result = await get(path, {access: 'private', useCache: false});
  if (!result || result.statusCode !== 200) return null;
  // Blob marks the ETag weak on compressed reads. Conditional writes use the stored object's ETag.
  const etag = result.blob.etag.replace(/^W\//, '');
  return {data: JSON.parse(await new Response(result.stream).text()) as unknown, etag};
}

export async function privateChange<State, Result>(
  path: string, parse: (value: unknown) => State, change: (state: State) => Result | Promise<Result>,
  initial?: () => State,
) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const current = await privateSnapshot(path);
    if (!current && !initial) throw new Error('Falta inicializar el almacenamiento privado.');
    const state = current ? parse(current.data) : initial!();
    const result = await change(state);
    try {
      await put(path, JSON.stringify(parse(state)), {
        access: 'private', contentType: 'application/json',
        ...(current ? {ifMatch: current.etag} : {allowOverwrite: false}),
      });
      return result;
    } catch (error) {
      const conflict = error instanceof BlobPreconditionFailedError
        || (!current && error instanceof Error && /already exists/i.test(error.message));
      if (!conflict) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1) + Math.random() * 80));
    }
  }
  throw new HttpError(503, 'ALMACEN_OCUPADO', 'Hay varias solicitudes en curso. Vuelve a intentarlo.');
}
