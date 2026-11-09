// Royal Charter: every agent's real capabilities, derived from the live tool list of its guild
// (server/agentTools.ts, imported read-only) and the provider registry. Owners may narrow the
// tools their own agent may use (table agent_charters); allowedTools() is what the worker reads.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, now, type Row } from './db';
import { agentById } from './core';
import { toolLabel, toolNamesFor, toolsFor } from './agentTools';
import { PROVIDER, PROVIDERS, enabled } from './integrations/registry';
import { PROVINCE, type ProvinceId } from '../shared/realm';
import type { Charter, CharterTool, CharterWork } from '../shared/court';

db.exec(`
CREATE TABLE IF NOT EXISTS agent_charters (
  agent_id TEXT PRIMARY KEY,
  tools TEXT NOT NULL,        -- JSON array of allowed tool names
  updated_at TEXT NOT NULL
);
`);

/** The honesty rules every agent works under (mirrors the "Rules of work" in server/worker.ts). */
export const CHARTER_RULES = [
  'Uses only the tools listed in this charter. Every tool call is shown to the requester in a work log.',
  'Never claims to have done anything a tool did not actually do: no browsing, code runs, files, images or videos beyond real tool results.',
  'Never invents urls, numbers, quotes or sources. Cites only the urls the tools returned.',
  'If a tool fails or returns nothing useful, says so plainly and marks the missing data.',
  'Images, videos and web pages it produces are real files, shown in the decree’s Artifacts section.',
];

// ---------------- tool → provider index (read from source, so new tools are picked up) ----------------
const HERE = path.dirname(fileURLToPath(import.meta.url));

interface ToolMeta {
  providers: string[];
  limits: string[];
  local: string | null;
}
let INDEX: Map<string, ToolMeta> | null = null;
let IMAGE_LIMITS: Partial<Record<ProvinceId, number>> = {};

const read = (f: string) => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return '';
  }
};

/** Exported function name → provider ids, from `provider: '<id>'` inside each integration client. */
function functionProviders(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const dir = path.join(HERE, 'integrations');
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
  } catch {
    return out;
  }
  for (const f of files) {
    const src = read(path.join(dir, f));
    const ids = (s: string) => [...new Set([...s.matchAll(/provider:\s*['"]([a-z0-9_-]+)['"]/gi)].map((m) => m[1]).filter((id) => PROVIDER[id]))];
    const moduleIds = ids(src);
    const fileId = f.replace(/\.ts$/, '');
    const parts = src.split(/(?=\bexport\s+(?:async\s+)?function\s+)/);
    for (const part of parts) {
      const m = /^export\s+(?:async\s+)?function\s+(\w+)/.exec(part);
      if (!m) continue;
      let found = ids(part);
      if (!found.length && moduleIds.length === 1) found = moduleIds;
      if (!found.length && PROVIDER[fileId]) found = [fileId];
      out.set(m[1], found);
    }
  }
  return out;
}

function matchSourceName(s: string): string | null {
  const low = s.toLowerCase();
  const hit = PROVIDERS.find((p) => low.startsWith(p.name.toLowerCase()) || low.startsWith(p.name.toLowerCase().split(/[ (]/)[0]) || low.includes(p.id));
  return hit?.id ?? null;
}

function buildIndex(): Map<string, ToolMeta> {
  const idx = new Map<string, ToolMeta>();
  const src = read(path.join(HERE, 'agentTools.ts'));
  const fnProv = functionProviders();

  const lim = /IMAGE_LIMIT[^=]*=\s*\{([^}]*)\}/.exec(src);
  IMAGE_LIMITS = {};
  if (lim) for (const m of lim[1].matchAll(/(\w+)\s*:\s*(\d+)/g)) IMAGE_LIMITS[m[1] as ProvinceId] = Number(m[2]);

  // Split into tool blocks at each `name: '<tool>'` (tool definitions in the TOOLS array).
  const marks = [...src.matchAll(/\bname:\s*'([a-z0-9_]+)'\s*,\s*\n\s*label:/g)];
  marks.forEach((m, i) => {
    const block = src.slice(m.index!, i + 1 < marks.length ? marks[i + 1].index! : undefined);
    const provs = new Set<string>();
    for (const x of block.matchAll(/\bname\(\s*'([a-z0-9_-]+)'\s*\)/g)) if (PROVIDER[x[1]]) provs.add(x[1]);
    for (const x of block.matchAll(/provider:\s*'([a-z0-9_-]+)'/g)) if (PROVIDER[x[1]]) provs.add(x[1]);
    for (const x of block.matchAll(/\bI\.(\w+)\s*\(/g)) for (const id of fnProv.get(x[1]) ?? []) provs.add(id);
    if (!provs.size) for (const x of block.matchAll(/sourceName:\s*'([^']+)'/g)) {
      const id = matchSourceName(x[1]);
      if (id) provs.add(id);
    }
    if (!provs.size) {
      const byName = PROVIDERS.find((p) => m[1].split('_').includes(p.id));
      if (byName) provs.add(byName.id);
    }
    const limits: string[] = [];
    for (const x of block.matchAll(/c\.usage\.(\w+)\s*>=\s*(\d+)/g)) limits.push(x[2] === '1' ? `One ${x[1].replace(/s$/, '')} per decree run` : `Up to ${x[2]} ${x[1]} per decree run`);
    for (const x of block.matchAll(/\bcap\(\s*c\s*,\s*'(\w+)'\s*,\s*(\d+)\s*,\s*'([^']+)'/g)) limits.push(x[2] === '1' ? `One ${x[3].toLowerCase()} call per decree run` : `Up to ${x[2]} ${x[3].toLowerCase()} calls per decree run`);
    for (const x of block.matchAll(/num\(\s*i\s*,\s*'limit'\s*,\s*\d+\s*,\s*(\d+)/g)) limits.push(`Up to ${x[1]} results per call`);
    const local = /makeSlideshow/.test(block) ? 'Agentdom (local ffmpeg render)' : /addArtifact\([^)]*kind:\s*'html'/.test(block) ? 'Agentdom (artifact store)' : null;
    idx.set(m[1], { providers: [...provs], limits, local });
  });
  return idx;
}

function meta(tool: string): ToolMeta {
  if (!INDEX) INDEX = buildIndex();
  return INDEX.get(tool) ?? { providers: PROVIDERS.filter((p) => tool.split('_').includes(p.id)).map((p) => p.id), limits: [], local: null };
}

function throttleLine(id: string): string | null {
  const t = PROVIDER[id]?.throttle;
  if (!t) return null;
  const s = t.minIntervalMs / 1000;
  if (s < 1) return null;
  return `${PROVIDER[id].name}: at most one call every ${s % 1 ? s.toFixed(1) : s} s`;
}

// ---------------- owner selection ----------------
/** Tools the agent may use, or null when every guild tool is allowed (no charter saved). */
export function allowedTools(agentId: string): string[] | null {
  const r = db.prepare('SELECT tools FROM agent_charters WHERE agent_id = ?').get(agentId) as Row | undefined;
  if (!r) return null;
  try {
    const v = JSON.parse(r.tools);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

/** Save the owner's selection. Unknown names are dropped; an empty or full selection clears it (= all tools). */
export function setAllowedTools(agentId: string, province: ProvinceId, tools: unknown): string[] | null {
  const valid = toolNamesFor(province);
  const pick = Array.isArray(tools) ? [...new Set(tools.filter((t): t is string => typeof t === 'string' && valid.includes(t)))] : [];
  if (!pick.length || pick.length === valid.length) {
    db.prepare('DELETE FROM agent_charters WHERE agent_id = ?').run(agentId);
    return null;
  }
  db.prepare('INSERT INTO agent_charters (agent_id, tools, updated_at) VALUES (?,?,?) ON CONFLICT(agent_id) DO UPDATE SET tools = excluded.tools, updated_at = excluded.updated_at').run(
    agentId,
    JSON.stringify(pick),
    now(),
  );
  return pick;
}

// ---------------- charter ----------------
export function guildTools(province: ProvinceId, allowed: string[] | null = null): CharterTool[] {
  return toolsFor(province).map((t) => {
    const m = meta(t.name);
    const primary = m.providers[0] ?? null;
    const limits = [...m.limits];
    if (t.name === 'generate_image' && IMAGE_LIMITS[province]) limits.unshift(`Up to ${IMAGE_LIMITS[province]} images per decree in this guild`);
    for (const id of m.providers) {
      const l = throttleLine(id);
      if (l) limits.push(l);
    }
    return {
      name: t.name,
      label: toolLabel(t.name),
      description: t.description ?? '',
      provider: primary,
      providerName: primary ? PROVIDER[primary].name : (m.local ?? 'Agentdom (local)'),
      providers: m.providers,
      enabled: m.providers.every((id) => enabled(id)),
      docsUrl: primary ? PROVIDER[primary].docsUrl : null,
      limits: [...new Set(limits)],
      allowed: !allowed || allowed.includes(t.name),
    };
  });
}

function examples(agentId: string): CharterWork[] {
  const rows = db
    .prepare(
      `SELECT d.id, d.title, d.rating, COALESCE(d.finished_at, d.delivered_at) AS finished_at FROM decrees d
       WHERE d.agent_id = ? AND d.status = 'approved' AND d.is_public = 1
         AND EXISTS (SELECT 1 FROM decree_artifacts x WHERE x.decree_id = d.id)
       ORDER BY COALESCE(d.rating, 0) DESC, d.finished_at DESC LIMIT 3`,
    )
    .all(agentId) as Row[];
  return rows.map((r) => ({
    decreeId: r.id,
    title: r.title,
    rating: r.rating ?? null,
    finishedAt: r.finished_at ?? null,
    artifacts: (db.prepare('SELECT kind, title, url FROM decree_artifacts WHERE decree_id = ? ORDER BY at, rowid LIMIT 6').all(r.id) as Row[]).map((a) => ({
      kind: a.kind,
      title: a.title,
      url: a.url ?? null,
    })),
  }));
}

export function charterFor(agentId: string): Charter | null {
  const a = agentById(agentId);
  if (!a) return null;
  const p = PROVINCE[a.province];
  const allowed = allowedTools(a.id);
  return {
    agentId: a.id,
    province: p.id,
    guildName: p.name,
    craft: p.craft,
    tools: guildTools(p.id, allowed),
    allowedTools: allowed,
    rules: CHARTER_RULES,
    examples: examples(a.id),
  };
}
