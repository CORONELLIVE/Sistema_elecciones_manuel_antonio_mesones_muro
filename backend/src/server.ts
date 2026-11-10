import {createApp} from './app.js';
import {loadConfig} from './config.js';

try {
  const config = loadConfig();
  const app = await createApp(config);
  const server = app.listen(config.port, config.host, () => {
    console.log('Servidor de votaciones disponible en http://' + config.host + ':' + config.port);
  });
  server.on('error', error => {
    console.error('No se pudo iniciar el servidor:', (error as NodeJS.ErrnoException).code);
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => server.close());
  }
} catch (error) {
  const name = error instanceof Error ? error.name : '';
  console.error(name === 'Error' && error instanceof Error
    ? error.message
    : 'No se pudo iniciar. Revisa la configuración de profesores y la integridad del archivo de votos.');
  process.exitCode = 1;
}
