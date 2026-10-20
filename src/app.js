import express from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './routes/api.js';

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', apiRouter(db));
  app.use(express.static(resolve(dirname(fileURLToPath(import.meta.url)), '../public')));
  return app;
}
