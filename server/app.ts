import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { MulterError } from 'multer';
import { join } from 'node:path';
import type { DB } from './db.ts';
import { authRouter, requireUser } from './auth.ts';
import { documentsRouter } from './documents.ts';
import { ImportError, MAX_REQUEST_BYTES } from './content.ts';

// Every error becomes JSON; no stack traces reach the client.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ImportError) {
    res.status(err.status).json({ error: err.message });
  } else if (err instanceof MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'File is larger than 2 MB' : 'Invalid upload' });
  } else if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request is too large' });
  } else if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body is not valid JSON' });
  } else if (err?.type && err.status >= 400 && err.status < 500) {
    res.status(err.status).json({ error: 'Invalid request' }); // other body-parser errors, e.g. unsupported charset
  } else {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export function createApp(db: DB, clientDir?: string): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: MAX_REQUEST_BYTES }));
  app.use('/api', authRouter(db));
  app.use('/api/documents', requireUser(db), documentsRouter(db));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  if (clientDir) {
    app.use(express.static(clientDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(join(clientDir, 'index.html'));
    });
  }
  app.use(errorHandler);
  return app;
}
