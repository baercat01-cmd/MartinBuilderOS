/**
 * Apply maintenance ticket schema to Supabase Postgres.
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL = "postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres"
 *   node scripts/apply-maintenance-supabase.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, 'maintenance-log-supabase-complete.sql');

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('Set DATABASE_URL from Supabase → Project Settings → Database → Connection string.');
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, 'utf8');
const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log('Applying maintenance-log-supabase-complete.sql …');
  await client.query(sql);
  console.log('Done.');
} catch (err) {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
