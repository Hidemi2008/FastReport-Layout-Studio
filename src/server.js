import 'dotenv/config';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { expirarVencidos } from './services/validity.js';
import { seed } from './seed.js';

const db = openDb();
if (!db.prepare('SELECT 1 FROM empresa LIMIT 1').get()) seed(db);
expirarVencidos(db);
setInterval(() => expirarVencidos(db), 60 * 60 * 1000).unref();

const port = Number(process.env.PORT || 3000);
createApp(db).listen(port, () => console.log(`DAV Studio em http://localhost:${port}`));
