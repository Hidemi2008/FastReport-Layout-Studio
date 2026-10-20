import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
export function dbComSeed() { const db = openDb(':memory:'); const orcId = seed(db); return { db, orcId }; }
