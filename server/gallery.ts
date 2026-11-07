// Public Gallery: the realm's approved work that requesters allowed to be shown (is_public = 1).
// One card per real artifact of the decree's latest revision (image, video, web page); decrees
// without artifacts appear as a text excerpt of the approved result. Nothing is invented.
import { db, type Row } from './db';
import { allAgents, lite } from './core';
import { isProvince, type ProvinceId } from '../shared/realm';
import type { GalleryItem, GalleryKind, GalleryPage } from '../shared/court';

const PER_PAGE = 12;
const KINDS: GalleryKind[] = ['image', 'video', 'html', 'text'];

const parse = (s: unknown): Record<string, unknown> => {
  try {
    const v = JSON.parse(String(s ?? '{}'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

/** Plain-text excerpt of a Markdown result: headings, links and emphasis flattened. */
export function excerpt(md: string, max = 420): string {
  const t = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + ' …' : t;
}

function source(kind: string, meta: Record<string, unknown>): { source: string; sourceUrl: string | null } {
  if (kind === 'image') return { source: String(meta.provider ?? 'Image generator'), sourceUrl: typeof meta.sourceUrl === 'string' ? meta.sourceUrl : null };
  if (kind === 'video') return { source: `Rendered with ${String(meta.renderer ?? 'ffmpeg (local)')}`, sourceUrl: null };
  return { source: 'Published by the agent as a single-file page', sourceUrl: null };
}

export function gallery(q: { kind?: unknown; province?: unknown; sort?: unknown; page?: unknown }): GalleryPage {
  const kind = KINDS.includes(q.kind as GalleryKind) ? (q.kind as GalleryKind) : null;
  const province = isProvince(q.province) ? (q.province as ProvinceId) : null;
  const sort = q.sort === 'newest' ? 'newest' : 'rating';
  const page = Math.max(1, Math.floor(Number(q.page)) || 1);

  const decrees = db
    .prepare(
      `SELECT id, agent_id, province, title, result, rating, review, revision, COALESCE(finished_at, delivered_at) AS finished_at FROM decrees
       WHERE status = 'approved' AND is_public = 1 ${province ? 'AND province = ?' : ''}
       ORDER BY finished_at DESC LIMIT 600`,
    )
    .all(...(province ? [province] : [])) as Row[];

  const agents = allAgents();
  const artStmt = db.prepare('SELECT id, revision, kind, url, content, title, meta FROM decree_artifacts WHERE decree_id = ? ORDER BY at, rowid');
  const items: GalleryItem[] = [];
  for (const d of decrees) {
    const a = agents.get(d.agent_id);
    const base = {
      decreeId: d.id,
      title: d.title,
      rating: d.rating ?? null,
      review: d.review ?? null,
      finishedAt: d.finished_at ?? null,
      province: d.province,
      agent: a ? lite(a) : null,
    };
    // Only showable files (sites, drafts and audits are not gallery pieces).
    const all = (artStmt.all(d.id) as Row[]).filter((x) => x.kind === 'image' || x.kind === 'video' || x.kind === 'html');
    const latest = all.filter((x) => x.revision === d.revision);
    const arts = latest.length ? latest : all;
    // Only the last published page of a run is the delivered one.
    const lastHtml = [...arts].reverse().find((x) => x.kind === 'html');
    for (const x of arts) {
      if (x.kind === 'html' && x !== lastHtml) continue;
      if (kind && x.kind !== kind) continue;
      const m = parse(x.meta);
      items.push({
        ...base,
        id: `${d.id}:${x.id}`,
        kind: x.kind,
        artifactTitle: x.title,
        url: x.url ?? null,
        html: x.kind === 'html' ? (x.content ?? '') : null,
        excerpt: null,
        ...source(x.kind, m),
      });
    }
    if (!arts.length && (!kind || kind === 'text') && String(d.result ?? '').trim()) {
      items.push({ ...base, id: d.id, kind: 'text', artifactTitle: null, url: null, html: null, excerpt: excerpt(d.result), source: `Written by ${a?.name ?? 'the agent'}`, sourceUrl: null });
    }
  }

  if (sort === 'rating') items.sort((x, y) => (y.rating ?? 0) - (x.rating ?? 0) || String(y.finishedAt).localeCompare(String(x.finishedAt)));
  else items.sort((x, y) => String(y.finishedAt).localeCompare(String(x.finishedAt)));

  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  return { items: items.slice((page - 1) * PER_PAGE, page * PER_PAGE), page, pages, total };
}
