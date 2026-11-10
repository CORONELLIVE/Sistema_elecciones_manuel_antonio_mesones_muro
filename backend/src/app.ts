import express from 'express';
import helmet from 'helmet';
import {resolve} from 'node:path';
import type {Config} from './config.js';
import {handleError, HttpError} from './errors.js';
import {adminRoutes} from './routes/admin.js';
import {ballotRoutes, type VoterVerifier} from './routes/ballot.js';
import {makeDniProvider, type DniProvider} from './services/dni.js';
import {loadCandidates} from './services/candidates.js';
import {loadRoster} from './services/roster.js';
import {makeVoteStore} from './services/votes.js';

export async function createApp(
  config: Config,
  verifyStudent: DniProvider = makeDniProvider(config.mode),
  verifyVoter?: VoterVerifier,
) {
  const candidates = await loadCandidates(config.candidatesFile, config.professors);
  const store = makeVoteStore(config.votesFile, config.hmacKey, candidates);
  await store.initialize();
  const roster = config.mode === 'padron' ? await loadRoster(config.rosterFile, config.hmacKey) : undefined;

  const app = express();
  app.disable('x-powered-by');
  if (config.proxyHops) app.set('trust proxy', config.proxyHops);
  app.use(helmet({
    strictTransportSecurity: config.production,
    contentSecurityPolicy: {directives: {'upgrade-insecure-requests': config.production ? [] : null}},
  }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (origin && !config.allowedOrigins.includes(origin)) {
      throw new HttpError(403, 'ORIGEN_INVALIDO', 'La solicitud procede de un origen no permitido.');
    }
    if (req.method === 'POST' && (!origin || req.get('x-eleccion') !== '1' || !req.is('application/json'))) {
      throw new HttpError(403, 'SOLICITUD_BLOQUEADA', 'La solicitud fue bloqueada.');
    }
    next();
  });
  const smallJson = express.json({limit: '4kb'});
  app.use('/api', (req, res, next) => {
    if (req.path === '/admin/candidatos/guardar') return next();
    return smallJson(req, res, next);
  });
  app.use('/api/admin', adminRoutes(config, store, candidates));
  app.use('/api', ballotRoutes(config, store, candidates, verifyStudent, verifyVoter, roster));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'RUTA_INVALIDA', 'La ruta no existe.')));
  app.use('/assets', express.static(resolve(config.staticDir, 'assets'), {index: false, maxAge: '1y', immutable: true}));
  app.get(['/', '/admin'], (_req, res, next) => {
    res.sendFile(resolve(config.staticDir, 'index.html'), error => {
      if (!error) return;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        res.status(404).send('Inicia Vite para desarrollo o compila el frontend para servirlo desde Express.');
      } else next(error);
    });
  });
  app.use(handleError);
  return app;
}
