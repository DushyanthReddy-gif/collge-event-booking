/**
 * Creates the PostgreSQL schema + seed data without needing psql.
 *   npm run db:setup    -> run only if the database is empty
 *   npm run db:reset    -> DROP SCHEMA public CASCADE, then rebuild everything
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const FILES = ['db/schema/001_schema.sql', 'db/schema/002_advanced.sql', 'db/schema/003_vector.sql', 'db/seed/001_seed.sql'];

async function main() {
  const reset = process.argv.includes('--reset');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (reset) {
      console.log('Dropping schema public ...');
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    } else {
      const { rows } = await client.query(`SELECT to_regclass('public.events') AS t`);
      if (rows[0].t) {
        console.log('Database already initialised. Use `npm run db:reset` to rebuild it from scratch.');
        return;
      }
    }
    for (const file of FILES) {
      process.stdout.write(`Running ${file} ... `);
      await client.query(readFileSync(path.join(process.cwd(), file), 'utf8'));
      console.log('done');
    }
    const { rows } = await client.query(
      `SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM events) AS events, (SELECT count(*) FROM bookings) AS bookings`,
    );
    console.log(`PostgreSQL ready: ${rows[0].users} users, ${rows[0].events} events, ${rows[0].bookings} bookings.`);
    console.log('All demo accounts use the password  Password@123');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('db setup failed:', e.message);
  process.exit(1);
});
