/**
 * Text -> 384-dimensional vector.
 *
 *  - "transformers" (default): local sentence-embedding model Xenova/all-MiniLM-L6-v2 running in
 *    Node via ONNX. No API key. The ~25 MB model is downloaded once and cached in ./.cache/models.
 *  - "hash": offline fallback (no download). Feature-hashing of words plus a small concept lexicon.
 *    It is only lexical-ish, but lets the whole vector pipeline run offline (tests / CI).
 *
 * Whichever provider is configured must be used for BOTH stored event vectors and query vectors.
 * After switching provider run `npm run db:embed` again.
 */
export const EMBEDDING_DIM = 384;
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

type Extractor = (text: string, opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: Float32Array }>;
const g = globalThis as unknown as { __cebExtractor?: Promise<Extractor> };

export function embeddingProvider(): 'transformers' | 'hash' {
  return process.env.EMBEDDING_PROVIDER === 'hash' ? 'hash' : 'transformers';
}

async function loadExtractor(): Promise<Extractor> {
  if (!g.__cebExtractor) {
    g.__cebExtractor = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      env.cacheDir = `${process.cwd()}/.cache/models`;
      const p = await pipeline('feature-extraction', MODEL_ID);
      return p as unknown as Extractor;
    })();
    g.__cebExtractor.catch(() => {
      g.__cebExtractor = undefined; // allow a retry on the next call (e.g. after network is back)
    });
  }
  return g.__cebExtractor;
}

export async function embedText(text: string): Promise<number[]> {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 2000);
  if (embeddingProvider() === 'hash') return hashEmbedding(clean);
  const extractor = await loadExtractor();
  const output = await extractor(clean, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/** pgvector text format: '[0.1,0.2,...]' - used with a $n::vector cast. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : '0')).join(',')}]`;
}

/** The text that represents an event in vector space. */
export function eventEmbeddingText(e: { title: string; description: string; categoryName?: string }): string {
  return [e.title, e.categoryName, e.description].filter(Boolean).join('. ');
}

// ------------------------------- hash fallback ---------------------------------
const STOP = new Set(
  'a an and are as at be by for from has have in into is it of on or that the this to with will you your we our us how what when where who which about'.split(
    ' ',
  ),
);

// word -> concept token, so that related words land in the same dimensions
const CONCEPTS: Record<string, string> = {};
function concept(name: string, words: string) {
  for (const w of words.split(' ')) CONCEPTS[w] = name;
}
concept('c_robotics', 'robot robots robotics robotic arduino sensors sensor automation embedded drone drones quadcopter microcontroller microcontrollers motor');
concept('c_ai', 'ai artificial intelligence machine learning ml neural network networks deep generative llm llms data science model models classification regression');
concept('c_coding', 'code coding programming program python java contest competition algorithm algorithms hackathon software developer developers');
concept('c_security', 'security cybersecurity hacking hacker hackers ethical password vulnerabilities attack attackers defend network');
concept('c_music', 'music musical band bands concert songs singing sing acoustic rock pop artists performances performance');
concept('c_photo', 'photography photo photos camera composition lighting editing visual');
concept('c_sport', 'sports sport cricket football match tournament athletics trophy trophies team teams players player');
concept('c_business', 'startup startups entrepreneurship entrepreneur founders funding business innovation venture');
concept('c_culture', 'cultural dance drama festival fest theatre poetry comedy culture');

function fnv(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hashEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const add = (token: string, weight: number) => {
    const h = fnv(token);
    vec[h % EMBEDDING_DIM] += (h & 0x80000000 ? -1 : 1) * weight;
  };
  let prev = '';
  for (const w of words) {
    if (STOP.has(w)) continue;
    add(`w:${w}`, 1);
    const c = CONCEPTS[w];
    if (c) add(c, 2);
    if (prev) add(`b:${prev}_${w}`, 0.5);
    prev = w;
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map((x) => x / norm);
}
