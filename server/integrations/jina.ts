// Jina Reader (r.jina.ai): read one public web page as clean text/markdown.
import { clip, fetchJson, type CallContext } from './http';
import { publicUrl, requireKey } from './keys';

const P = 'jina';
export const READ_MAX_CHARS = 20_000;

export interface PageText {
  url: string;
  title: string;
  description: string | null;
  text: string; // markdown, capped
  chars: number; // full length before the cap
  truncated: boolean;
  sourceUrl: string; // the page itself
  fetchedAt: string;
}

export const capText = (s: string, cap: number) => (s.length > cap ? s.slice(0, cap).trimEnd() + `\n\n[cut at ${cap} characters]` : s);

/** Fetch a public URL through Jina Reader. `maxChars` caps the returned text (default 8,000, max 20,000). */
export async function readUrl(url: string, ctx: CallContext, maxChars = 8000): Promise<PageText> {
  const key = requireKey(P);
  const u = publicUrl(url);
  const cap = Math.min(READ_MAX_CHARS, Math.max(500, Math.round(maxChars)));
  const r = await fetchJson<any>('https://r.jina.ai/' + u, {
    provider: P,
    ctx,
    headers: { authorization: `Bearer ${key}`, 'x-return-format': 'markdown' },
    ttlMs: 6 * 3600_000,
    timeoutMs: 40_000,
    retries: 0,
  });
  const d = r.data?.data ?? {};
  const full = String(d.content ?? '').trim();
  if (!full) throw new Error('Jina Reader returned no readable text for that page.');
  const src = typeof d.url === 'string' && /^https?:\/\//.test(d.url) ? d.url : u;
  return {
    url: src,
    title: clip(d.title || src, 200),
    description: d.description ? clip(d.description, 300) : null,
    text: capText(full, cap),
    chars: full.length,
    truncated: full.length > cap,
    sourceUrl: src,
    fetchedAt: r.fetchedAt,
  };
}
