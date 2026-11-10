// Scriptorium, no-key sources: Gutendex (Project Gutenberg catalogue), PoetryDB and the
// MyMemory translation memory (anonymous free tier: no email parameter is ever sent).
import { clip, fetchJson, qs, type CallContext } from './http';

// ---------------- Gutendex ----------------
export interface FreeBook {
  id: number;
  title: string;
  authors: string[]; // "Austen, Jane (1775-1817)"
  languages: string[];
  subjects: string[];
  downloads: number;
  summary: string | null;
  readUrl: string | null; // HTML or plain-text edition on gutenberg.org
  cover: string | null;
  url: string; // gutenberg.org ebook page
}
export interface FreeBooks {
  query: string | null;
  count: number;
  books: FreeBook[];
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}

/** Public-domain books from Project Gutenberg: the most downloaded, or a title/author search. */
export async function gutenbergBooks(ctx: CallContext, query?: string, limit = 8): Promise<FreeBooks> {
  const q = query?.trim() || undefined;
  if (q && q.length > 100) throw new Error('search is too long (max 100 characters).');
  // Searches on Gutendex can take 30-50 s; popular lists answer fast. Both are cached for a day.
  const r = await fetchJson<any>('https://gutendex.com/books/' + qs(q ? { search: q } : { sort: 'popular' }), { provider: 'gutendex', ctx, ttlMs: 24 * 3600_000, timeoutMs: q ? 50_000 : 20_000, retries: 0 });
  const books: FreeBook[] = ((r.data?.results ?? []) as any[]).slice(0, Math.min(16, limit)).map((b) => {
    const f = (b.formats ?? {}) as Record<string, string>;
    const read = Object.entries(f).find(([k]) => k.startsWith('text/html'))?.[1] ?? Object.entries(f).find(([k]) => k.startsWith('text/plain'))?.[1] ?? null;
    return {
      id: Number(b.id),
      title: clip(b.title ?? '', 200),
      authors: ((b.authors ?? []) as any[]).map((a) => `${a.name}${a.birth_year || a.death_year ? ` (${a.birth_year ?? '?'}-${a.death_year ?? ''})` : ''}`),
      languages: (b.languages ?? []) as string[],
      subjects: ((b.subjects ?? []) as string[]).slice(0, 4),
      downloads: Number(b.download_count ?? 0),
      summary: Array.isArray(b.summaries) && b.summaries[0] ? clip(String(b.summaries[0]), 360) : null,
      readUrl: read,
      cover: f['image/jpeg'] ?? null,
      url: `https://www.gutenberg.org/ebooks/${b.id}`,
    };
  });
  return {
    query: q ?? null,
    count: Number(r.data?.count ?? books.length),
    books,
    note: 'Project Gutenberg books are public domain in the USA; check the laws of your country before copying them.',
    sourceUrl: q ? `https://www.gutenberg.org/ebooks/search/?query=${encodeURIComponent(q)}` : 'https://www.gutenberg.org/browse/scores/top',
    fetchedAt: r.fetchedAt,
  };
}

// ---------------- PoetryDB ----------------
export interface Poem {
  title: string;
  author: string;
  lines: string[];
  lineCount: number;
  url: string; // PoetryDB API record for this poem
}
export interface Poems {
  kind: 'random' | 'search';
  author: string | null;
  title: string | null;
  poems: Poem[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Public-domain poems from PoetryDB, by author and/or title words; random when both are empty. */
export async function poems(ctx: CallContext, opts: { author?: string; title?: string; limit?: number } = {}): Promise<Poems> {
  const a = opts.author?.trim() || '';
  const t = opts.title?.trim() || '';
  if (a.length > 80 || t.length > 80) throw new Error('author and title are limited to 80 characters.');
  if (/[;/\\:]/.test(a + t)) throw new Error('author and title may not contain ; / \\ or :');
  const limit = Math.min(10, Math.max(1, opts.limit ?? 5));
  const path = a && t ? `/author,title/${encodeURIComponent(a)};${encodeURIComponent(t)}` : a ? `/author/${encodeURIComponent(a)}` : t ? `/title/${encodeURIComponent(t)}` : `/random/${Math.min(3, limit)}`;
  const r = await fetchJson<any>('https://poetrydb.org' + path, { provider: 'poetrydb', ctx, ttlMs: a || t ? 24 * 3600_000 : 0, timeoutMs: 15_000 });
  // PoetryDB answers HTTP 200 with {status: 404} when nothing matches.
  const list = Array.isArray(r.data) ? (r.data as any[]) : [];
  return {
    kind: a || t ? 'search' : 'random',
    author: a || null,
    title: t || null,
    poems: list.slice(0, limit).map((p) => {
      const lines = ((p.lines ?? []) as string[]).map(String);
      return {
        title: String(p.title ?? ''),
        author: String(p.author ?? ''),
        lines: lines.slice(0, 60),
        lineCount: Number(p.linecount ?? lines.length),
        url: `https://poetrydb.org/title/${encodeURIComponent(String(p.title ?? ''))}:abs`,
      };
    }),
    sourceUrl: 'https://poetrydb.org/',
    fetchedAt: r.fetchedAt,
  };
}

// ---------------- MyMemory ----------------
// The anonymous tier allows about 5,000 characters a day for this server. We keep a smaller
// daily budget so the realm never runs into the wall; the counter resets at midnight UTC.
export const MEMORY_MAX_CHARS = 450;
const DAILY_BUDGET = Number(process.env.MYMEMORY_DAILY_CHARS) || 4000;
let budget = { day: '', used: 0 };
export function memoryBudget() {
  const day = new Date().toISOString().slice(0, 10);
  if (budget.day !== day) budget = { day, used: 0 };
  return { used: budget.used, limit: DAILY_BUDGET, left: Math.max(0, DAILY_BUDGET - budget.used) };
}
export interface MemoryMatch {
  translation: string;
  quality: number | null; // 0-100 as MyMemory reports it
  match: number; // 0-1 similarity of the stored segment to the text sent
  source: string; // "Public Web", "MT!" (machine translation), a contributor…
}
export interface MemoryTranslation {
  text: string;
  from: string;
  to: string;
  translated: string;
  match: number | null;
  alternatives: MemoryMatch[];
  note: string;
  budgetLeft: number;
  sourceUrl: string;
  fetchedAt: string;
}
const LANG = /^[a-z]{2,3}(-[A-Z]{2})?$/;

/** Translate a short text with MyMemory (human translation memory, falling back to machine translation). */
export async function memoryTranslate(text: string, from: string, to: string, ctx: CallContext): Promise<MemoryTranslation> {
  const t = text.trim();
  if (!t) throw new Error('text is required.');
  if (t.length > MEMORY_MAX_CHARS) throw new Error(`text is too long for MyMemory (max ${MEMORY_MAX_CHARS} characters).`);
  if (!LANG.test(from) || !LANG.test(to)) throw new Error('language codes must look like en, id, fr or pt-BR.');
  if (from.toLowerCase() === to.toLowerCase()) throw new Error('Pick two different languages.');
  const b = memoryBudget();
  if (t.length > b.left) throw new Error(`Today's free MyMemory allowance for the realm is used up (${b.limit.toLocaleString('en')} characters a day). Try again after midnight UTC.`);
  const r = await fetchJson<any>('https://api.mymemory.translated.net/get' + qs({ q: t, langpair: `${from}|${to}` }), { provider: 'mymemory', ctx, ttlMs: 24 * 3600_000, timeoutMs: 15_000 });
  if (!r.cached) budget.used += t.length;
  const status = Number(r.data?.responseStatus ?? 200);
  if (r.data?.quotaFinished) throw new Error('MyMemory says the free daily quota for this server is finished. Try again tomorrow.');
  if (status !== 200) throw new Error(`MyMemory: ${clip(String(r.data?.responseDetails || r.data?.responseData?.translatedText || `status ${status}`), 200).toLowerCase()}`);
  const matches = ((r.data?.matches ?? []) as any[])
    .filter((m) => m?.translation)
    .slice(0, 4)
    .map((m) => ({ translation: clip(String(m.translation), 600), quality: m.quality != null && m.quality !== '' ? Number(m.quality) : null, match: Number(m.match ?? 0), source: String(m['created-by'] || m['last-updated-by'] || 'unknown') }));
  return {
    text: t,
    from,
    to,
    translated: clip(String(r.data?.responseData?.translatedText ?? ''), 900),
    match: r.data?.responseData?.match != null ? Number(r.data.responseData.match) : null,
    alternatives: matches,
    note: 'MyMemory mixes crowd-sourced translation memory with machine translation. Stored segments can be wrong; check the alternatives and their source.',
    budgetLeft: memoryBudget().left,
    sourceUrl: 'https://mymemory.translated.net/',
    fetchedAt: r.fetchedAt,
  };
}
