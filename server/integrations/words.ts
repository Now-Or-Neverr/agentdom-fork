// Free Dictionary API (dictionaryapi.dev), Wiktionary as its backup, and Datamuse.
import { clip, fetchJson, qs, stripHtml, type CallContext } from './http';

export interface Definition {
  word: string;
  found: boolean;
  phonetic: string | null;
  audio: string | null;
  meanings: { partOfSpeech: string; definitions: { text: string; example: string | null }[]; synonyms: string[] }[];
  sourceUrl: string;
  fetchedAt: string;
}

/** English definitions. Falls back to Wiktionary when dictionaryapi.dev is down or has no entry. */
export async function define(word: string, ctx: CallContext): Promise<Definition> {
  const w = word.trim().toLowerCase();
  const url = 'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(w);
  let r: Awaited<ReturnType<typeof fetchJson<any>>>;
  try {
    r = await fetchJson<any>(url, { provider: 'dictionary', ctx, ttlMs: 24 * 60 * 60_000, okStatuses: [404] });
  } catch (e) {
    const wk = await wiktionary(w, ctx).catch(() => null);
    if (wk) return wk;
    throw e;
  }
  if (!Array.isArray(r.data) || !r.data.length) {
    const wk = await wiktionary(w, ctx).catch(() => null);
    if (wk) return wk;
  }
  const entries = Array.isArray(r.data) ? (r.data as any[]) : [];
  const e = entries[0];
  const meanings = entries
    .flatMap((x) => x.meanings ?? [])
    .slice(0, 5)
    .map((m: any) => ({
      partOfSpeech: m.partOfSpeech ?? '',
      definitions: ((m.definitions ?? []) as any[]).slice(0, 3).map((d) => ({ text: clip(d.definition ?? '', 300), example: d.example ? clip(d.example, 200) : null })),
      synonyms: (m.synonyms ?? []).slice(0, 8),
    }));
  const phon = e?.phonetic ?? (e?.phonetics ?? []).find((p: any) => p.text)?.text ?? null;
  const audio = (e?.phonetics ?? []).find((p: any) => p.audio)?.audio ?? null;
  return {
    word: w,
    found: !!e,
    phonetic: phon,
    audio: audio || null,
    meanings,
    sourceUrl: e?.sourceUrls?.[0] ?? `https://en.wiktionary.org/wiki/${encodeURIComponent(w)}`,
    fetchedAt: r.fetchedAt,
  };
}

/** Wiktionary's REST definitions (English section only). null when it has no English entry. */
async function wiktionary(w: string, ctx: CallContext): Promise<Definition | null> {
  const r = await fetchJson<any>('https://en.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(w), { provider: 'wiktionary', ctx, ttlMs: 24 * 60 * 60_000, okStatuses: [404] });
  const clean = (h: string) => stripHtml(String(h ?? '').replace(/<style[\s\S]*?<\/style>/gi, ''));
  const meanings = ((r.data?.en ?? []) as any[])
    .map((m) => ({
      partOfSpeech: String(m.partOfSpeech ?? '').toLowerCase(),
      definitions: ((m.definitions ?? []) as any[])
        .map((d) => ({ text: clip(clean(d.definition), 300), example: d.examples?.[0] ? clip(clean(d.examples[0]), 200) : null }))
        .filter((d) => d.text)
        .slice(0, 3),
      synonyms: [] as string[],
    }))
    .filter((m) => m.definitions.length)
    .slice(0, 5);
  if (!meanings.length) return null;
  return { word: w, found: true, phonetic: null, audio: null, meanings, sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(w)}`, fetchedAt: r.fetchedAt };
}

export type WordRelation = 'synonyms' | 'rhymes' | 'related' | 'antonyms';
const REL: Record<WordRelation, string> = { synonyms: 'rel_syn', rhymes: 'rel_rhy', related: 'ml', antonyms: 'rel_ant' };

export interface WordList {
  word: string;
  relation: WordRelation;
  words: string[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Datamuse word lists: synonyms, rhymes, related ("means like") or antonyms. */
export async function relatedWords(word: string, relation: WordRelation, ctx: CallContext, max = 15): Promise<WordList> {
  const url = 'https://api.datamuse.com/words' + qs({ [REL[relation]]: word.trim().toLowerCase(), max: Math.min(max, 50) });
  const r = await fetchJson<any[]>(url, { provider: 'datamuse', ctx, ttlMs: 24 * 60 * 60_000 });
  return { word: word.trim().toLowerCase(), relation, words: (r.data ?? []).map((x) => x.word).filter(Boolean), sourceUrl: url, fetchedAt: r.fetchedAt };
}
