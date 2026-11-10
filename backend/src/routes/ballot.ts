import {createHmac} from 'node:crypto';
import {Router, type RequestHandler} from 'express';
import {rateLimit} from 'express-rate-limit';
import type {Config} from '../config.js';
import {duplicateVote, HttpError} from '../errors.js';
import type {Candidates} from '../services/candidates.js';
import type {DniProvider} from '../services/dni.js';
import {privateChange} from '../services/private-store.js';
import {expiringTokens, sharedTokens} from '../services/expiring.js';
import type {Roster} from '../services/roster.js';
import type {VoteStore} from '../services/votes.js';
import {ballotSchema, lookupSchema, namesSchema, parseBody, type Names} from '../validation.js';

export function limit(max: number, windowMs: number, config?: Config, scope?: string): RequestHandler {
  if (config?.cloud && scope) {
    return async (req, _res, next) => {
      const now = Date.now();
      const address = createHmac('sha256', config.hmacKey).update(req.ip ?? '').digest('hex');
      await privateChange('limites-' + scope + '.json', value => value as Record<string, {expires: number; count: number}>, entries => {
        const entry = entries[address];
        if (entry && entry.expires > now && entry.count >= max) {
          throw new HttpError(429, 'DEMASIADAS_SOLICITUDES', 'Hay demasiados intentos. Espera unos minutos y vuelve a intentar.');
        }
        for (const [key, current] of Object.entries(entries)) {
          if (current.expires <= now) delete entries[key];
        }
        entries[address] ??= {expires: now + windowMs, count: 0};
        entries[address].count++;
      }, (): Record<string, {expires: number; count: number}> => ({}));
      next();
    };
  }
  return rateLimit({
    limit: max, windowMs, standardHeaders: 'draft-8', legacyHeaders: false,
    message: {code: 'DEMASIADAS_SOLICITUDES', message: 'Hay demasiados intentos. Espera unos minutos y vuelve a intentar.'},
  });
}

export type VoterVerifier = (dni: string, code: string | undefined) => Promise<void>;

export function ballotRoutes(config: Config, store: VoteStore, candidates: Candidates, verifyStudent: DniProvider, verifyVoter?: VoterVerifier, roster?: Roster) {
  const router = Router();
  type Ticket = {hash: string; names: Names | null; electionId: number; dni?: string; studentKey?: string};
  const tickets = config.cloud ? sharedTokens<Ticket>('comprobantes.json', 10 * 60_000, 10_000, config.hmacKey)
    : expiringTokens<Ticket>(10 * 60_000, 10_000);

  const nameLookup = Boolean(roster && !config.production && config.host === '127.0.0.1' && config.proxyHops === 0);

  router.get('/eleccion', async (_req, res) => {
    const {eleccion, votos} = await store.snapshot();
    const participaron = votos.length;
    const total = roster?.eligibleCount ?? null;
    const participacion = {total, participaron, pendientes: total === null ? null : Math.max(0, total - participaron)};
    res.json({eleccion, participacion, profesores: await candidates.active(), modoPrueba: config.mode === 'mock', soloDni: config.mode === 'dni-local', buscarPorNombre: nameLookup});
  });

  router.post('/alumnos/buscar-nombre', limit(30, 60_000), (req, res) => {
    const origin = req.get('origin');
    if (!nameLookup || !roster || !origin || !['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)
      || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
      || req.get('x-forwarded-for')) {
      throw new HttpError(403, 'BUSQUEDA_LOCAL', 'La búsqueda por nombre está habilitada en la PC de votación.');
    }
    const names = parseBody(namesSchema.strict(), req.body, 'Completa tus nombres y apellidos.');
    res.json({dni: roster.findDni(names)});
  });

  router.get('/candidatos/:id/foto', async (req, res) => {
    const image = await candidates.image(Number(req.params.id));
    if (!image) throw new HttpError(404, 'FOTO_NO_ENCONTRADA', 'Foto no encontrada.');
    res.type(image.type).send(Buffer.from(image.data, 'base64'));
  });

  router.post('/alumnos/consulta', limit(30, 60_000, config, 'consulta'), async (req, res) => {
    const {dni, codigo, datos, eleccionId} = parseBody(lookupSchema, req.body, 'El DNI debe tener exactamente 8 dígitos.');
    const {eleccion} = await store.snapshot();
    if (eleccionId !== undefined && eleccionId !== eleccion.id) {
      throw new HttpError(409, 'ELECCION_CAMBIO', 'Empezó otra votación. Revisa la nueva papeleta.');
    }
    const hash = store.hash(dni);
    if (verifyVoter) await verifyVoter(dni, codigo);
    if (await store.hasVoted(hash)) throw duplicateVote();
    const student = roster?.find(hash, datos);
    if (student && await store.hasVoted(hash, student.studentKey)) throw duplicateVote();
    const names = student ? student.names : config.mode === 'dni-local' ? null : await verifyStudent(dni);
    if (config.mode !== 'dni-local' && !names) {
      throw new HttpError(503, 'DNI_NO_VERIFICADO', 'No pudimos verificar tu DNI. Intenta nuevamente en unos minutos.');
    }
    if (await store.hasVoted(hash)) throw duplicateVote();
    const ticket = await tickets.issue({hash, names, electionId: eleccion.id, dni: student ? dni : undefined, studentKey: student?.studentKey});
    if (!ticket) throw new HttpError(503, 'CAPACIDAD', 'Hay muchas consultas activas. Intenta nuevamente en unos minutos.');
    res.json({alumno: names, ticket});
  });

  router.post('/votos', limit(20, 60_000, config, 'votos'), async (req, res) => {
    const {ticket, profesorId} = parseBody(ballotSchema, req.body, 'La solicitud de voto no es válida.');
    const verified = await tickets.get(ticket);
    if (!verified) throw new HttpError(401, 'VERIFICACION_VENCIDA', 'Ingresa tu DNI nuevamente para continuar.');
    res.status(201).json(await store.register(verified.electionId, verified.hash, verified.names, profesorId, verified.dni, verified.studentKey));
  });

  return router;
}
