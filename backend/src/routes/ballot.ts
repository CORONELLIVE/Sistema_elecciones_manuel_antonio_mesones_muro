import {Router} from 'express';
import {rateLimit} from 'express-rate-limit';
import type {Config} from '../config.js';
import {duplicateVote, HttpError} from '../errors.js';
import type {Candidates} from '../services/candidates.js';
import type {DniProvider} from '../services/dni.js';
import {expiringTokens} from '../services/expiring.js';
import type {Roster} from '../services/roster.js';
import type {VoteStore} from '../services/votes.js';
import {ballotSchema, lookupSchema, namesSchema, parseBody, type Names} from '../validation.js';

export function limit(max: number, windowMs: number) {
  return rateLimit({
    limit: max, windowMs, standardHeaders: 'draft-8', legacyHeaders: false,
    message: {code: 'DEMASIADAS_SOLICITUDES', message: 'Hay demasiados intentos. Espera unos minutos y vuelve a intentar.'},
  });
}

export type VoterVerifier = (dni: string, code: string | undefined) => Promise<void>;

export function ballotRoutes(config: Config, store: VoteStore, candidates: Candidates, verifyStudent: DniProvider, verifyVoter?: VoterVerifier, roster?: Roster) {
  const router = Router();
  const tickets = expiringTokens<{hash: string; names: Names | null; electionId: number; dni?: string; studentKey?: string}>(10 * 60_000, 10_000);

  const nameLookup = Boolean(roster && !config.production && config.host === '127.0.0.1' && config.proxyHops === 0);

  router.get('/eleccion', async (_req, res) => {
    const {eleccion} = await store.snapshot();
    res.json({eleccion, profesores: candidates.active(), modoPrueba: config.mode === 'mock', soloDni: config.mode === 'dni-local', buscarPorNombre: nameLookup});
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

  router.get('/candidatos/:id/foto', (req, res) => {
    const image = candidates.image(Number(req.params.id));
    if (!image) throw new HttpError(404, 'FOTO_NO_ENCONTRADA', 'Foto no encontrada.');
    res.type(image.type).send(Buffer.from(image.data, 'base64'));
  });

  router.post('/alumnos/consulta', limit(30, 60_000), async (req, res) => {
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
    const ticket = tickets.issue({hash, names, electionId: eleccion.id, dni: student ? dni : undefined, studentKey: student?.studentKey});
    if (!ticket) throw new HttpError(503, 'CAPACIDAD', 'Hay muchas consultas activas. Intenta nuevamente en unos minutos.');
    res.json({alumno: names, ticket});
  });

  router.post('/votos', limit(20, 60_000), async (req, res) => {
    const {ticket, profesorId} = parseBody(ballotSchema, req.body, 'La solicitud de voto no es válida.');
    const verified = tickets.get(ticket);
    if (!verified) throw new HttpError(401, 'VERIFICACION_VENCIDA', 'Ingresa tu DNI nuevamente para continuar.');
    res.status(201).json(await store.register(verified.electionId, verified.hash, verified.names, profesorId, verified.dni, verified.studentKey));
  });

  return router;
}
