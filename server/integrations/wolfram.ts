// Wolfram|Alpha LLM API: exact computations, conversions and curated facts as plain text.
// Free = 2,000 calls/month (non-commercial). The AppID is sent as a Bearer header, never in the URL.
import { fetchText, qs, type CallContext } from './http';
import { requireKey } from './keys';
import { capText } from './jina';

const P = 'wolfram';
export const WOLFRAM_MAX_INPUT = 300;

export interface WolframAnswer {
  input: string;
  understood: boolean; // false when Wolfram|Alpha could not interpret the input
  text: string; // capped
  images: string[]; // image links Wolfram includes in the text
  sourceUrl: string; // the same query on wolframalpha.com
  fetchedAt: string;
}

export const wolframPage = (input: string) => `https://www.wolframalpha.com/input?i=${encodeURIComponent(input)}`;

/** Ask Wolfram|Alpha. `maxChars` caps the answer (default 3,000, max 6,000). */
export async function askWolfram(input: string, ctx: CallContext, maxChars = 3000): Promise<WolframAnswer> {
  const key = requireKey(P);
  const q = input.trim();
  if (!q) throw new Error('input is required.');
  if (q.length > WOLFRAM_MAX_INPUT) throw new Error(`input is too long (max ${WOLFRAM_MAX_INPUT} characters).`);
  const cap = Math.min(6000, Math.max(300, Math.round(maxChars)));
  const r = await fetchText('https://www.wolframalpha.com/api/v1/llm-api' + qs({ input: q, maxchars: cap }), {
    provider: P,
    ctx,
    headers: { authorization: `Bearer ${key}` },
    accept: 'text/plain',
    ttlMs: 7 * 86400_000,
    timeoutMs: 30_000,
    okStatuses: [501], // 501 = "input cannot be interpreted": an honest answer, not an outage
  });
  const body = String(r.data ?? '').trim();
  const understood = r.status !== 501;
  return {
    input: q,
    understood,
    text: capText(understood ? body : body || 'Wolfram|Alpha could not interpret that input.', cap),
    images: [...body.matchAll(/https:\/\/public\d*[a-z]*\.wolframalpha\.com\/files\/[A-Za-z0-9_.-]+/g)].map((m) => m[0]).slice(0, 6),
    sourceUrl: wolframPage(q),
    fetchedAt: r.fetchedAt,
  };
}
