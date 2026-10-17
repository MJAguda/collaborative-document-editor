import { fileURLToPath } from 'node:url';
import { openDb } from './db.ts';
import { createApp } from './app.ts';

const db = openDb(process.env.DB_PATH ?? 'data/app.db');
const clientDir = fileURLToPath(new URL('../dist/client', import.meta.url));
const port = Number(process.env.PORT ?? 3000);

createApp(db, clientDir).listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});
