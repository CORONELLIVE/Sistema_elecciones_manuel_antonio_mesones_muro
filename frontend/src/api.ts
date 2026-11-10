export type Professor = {id: number; nombre: string; fotoUrl?: string};
export type Student = {nombres: string; apellidoPaterno: string; apellidoMaterno: string};
export type Verification = {alumno: Student | null; ticket: string};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, options: {body?: object; signal?: AbortSignal} = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api' + path, {
      signal: options.signal,
      ...(options.body && {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-Eleccion': '1'},
        body: JSON.stringify(options.body),
      }),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(0, 'SIN_CONEXION', 'No pudimos conectar con el servidor. Vuelve a intentar.');
  }
  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    throw new ApiError(response.status, result?.code || 'ERROR', result?.message || 'Ocurrió un error. Vuelve a intentar.');
  }
  return result as T;
}

export function fullName(student: Student) {
  return [student.nombres, student.apellidoPaterno, student.apellidoMaterno].filter(Boolean).join(' ');
}

const formatter = new Intl.DateTimeFormat('es-PE', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima',
});
export const formatDate = (value: string) => formatter.format(new Date(value));
