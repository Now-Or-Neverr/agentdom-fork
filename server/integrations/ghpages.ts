// Publish Forge websites to GitHub Pages (repo GITHUB_PAGES_REPO, e.g. agentdomworld/agentdom-build).
// - writes sites/<slug>/index.html through the contents API (works on an empty repo: the first
//   PUT creates the first commit on the default branch)
// - enables Pages (branch root) if it is not enabled yet
// - only reports "live" once the public URL really serves the exact HTML we pushed
// Live writes happen only when PUBLISH_ENABLED=1. Otherwise publishSite returns a dry run that
// lists the exact requests it WOULD send (no token in it) and sends nothing.
import { fetchJson, fetchText, UpstreamError, type CallContext } from './http';
import { providerKey } from './registry';
import { envOn } from './media-common';

const API = 'https://api.github.com';
export const publishEnabled = () => envOn('PUBLISH_ENABLED');
export const pagesRepo = () => (process.env.GITHUB_PAGES_REPO || '').trim();
export const SITE_MAX_BYTES = 1024 * 1024;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

function repoParts() {
  const repo = pagesRepo();
  const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(repo);
  if (!m) throw new UpstreamError('github', 0, 'GITHUB_PAGES_REPO is not set (expected owner/name).');
  return { repo, owner: m[1], name: m[2] };
}
/** Public URL of a published site. */
export function siteUrl(slug: string): string {
  const { owner, name } = repoParts();
  const base = name.toLowerCase() === `${owner.toLowerCase()}.github.io` ? `https://${owner.toLowerCase()}.github.io/` : `https://${owner.toLowerCase()}.github.io/${name}/`;
  return `${base}sites/${slug}/`;
}
export function checkSlug(slug: string): string {
  const s = String(slug ?? '').trim().toLowerCase();
  if (!SLUG.test(s)) throw new Error('Site name must be 1-48 lowercase letters, digits or dashes.');
  return s;
}

function headers(): Record<string, string> {
  const t = providerKey('github');
  if (!t) throw new UpstreamError('github', 0, 'GitHub is not configured on this server.');
  return { authorization: `Bearer ${t}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' };
}
const gh = <T>(path: string, ctx: CallContext, o: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown; okStatuses?: number[] } = {}) =>
  fetchJson<T>(API + path, {
    provider: 'github',
    ctx,
    method: o.method ?? 'GET',
    ttlMs: 0,
    timeoutMs: 30_000,
    retries: o.method && o.method !== 'GET' ? 0 : 1,
    headers: headers(),
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    okStatuses: o.okStatuses,
  });

// ---------------- read-only ----------------
export interface PagesRepo {
  repo: string;
  private: boolean;
  defaultBranch: string;
  empty: boolean;
  canPush: boolean | null;
  htmlUrl: string;
  fetchedAt: string;
}
export async function pagesRepoInfo(ctx: CallContext): Promise<PagesRepo> {
  const { repo } = repoParts();
  const r = await gh<{ full_name: string; private: boolean; default_branch: string; size: number; html_url: string; permissions?: { push?: boolean } }>(`/repos/${repo}`, ctx);
  // An empty repo has no branches; `size` is 0 and GET /branches returns [].
  const br = await gh<unknown[]>(`/repos/${repo}/branches?per_page=1`, ctx, { okStatuses: [404, 409] });
  const empty = !Array.isArray(br.data) || br.data.length === 0;
  return { repo: r.data.full_name, private: r.data.private, defaultBranch: r.data.default_branch || 'main', empty, canPush: r.data.permissions?.push ?? null, htmlUrl: r.data.html_url, fetchedAt: r.fetchedAt };
}

export interface PagesStatus {
  enabled: boolean;
  status: string | null; // 'built' | 'building' | 'errored' | null
  url: string | null;
  source: { branch: string; path: string } | null;
  fetchedAt: string;
}
export async function pagesStatus(ctx: CallContext): Promise<PagesStatus> {
  const { repo } = repoParts();
  const r = await gh<{ status?: string; html_url?: string; source?: { branch: string; path: string } } | null>(`/repos/${repo}/pages`, ctx, { okStatuses: [404] });
  if (r.status === 404) return { enabled: false, status: null, url: null, source: null, fetchedAt: r.fetchedAt };
  return { enabled: true, status: r.data?.status ?? null, url: r.data?.html_url ?? null, source: r.data?.source ?? null, fetchedAt: r.fetchedAt };
}

/** One GET of the public site URL. 'live' only when it serves exactly `expectHtml` (if given). */
export async function siteStatus(slug: string, ctx: CallContext, expectHtml?: string): Promise<'live' | 'building'> {
  const url = siteUrl(checkSlug(slug)) + `?v=${Date.now()}`;
  try {
    const r = await fetchText(url, { provider: 'github', ctx, ttlMs: 0, retries: 0, timeoutMs: 10_000, okStatuses: [404], accept: 'text/html', logEndpoint: `pages:${slug}` });
    if (r.status !== 200) return 'building';
    if (expectHtml !== undefined && r.data.trim() !== expectHtml.trim()) return 'building';
    return 'live';
  } catch {
    return 'building';
  }
}

// ---------------- publish ----------------
export interface PlannedRequest {
  method: 'GET' | 'PUT' | 'POST';
  url: string;
  body?: Record<string, unknown>;
  note: string;
}
/**
 * The exact GitHub requests a publish makes (token excluded). Pure: used for dry runs and tests.
 * `existingSha` = current blob sha of the page (update) or null (create); `pagesEnabled` skips the enable step.
 */
export function buildPublishRequests(slug: string, html: string, o: { existingSha: string | null; branch: string | null; pagesEnabled: boolean; message?: string }): PlannedRequest[] {
  const { repo } = repoParts();
  const s = checkSlug(slug);
  const path = `sites/${s}/index.html`;
  const put: Record<string, unknown> = {
    message: o.message ?? `${o.existingSha ? 'Update' : 'Publish'} site ${s}`,
    content: Buffer.from(html, 'utf8').toString('base64'),
  };
  if (o.existingSha) put.sha = o.existingSha;
  if (o.branch) put.branch = o.branch; // omitted on an empty repo: GitHub uses the default branch
  const reqs: PlannedRequest[] = [
    { method: 'GET', url: `${API}/repos/${repo}/contents/${path}`, note: 'look up the current file sha (404 = new file or empty repo)' },
    { method: 'PUT', url: `${API}/repos/${repo}/contents/${path}`, body: put, note: o.existingSha ? 'update the page (new commit)' : 'create the page (first commit if the repo is empty)' },
    { method: 'GET', url: `${API}/repos/${repo}/pages`, note: 'check whether GitHub Pages is enabled' },
  ];
  if (!o.pagesEnabled) {
    reqs.push({ method: 'PUT', url: `${API}/repos/${repo}/contents/.nojekyll`, body: { message: 'Serve files as-is (no Jekyll)', content: '', ...(o.branch ? { branch: o.branch } : {}) }, note: 'turn off Jekyll processing (only if missing)' });
    reqs.push({ method: 'POST', url: `${API}/repos/${repo}/pages`, body: { source: { branch: o.branch ?? 'main', path: '/' } }, note: 'enable GitHub Pages from the branch root' });
  }
  reqs.push({ method: 'GET', url: siteUrl(s), note: 'poll the public URL until it serves this HTML (then "live")' });
  return reqs;
}

export interface PublishResult {
  mode: 'live' | 'dry-run';
  slug: string;
  url: string;
  /** 'live' = the URL serves this HTML now; 'building' = committed, Pages still deploying; 'not-published' = dry run. */
  status: 'live' | 'building' | 'not-published';
  commitUrl: string | null;
  pagesEnabledNow: boolean;
  requests: PlannedRequest[] | null; // dry run only
  at: string;
}

function checkHtml(html: string) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('The page HTML is empty.');
  if (Buffer.byteLength(html, 'utf8') > SITE_MAX_BYTES) throw new Error('The page must be 1 MB or smaller.');
}

/** Publish (or dry-run) one page. Polls up to `waitMs` (default 25 s) for the URL to go live. */
export async function publishSite(slug: string, html: string, ctx: CallContext, opts: { waitMs?: number; message?: string } = {}): Promise<PublishResult> {
  const s = checkSlug(slug);
  checkHtml(html);
  const url = siteUrl(s);
  const at = new Date().toISOString();
  if (!publishEnabled()) {
    return { mode: 'dry-run', slug: s, url, status: 'not-published', commitUrl: null, pagesEnabledNow: false, requests: buildPublishRequests(s, html, { existingSha: null, branch: null, pagesEnabled: false, message: opts.message }), at };
  }
  const { repo } = repoParts();
  const path = `sites/${s}/index.html`;
  const info = await pagesRepoInfo(ctx);
  const branch = info.empty ? null : info.defaultBranch;
  let sha: string | null = null;
  if (!info.empty) {
    const cur = await gh<{ sha?: string }>(`/repos/${repo}/contents/${path}${branch ? `?ref=${encodeURIComponent(branch)}` : ''}`, ctx, { okStatuses: [404] });
    sha = cur.status === 200 ? (cur.data?.sha ?? null) : null;
  }
  const pages = await pagesStatus(ctx).catch(() => null);
  const [, put] = buildPublishRequests(s, html, { existingSha: sha, branch, pagesEnabled: Boolean(pages?.enabled), message: opts.message });
  const w = await gh<{ commit?: { html_url?: string } }>(`/repos/${repo}/contents/${path}`, ctx, { method: 'PUT', body: put.body, okStatuses: [409, 422] });
  if (w.status === 409 || w.status === 422) throw new UpstreamError('github', w.status, 'GitHub refused the write (the file changed meanwhile). Try publishing again.');
  const usedBranch = branch ?? info.defaultBranch;

  let pagesEnabledNow = false;
  if (!pages?.enabled) {
    const nj = await gh(`/repos/${repo}/contents/.nojekyll?ref=${encodeURIComponent(usedBranch)}`, ctx, { okStatuses: [404] });
    if (nj.status === 404) await gh(`/repos/${repo}/contents/.nojekyll`, ctx, { method: 'PUT', body: { message: 'Serve files as-is (no Jekyll)', content: '', branch: usedBranch }, okStatuses: [422] });
    const en = await gh(`/repos/${repo}/pages`, ctx, { method: 'POST', body: { source: { branch: usedBranch, path: '/' } }, okStatuses: [409] });
    pagesEnabledNow = en.status === 201;
  }

  const deadline = Date.now() + Math.min(60_000, Math.max(0, opts.waitMs ?? 25_000));
  let status: 'live' | 'building' = 'building';
  do {
    status = await siteStatus(s, ctx, html);
    if (status === 'live') break;
    await new Promise((r) => setTimeout(r, 5_000));
  } while (Date.now() < deadline);
  return { mode: 'live', slug: s, url, status, commitUrl: w.data?.commit?.html_url ?? null, pagesEnabledNow, requests: null, at };
}
