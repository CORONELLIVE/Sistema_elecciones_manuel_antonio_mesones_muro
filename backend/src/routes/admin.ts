import {createHash, timingSafeEqual} from 'node:crypto';
import {json, Router, type CookieOptions, type Request} from 'express';
import {z} from 'zod';
import type {Config} from '../config.js';
import {HttpError} from '../errors.js';
import {candidateInput, type Candidates} from '../services/candidates.js';
import {resultsPdf} from '../services/results-pdf.js';
import {expiringTokens, sharedTokens} from '../services/expiring.js';
import type {VoteStore} from '../services/votes.js';
import {loginSchema, parseBody} from '../validation.js';
import {limit} from './ballot.js';

function searchable(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es-PE');
}

export function adminRoutes(config: Config, store: VoteStore, candidates: Candidates) {
  const router = Router();
  const duration = 4 * 60 * 60_000;
  const sessions = config.cloud ? sharedTokens<true>('sesiones.json', duration, 1000, config.hmacKey)
    : expiringTokens<true>(duration, 1000);
  const cookieName = config.production ? '__Host-eleccion_admin' : 'eleccion_admin';
  const cookie: CookieOptions = {httpOnly: true, secure: config.production, sameSite: 'strict', path: '/'};
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const passwordHash = digest(config.password);

  function sessionToken(req: Request) {
    return req.headers.cookie?.split(';').map(part => part.trim())
      .find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
  }

  router.post('/login', limit(8, 15 * 60_000, config, 'admin'), async (req, res) => {
    const {password} = parseBody(loginSchema, req.body, 'Ingresa la contraseña administrativa.');
    if (!timingSafeEqual(digest(password), passwordHash)) {
      throw new HttpError(401, 'ACCESO_DENEGADO', 'La contraseña no es correcta.');
    }
    await sessions.remove(sessionToken(req));
    const token = await sessions.issue(true);
    if (!token) throw new HttpError(503, 'CAPACIDAD', 'No hay sesiones disponibles. Intenta nuevamente.');
    res.cookie(cookieName, token, {...cookie, maxAge: duration}).status(204).end();
  });

  router.use(async (req, _res, next) => {
    if (!await sessions.get(sessionToken(req))) throw new HttpError(401, 'SESION_REQUERIDA', 'Inicia sesión para continuar.');
    next();
  });

  router.post('/logout', async (req, res) => {
    await sessions.remove(sessionToken(req));
    res.clearCookie(cookieName, cookie).status(204).end();
  });

  router.post('/candidatos/guardar', json({limit: '3mb'}), async (req, res) => {
    await candidates.save(parseBody(candidateInput, req.body, 'Revisa el nombre y la foto del candidato.'));
    res.json(await candidates.active());
  });

  router.post('/candidatos/retirar', async (req, res) => {
    const {id} = parseBody(z.strictObject({id: z.number().int().positive()}), req.body, 'Selecciona un candidato válido.');
    await candidates.remove(id);
    res.json(await candidates.active());
  });

  router.post('/elecciones/iniciar', async (req, res) => {
    const {actual, nombre} = parseBody(z.strictObject({
      actual: z.number().int().positive(), nombre: z.string().trim().min(1).max(100),
    }), req.body, 'Escribe el nombre de la nueva votación.');
    res.json(await store.startElection(actual, nombre, candidates.snapshot));
  });

  router.get('/elecciones/:id/resultados.pdf', async (req, res) => {
    const id = Number(req.params.id);
    const data = await store.snapshot();
    const archived = data.historial.find(item => item.id === id);
    if (data.eleccion.id !== id && !archived) throw new HttpError(404, 'ELECCION_NO_ENCONTRADA', 'Votación no encontrada.');
    const votes = archived?.votos ?? data.votos;
    const counts = new Map<number, number>();
    for (const vote of votes) counts.set(vote.profesorId, (counts.get(vote.profesorId) ?? 0) + 1);
    const rows = archived?.candidatos ?? await candidates.results(counts);
    const pdf = resultsPdf(archived ?? data.eleccion, rows.map(item => ({nombre: item.nombre, votos: counts.get(item.id) ?? 0})), votes.length);
    res.attachment('resultados-votacion-' + id + '.pdf');
    pdf.on('error', error => res.destroy(error));
    pdf.pipe(res);
    pdf.end();
  });

  router.get('/resultados', async (req, res) => {
    const {profesor, buscar, pagina} = req.query;
    const professorId = typeof profesor === 'string' ? Number(profesor) : undefined;
    const page = typeof pagina === 'string' && /^\d{1,8}$/.test(pagina) ? Math.max(1, Number(pagina)) : 1;
    const search = typeof buscar === 'string' ? searchable(buscar.trim().slice(0, 150)) : '';
    if (profesor !== undefined && (professorId === undefined || !await candidates.has(professorId))) {
      throw new HttpError(400, 'PROFESOR_INVALIDO', 'Selecciona un candidato válido.');
    }

    const data = await store.snapshot();
    const votes = data.votos;
    const counts = new Map<number, number>();
    for (const vote of votes) counts.set(vote.profesorId, (counts.get(vote.profesorId) || 0) + 1);
    const results = (await candidates.results(counts)).map(item => ({
      ...item,
      votos: counts.get(item.id) || 0,
      porcentaje: votes.length ? 100 * (counts.get(item.id) || 0) / votes.length : 0,
    }));
    const top = Math.max(0, ...results.map(item => item.votos));
    const rows = votes.map((vote, index) => ({
      numero: index + 1,
      alumno: 'nombres' in vote ? [vote.nombres, vote.apellidoPaterno, vote.apellidoMaterno].filter(Boolean).join(' ') : '',
      profesorId: vote.profesorId,
      fechaVoto: vote.fechaVoto,
    })).reverse().filter(row =>
      (professorId === undefined || row.profesorId === professorId) && searchable(row.alumno).includes(search),
    );
    const perPage = 10;
    const pages = Math.max(1, Math.ceil(rows.length / perPage));
    const current = Math.min(page, pages);
    res.json({
      eleccion: data.eleccion,
      historial: data.historial.map(({id, nombre, cierre, votos}) => ({id, nombre, cierre, total: votos.length})).reverse(),
      total: votes.length,
      participantes: votes.length,
      lideres: top ? results.filter(item => item.votos === top).map(item => item.nombre) : [],
      ultimoVoto: votes.at(-1)?.fechaVoto ?? null,
      resultados: results,
      candidatos: await candidates.active(),
      registros: rows.slice((current - 1) * perPage, current * perPage),
      coincidencias: rows.length, pagina: current, paginas: pages,
    });
  });

  return router;
}
