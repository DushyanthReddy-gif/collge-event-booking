/** Creates the Neo4j constraints/indexes and copies the PostgreSQL data into the graph.  npm run neo4j:setup */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getDriver, closeDriver } from '../src/lib/neo4j/driver';
import { fullSync } from '../src/lib/neo4j/sync';
import { closePool } from '../src/lib/db/pool';

async function main() {
  const cypher = readFileSync(path.join(process.cwd(), 'db/nosql/01_schema.cypher'), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  const statements = cypher.split(';').map((s) => s.trim()).filter(Boolean);

  const session = getDriver().session();
  try {
    for (const s of statements) await session.run(s);
    console.log(`Applied ${statements.length} schema statements from db/nosql/01_schema.cypher`);
  } finally {
    await session.close();
  }
  const { nodes, relationships } = await fullSync();
  console.log(`Neo4j graph rebuilt from PostgreSQL: ${nodes} nodes, ${relationships} relationships.`);
}

main()
  .catch((e) => {
    console.error('neo4j setup failed:', e.message);
    console.error('Is Neo4j running?  docker compose up -d   (and check NEO4J_* in .env)');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDriver();
    await closePool();
  });
