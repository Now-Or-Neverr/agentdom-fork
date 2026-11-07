// GitHub REST (read only) for the Forge's "Royal Inspection" of public repositories:
// metadata, languages, file tree, file contents, README and recent commits.
// Private or missing repositories are refused. The token goes in the Authorization header.
import { clip, fetchJson, type CallContext, type Fetched } from './http';
import { requireKey } from './keys';

const P = 'github';
const API = 'https://api.github.com';
export const FILE_MAX_BYTES = 200_000;
export const TREE_MAX_ENTRIES = 400;

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

/** Accepts "owner/repo", "github.com/owner/repo", "https://github.com/owner/repo(.git)(/tree/...)". */
export function parseGithubRepo(input: string): GithubRepoRef {
  let s = String(input ?? '').trim();
  s = s.replace(/^git@github\.com:/i, '').replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '');
  const [owner, rawRepo] = s.split(/[/?#]/);
  const repo = (rawRepo ?? '').replace(/\.git$/i, '');
  if (!owner || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) || /--/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(repo) || repo === '.' || repo === '..')
    throw new Error('repo must look like owner/name or https://github.com/owner/name.');
  return { owner, repo };
}
const base = (r: GithubRepoRef) => `${API}/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`;
const htmlRepo = (r: GithubRepoRef) => `https://github.com/${r.owner}/${r.repo}`;

async function gh<T = any>(url: string, ctx: CallContext, ttlMs: number, accept = 'application/vnd.github+json'): Promise<Fetched<T>> {
  const token = requireKey(P);
  return fetchJson<T>(url, {
    provider: P,
    ctx,
    ttlMs,
    timeoutMs: 20_000,
    accept,
    headers: { authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' },
    okStatuses: [403, 404, 409, 451],
  });
}
function check(r: Fetched<any>, what: string) {
  if (r.status === 404) throw new Error(`${what} was not found on GitHub (or it is private).`);
  if (r.status === 409) throw new Error(`${what} is empty.`);
  if (r.status === 451) throw new Error(`${what} is unavailable for legal reasons.`);
  if (r.status === 403) throw new Error(`GitHub refused the request (rate limit or access): ${clip(String(r.data?.message ?? ''), 160)}`);
}

export interface RepoInfo {
  owner: string;
  repo: string;
  fullName: string;
  description: string | null;
  homepage: string | null;
  defaultBranch: string;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number; // issues + PRs, as GitHub counts them
  license: string | null;
  topics: string[];
  archived: boolean;
  fork: boolean;
  createdAt: string;
  pushedAt: string;
  sizeKb: number;
  languages: { name: string; bytes: number; pct: number }[];
  sourceUrl: string;
  fetchedAt: string;
}
export interface RepoTree {
  owner: string;
  repo: string;
  ref: string;
  totalEntries: number;
  truncated: boolean; // GitHub or our cap cut the list
  entries: { path: string; type: 'file' | 'dir'; size: number | null }[];
  sourceUrl: string;
  fetchedAt: string;
}
export interface RepoFile {
  owner: string;
  repo: string;
  path: string;
  ref: string | null;
  size: number;
  binary: boolean;
  truncated: boolean;
  text: string | null; // null for binary files
  sourceUrl: string;
  fetchedAt: string;
}
export interface RepoCommits {
  owner: string;
  repo: string;
  results: { sha: string; message: string; author: string; date: string; url: string }[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Metadata + language breakdown of a PUBLIC repository. Throws for private or missing repos. */
export async function repoInfo(input: string | GithubRepoRef, ctx: CallContext): Promise<RepoInfo> {
  const ref = typeof input === 'string' ? parseGithubRepo(input) : parseGithubRepo(`${input.owner}/${input.repo}`);
  const r = await gh(base(ref), ctx, 10 * 60_000);
  check(r, `Repository ${ref.owner}/${ref.repo}`);
  const d = r.data;
  if (d.private || d.visibility !== 'public') throw new Error(`Repository ${ref.owner}/${ref.repo} is not public, so the Forge will not read it.`);
  const lang = await gh<Record<string, number>>(`${base(ref)}/languages`, ctx, 60 * 60_000);
  const entries = lang.status === 200 && lang.data ? Object.entries(lang.data) : [];
  const total = entries.reduce((s, [, b]) => s + b, 0) || 1;
  return {
    owner: d.owner?.login ?? ref.owner,
    repo: d.name ?? ref.repo,
    fullName: d.full_name,
    description: d.description ? clip(d.description, 400) : null,
    homepage: typeof d.homepage === 'string' && /^https?:\/\//.test(d.homepage) ? d.homepage : null,
    defaultBranch: d.default_branch,
    stars: d.stargazers_count ?? 0,
    forks: d.forks_count ?? 0,
    watchers: d.subscribers_count ?? d.watchers_count ?? 0,
    openIssues: d.open_issues_count ?? 0,
    license: d.license?.spdx_id && d.license.spdx_id !== 'NOASSERTION' ? d.license.spdx_id : (d.license?.name ?? null),
    topics: (d.topics ?? []).slice(0, 12),
    archived: !!d.archived,
    fork: !!d.fork,
    createdAt: d.created_at,
    pushedAt: d.pushed_at,
    sizeKb: d.size ?? 0,
    languages: entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, bytes]) => ({ name, bytes, pct: Math.round((bytes / total) * 1000) / 10 })),
    sourceUrl: d.html_url ?? htmlRepo(ref),
    fetchedAt: r.fetchedAt,
  };
}

const validRef = (s: string) => /^[A-Za-z0-9._\/-]{1,120}$/.test(s) && !s.includes('..');

/** Recursive file tree (capped at `max` entries, default 400). `ref` defaults to the default branch. */
export async function repoTree(input: string | GithubRepoRef, ctx: CallContext, ref?: string, max = TREE_MAX_ENTRIES): Promise<RepoTree> {
  const info = await repoInfo(input, ctx);
  const r0 = { owner: info.owner, repo: info.repo };
  const branch = ref?.trim() || info.defaultBranch;
  if (!validRef(branch)) throw new Error('ref must be a branch, tag or commit sha.');
  const r = await gh(`${base(r0)}/git/trees/${encodeURIComponent(branch)}?recursive=1`, ctx, 10 * 60_000);
  check(r, `Branch ${branch} of ${info.fullName}`);
  const all = ((r.data?.tree ?? []) as any[]).filter((e) => e.type === 'blob' || e.type === 'tree');
  const cap = Math.min(2000, Math.max(10, max));
  return {
    owner: info.owner,
    repo: info.repo,
    ref: branch,
    totalEntries: all.length,
    truncated: !!r.data?.truncated || all.length > cap,
    entries: all.slice(0, cap).map((e) => ({ path: e.path, type: e.type === 'tree' ? 'dir' : 'file', size: typeof e.size === 'number' ? e.size : null })),
    sourceUrl: `${info.sourceUrl}/tree/${encodeURIComponent(branch)}`,
    fetchedAt: r.fetchedAt,
  };
}

function decodeFile(d: any, maxBytes: number): { text: string | null; binary: boolean; truncated: boolean } {
  if (d?.encoding !== 'base64' || typeof d.content !== 'string') return { text: null, binary: true, truncated: false };
  const buf = Buffer.from(d.content, 'base64');
  const slice = buf.subarray(0, maxBytes);
  if (slice.includes(0)) return { text: null, binary: true, truncated: false };
  return { text: slice.toString('utf8'), binary: false, truncated: buf.length > maxBytes };
}
function checkPath(path: string) {
  const p = path.trim().replace(/^\/+/, '');
  if (!p || p.length > 300 || p.split('/').some((seg) => !seg || seg === '.' || seg === '..') || /[\0\\?#]/.test(p)) throw new Error('path must be a file path inside the repository, e.g. src/index.ts.');
  return p;
}

/** One text file from a public repo (≤1 MB on GitHub; returned text capped at `maxBytes`, default 60 KB). */
export async function repoFile(input: string | GithubRepoRef, path: string, ctx: CallContext, ref?: string, maxBytes = 60_000): Promise<RepoFile> {
  const info = await repoInfo(input, ctx);
  const p = checkPath(path);
  if (ref && !validRef(ref)) throw new Error('ref must be a branch, tag or commit sha.');
  const r0 = { owner: info.owner, repo: info.repo };
  const url = `${base(r0)}/contents/${p.split('/').map(encodeURIComponent).join('/')}` + (ref ? `?ref=${encodeURIComponent(ref)}` : '');
  const r = await gh(url, ctx, 10 * 60_000);
  check(r, `File ${p} in ${info.fullName}`);
  if (Array.isArray(r.data)) throw new Error(`${p} is a folder, not a file.`);
  if (r.data?.type !== 'file') throw new Error(`${p} is not a regular file.`);
  const size = Number(r.data.size ?? 0);
  if (size > 1_000_000 || !r.data.content) throw new Error(`${p} is too large to read here (${Math.round(size / 1024)} KB).`);
  const dec = decodeFile(r.data, Math.min(FILE_MAX_BYTES, Math.max(1000, maxBytes)));
  return { owner: info.owner, repo: info.repo, path: p, ref: ref ?? null, size, ...dec, sourceUrl: r.data.html_url ?? `${info.sourceUrl}/blob/${info.defaultBranch}/${p}`, fetchedAt: r.fetchedAt };
}

/** The repository README (text capped at `maxBytes`, default 30 KB). Throws if there is none. */
export async function repoReadme(input: string | GithubRepoRef, ctx: CallContext, maxBytes = 30_000): Promise<RepoFile> {
  const info = await repoInfo(input, ctx);
  const r = await gh(`${base({ owner: info.owner, repo: info.repo })}/readme`, ctx, 30 * 60_000);
  check(r, `A README in ${info.fullName}`);
  const dec = decodeFile(r.data, Math.min(FILE_MAX_BYTES, Math.max(1000, maxBytes)));
  return { owner: info.owner, repo: info.repo, path: r.data.path ?? 'README', ref: null, size: Number(r.data.size ?? 0), ...dec, sourceUrl: r.data.html_url ?? info.sourceUrl, fetchedAt: r.fetchedAt };
}

/** Most recent commits on the default branch (max 30, default 10). */
export async function repoCommits(input: string | GithubRepoRef, ctx: CallContext, limit = 10): Promise<RepoCommits> {
  const info = await repoInfo(input, ctx);
  const r = await gh(`${base({ owner: info.owner, repo: info.repo })}/commits?per_page=${Math.min(30, Math.max(1, limit))}`, ctx, 10 * 60_000);
  check(r, `Commits of ${info.fullName}`);
  return {
    owner: info.owner,
    repo: info.repo,
    results: ((Array.isArray(r.data) ? r.data : []) as any[]).map((c) => ({
      sha: String(c.sha).slice(0, 7),
      message: clip(String(c.commit?.message ?? '').split('\n')[0], 200),
      author: c.author?.login ?? c.commit?.author?.name ?? '',
      date: c.commit?.author?.date ?? c.commit?.committer?.date ?? '',
      url: c.html_url,
    })),
    sourceUrl: `${info.sourceUrl}/commits`,
    fetchedAt: r.fetchedAt,
  };
}
