// LanguageTool public API (no key). Public limits: ~20 requests/min, ~20 KB per text.
// The registry throttle keeps us at most one call every 3.5 s.
import { clip, fetchJson, type CallContext } from './http';

export const GRAMMAR_MAX_BYTES = 18_000;

export interface GrammarIssue {
  message: string;
  offset: number;
  length: number;
  bad: string; // the flagged text
  replacements: string[];
  rule: string;
  category: string;
}
export interface GrammarCheck {
  language: string; // detected / used language
  issues: GrammarIssue[];
  checkedChars: number;
  sourceUrl: string;
  fetchedAt: string;
}

/** Check grammar/spelling. `language` like 'en-US', 'de-DE' or 'auto'. */
export async function checkGrammar(text: string, ctx: CallContext, language = 'en-US'): Promise<GrammarCheck> {
  if (Buffer.byteLength(text, 'utf8') > GRAMMAR_MAX_BYTES) throw new Error(`Text is too long for the public checker (max ${GRAMMAR_MAX_BYTES / 1000} KB).`);
  const body = new URLSearchParams({ text, language });
  const r = await fetchJson<any>('https://api.languagetool.org/v2/check', {
    provider: 'languagetool',
    ctx,
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    ttlMs: 10 * 60_000,
    timeoutMs: 20_000,
  });
  const matches = (r.data?.matches ?? []) as any[];
  return {
    language: r.data?.language?.detectedLanguage?.code ?? r.data?.language?.code ?? language,
    issues: matches.slice(0, 60).map((m) => ({
      message: clip(m.message ?? '', 240),
      offset: Number(m.offset ?? 0),
      length: Number(m.length ?? 0),
      bad: text.substr(Number(m.offset ?? 0), Number(m.length ?? 0)),
      replacements: ((m.replacements ?? []) as any[]).slice(0, 5).map((x) => x.value),
      rule: m.rule?.id ?? '',
      category: m.rule?.category?.name ?? '',
    })),
    checkedChars: text.length,
    sourceUrl: 'https://languagetool.org/http-api/',
    fetchedAt: r.fetchedAt,
  };
}
