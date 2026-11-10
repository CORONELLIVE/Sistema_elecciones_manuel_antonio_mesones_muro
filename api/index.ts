import type {IncomingMessage, ServerResponse} from 'node:http';
import {createApp} from '../backend/src/app.js';
import {loadConfig} from '../backend/src/config.js';

let app: ReturnType<typeof createApp> | undefined;

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  try {
    app ??= createApp(loadConfig());
    const server = await app;
    const url = new URL(request.url || '/', 'http://localhost');
    const path = url.searchParams.get('__election_path');
    if (path !== null) {
      url.searchParams.delete('__election_path');
      request.url = '/api/' + path + url.search;
    }
    server(request, response);
  } catch {
    app = undefined;
    response.statusCode = 503;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({message: 'El sistema electoral no está disponible en este momento.'}));
  }
}
