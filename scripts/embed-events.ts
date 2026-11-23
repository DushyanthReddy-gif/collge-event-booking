/** Generates and stores a pgvector embedding for every event.  npm run db:embed */
import 'dotenv/config';
import { embedAllEvents } from '../src/lib/embeddings/events';
import { embeddingProvider } from '../src/lib/embeddings';
import { closePool } from '../src/lib/db/pool';

async function main() {
  console.log(`Embedding provider: ${embeddingProvider()} (first run with "transformers" downloads the model, ~25 MB)`);
  const n = await embedAllEvents((done, total) => process.stdout.write(`\r  embedded ${done}/${total}`));
  console.log(`\nStored ${n} embeddings (384 dimensions).`);
}

main()
  .catch((e) => {
    console.error('\nembedding failed:', e.message);
    console.error('No internet for the model download? Set EMBEDDING_PROVIDER=hash in .env for an offline fallback.');
    process.exitCode = 1;
  })
  .finally(closePool);
