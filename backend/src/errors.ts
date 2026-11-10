import type { ErrorRequestHandler } from 'express';

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export const duplicateVote = () => new HttpError(409, 'YA_VOTO', 'Este DNI ya registró su voto. No está permitido votar dos veces.');

export const handleError: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof HttpError) {
    res.status(error.status).json({code: error.code, message: error.message});
  } else if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    res.status(error.type === 'entity.too.large' ? 413 : 400)
      .json({code: 'SOLICITUD_INVALIDA', message: 'La solicitud no es válida.'});
  } else {
    console.error('Error interno al procesar una solicitud.');
    res.status(500).json({code: 'ERROR_INTERNO', message: 'Ocurrió un error. Intenta nuevamente.'});
  }
};
