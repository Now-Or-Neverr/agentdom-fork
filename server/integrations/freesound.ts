// Freesound (APIv2, token auth). Search music beds and sound effects, preferring CC0 and CC-BY
// (no NonCommercial / Sampling+), and download the HQ mp3 preview into data/uploads.
// Every sound carries author, license and page URL for attribution.
import { fetchBuffer, fetchJson, qs, UpstreamError, type CallContext } from './http';
import { providerKey } from './registry';
import { saveUpload } from './media-common';

export type SoundKind = 'music' | 'sfx' | 'any';
export interface Sound {
  id: number;
  name: string;
  author: string;
  authorUrl: string;
  pageUrl: string;
  license: string; // short name, e.g. 'CC0 1.0', 'CC BY 4.0'
  licenseUrl: string;
  needsCredit: boolean; // false only for CC0
  durationSec: number;
  tags: string[];
  previewUrl: string; // HQ mp3 preview on freesound.org (search results only)
}
export interface SoundSearch {
  query: string;
  kind: SoundKind;
  total: number;
  results: Sound[];
  sourceUrl: string;
  fetchedAt: string;
}
export interface SoundDownload extends Sound {
  url: string; // '/uploads/…mp3'
  file: string;
  bytes: number;
  type: string;
  fetchedAt: string;
}

interface Raw {
  id: number;
  name: string;
  username: string;
  license: string;
  url: string;
  duration: number;
  tags: string[];
  previews: Record<string, string>;
}
const FIELDS = 'id,name,username,license,url,duration,tags,previews';

function auth() {
  const k = providerKey('freesound');
  if (!k) throw new UpstreamError('freesound', 0, 'Freesound is not configured on this server.');
  return { authorization: `Token ${k}` };
}

function licenseName(u: string): { name: string; credit: boolean } {
  const s = u.toLowerCase();
  if (s.includes('publicdomain/zero')) return { name: 'CC0 1.0', credit: false };
  const v = /\/(\d\.\d)\/?$/.exec(s)?.[1] ?? '';
  if (s.includes('/by-nc')) return { name: `CC BY-NC ${v}`.trim(), credit: true };
  if (s.includes('/by/')) return { name: `CC BY ${v}`.trim(), credit: true };
  if (s.includes('sampling')) return { name: 'Sampling+', credit: true };
  return { name: u, credit: true };
}
function toSound(r: Raw): Sound {
  const l = licenseName(r.license ?? '');
  return {
    id: r.id,
    name: r.name,
    author: r.username,
    authorUrl: `https://freesound.org/people/${encodeURIComponent(r.username)}/`,
    pageUrl: r.url,
    license: l.name,
    licenseUrl: r.license,
    needsCredit: l.credit,
    durationSec: Math.round((r.duration ?? 0) * 10) / 10,
    tags: (r.tags ?? []).slice(0, 8),
    previewUrl: r.previews?.['preview-hq-mp3'] ?? r.previews?.['preview-lq-mp3'] ?? '',
  };
}

/** Search CC0 / CC-BY sounds. kind 'music' = 20 s – 10 min, 'sfx' = up to 20 s. */
export async function freesoundSearch(q: string, ctx: CallContext, opts: { kind?: SoundKind; perPage?: number } = {}): Promise<SoundSearch> {
  const query = q.trim().replace(/\s+/g, ' ').slice(0, 100);
  if (!query) throw new Error('Search words are empty.');
  const kind = opts.kind ?? 'any';
  const filters = ['license:("Creative Commons 0" OR "Attribution")'];
  if (kind === 'music') filters.push('duration:[20 TO 600]');
  if (kind === 'sfx') filters.push('duration:[0 TO 20]');
  const r = await fetchJson<{ count: number; results: Raw[] }>(
    'https://freesound.org/apiv2/search/text/' + qs({ query, filter: filters.join(' '), fields: FIELDS, page_size: Math.min(20, Math.max(3, opts.perPage ?? 10)), sort: 'score' }),
    { provider: 'freesound', ctx, ttlMs: 6 * 3600_000, headers: auth() },
  );
  return {
    query,
    kind,
    total: r.data.count ?? 0,
    results: (r.data.results ?? []).map(toSound).filter((s) => s.previewUrl),
    sourceUrl: `https://freesound.org/search/?q=${encodeURIComponent(query)}`,
    fetchedAt: r.fetchedAt,
  };
}

/** Download the HQ mp3 preview of one sound (must be CC0 or CC-BY). */
export async function freesoundDownload(id: number, ctx: CallContext): Promise<SoundDownload> {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid Freesound id.');
  const r = await fetchJson<Raw>(`https://freesound.org/apiv2/sounds/${id}/` + qs({ fields: FIELDS }), { provider: 'freesound', ctx, ttlMs: 3600_000, headers: auth() });
  const s = toSound(r.data);
  if (!/^CC0|^CC BY \d/.test(s.license)) throw new Error(`That sound's license (${s.license}) is not CC0 or CC BY, so the realm will not use it.`);
  if (!s.previewUrl) throw new UpstreamError('freesound', 200, 'Freesound has no preview for that sound.');
  const b = await fetchBuffer(s.previewUrl, { provider: 'freesound', ctx, timeoutMs: 60_000, accept: 'audio/*' });
  if (b.data.buf.length > 25 * 1024 * 1024) throw new Error('The sound file is too large.');
  const saved = saveUpload(b.data.buf, 'snd', ['mp3', 'ogg'], 'Freesound preview');
  return { ...s, url: saved.url, file: saved.file, bytes: saved.bytes, type: saved.ext, fetchedAt: b.fetchedAt };
}
