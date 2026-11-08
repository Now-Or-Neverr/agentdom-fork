// Work log (every real tool call) and Artifacts (images, video, live web pages) of a decree.
// Agent-made HTML only ever runs inside <iframe sandbox="allow-scripts" srcdoc> (no allow-same-origin),
// so it gets an opaque origin and cannot touch this site's storage, cookies or DOM.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, AudioLines, Check, Clapperboard, Code2, Download, ExternalLink, FileText, Gauge, Globe, Hourglass, Image as ImageIcon, Loader2, Maximize2, Megaphone, Rocket, X } from 'lucide-react';
import type { Decree, DecreeArtifact, DecreeStep } from '../../shared/types';
import './decree.css';

const TOOL_LABEL: Record<string, string> = {
  wiki_search: 'Wikipedia search',
  wiki_summary: 'Wikipedia summary',
  search_openalex: 'OpenAlex works',
  search_arxiv: 'arXiv preprints',
  search_openlibrary: 'Open Library books',
  world_bank_indicator: 'World Bank data',
  hn_stories: 'Hacker News',
  mastodon_trends: 'Mastodon trends',
  fx_convert: 'Currency conversion',
  fx_rates: 'Exchange rates',
  fx_history: 'Exchange-rate history',
  public_holidays: 'Public holidays',
  federal_register: 'Federal Register',
  check_grammar: 'Grammar check',
  define_word: 'Dictionary',
  related_words: 'Related words',
  current_weather: 'Weather',
  generate_image: 'Image generation',
  make_video: 'Video render',
  publish_web_page: 'Web page',
  web_search: 'Web search',
  read_url: 'Read web page',
  exa_search: 'Exa neural search',
  find_similar_companies: 'Similar companies',
  fred_search: 'FRED series search',
  fred_series: 'FRED data',
  ask_wolfram: 'Wolfram|Alpha',
  stock_quote: 'Stock quote',
  company_profile: 'Company profile',
  company_news: 'Company news',
  news: 'News headlines',
  youtube_trending: 'YouTube trending',
  youtube_search: 'YouTube search',
  draft_bluesky_post: 'Bluesky draft',
  local_businesses: 'Local businesses',
  case_law: 'Case law',
  translate: 'Translation',
  stock_photos: 'Stock photo search',
  use_stock_photo: 'Stock photo',
  remove_background: 'Background removal',
  stock_videos: 'Stock footage search',
  find_music: 'Music search',
  make_film: 'Film render',
  publish_site: 'Site publish',
  audit_site: 'Site audit',
  scrape_site: 'Site scrape',
  repo_info: 'Repository info',
  repo_tree: 'Repository tree',
  repo_file: 'Repository file',
  job_search: 'Job search',
  transcribe_audio: 'Transcription',
  read_image_text: 'Text from image (OCR)',
  scan_url: 'Link scan',
  uk_company_search: 'UK company search',
  uk_company_profile: 'UK company profile',
  nutrition_lookup: 'Nutrition lookup',
  record_voiceover: 'Voice-over recording',
  brand_lookup: 'Brand lookup',
};

/** The most telling input of a step, e.g. the search query. */
function inputLine(s: DecreeStep): string {
  const i = s.input;
  const repo = i.repo ? String(i.repo) + (i.path ? ' · ' + String(i.path) : '') : null;
  const pick = i.query ?? i.food ?? i.domain ?? i.company_number ?? repo ?? i.url ?? i.slug ?? i.series ?? i.symbol ?? i.input ?? (i.place && i.category ? `${i.category} · ${i.place}` : null) ?? i.title ?? i.word ?? i.place ?? i.prompt ?? (i.from && i.to ? `${i.amount ?? ''} ${i.from} → ${i.to}` : null) ?? (i.country ? `${i.country}${i.indicator ? ' · ' + i.indicator : ''}` : null) ?? i.base ?? i.kind ?? null;
  return pick == null ? '' : String(pick).slice(0, 140);
}

const secs = (ms: number | null) => (ms == null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function NowDoing({ d }: { d: Decree }) {
  if (d.status !== 'working') return null;
  return (
    <div className="now-doing" role="status" aria-live="polite">
      <span className="now-dot" />
      <span>
        <b>{d.agent?.name ?? 'The agent'}</b> · {d.nowDoing ?? 'At work'}
      </span>
    </div>
  );
}

export function WorkLog({ d }: { d: Decree }) {
  const steps = d.steps ?? [];
  const [open, setOpen] = useState(true);
  if (!steps.length) return null;
  const multi = new Set(steps.map((s) => s.revision)).size > 1;
  const ok = steps.filter((s) => s.status === 'ok').length;
  const bad = steps.filter((s) => s.status === 'error').length;
  return (
    <section className="dw-section dw-log">
      <button type="button" className="dw-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="dw-head-title">
          <span className="kicker">
            Provenance
          </span>
          <span className="display dw-h2">Work log</span>
        </span>
        <span className="dw-head-tags">
          <span className="tag">
            {steps.length} tool call{steps.length === 1 ? '' : 's'}
          </span>
          {bad > 0 && <span className="tag red">{bad} failed</span>}
          <span className="dw-toggle">{open ? 'Hide' : 'Show'}</span>
        </span>
      </button>
      {open && (
        <>
          <p className="muted dw-note">Every row is a real call the agent made while working: live public APIs or local rendering. {ok} succeeded.</p>
          <ol className="worklog">
            {steps.map((s) => (
              <li key={s.id} className={'wl-row wl-' + s.status}>
                <span className="wl-icon" aria-label={s.status}>
                  {s.status === 'running' ? <Loader2 size={14} className="spin" /> : s.status === 'ok' ? <Check size={14} /> : <AlertTriangle size={14} />}
                </span>
                <span className="wl-main">
                  <span className="wl-tool">
                    {TOOL_LABEL[s.tool] ?? s.tool}
                    {multi && <span className="wl-rev">rev {s.revision}</span>}
                  </span>
                  {inputLine(s) && <span className="wl-input">“{inputLine(s)}”</span>}
                  <span className="wl-summary">{s.status === 'running' ? 'Working…' : s.summary}</span>
                </span>
                <span className="wl-meta">
                  {s.sourceUrl && /^https?:\/\//.test(s.sourceUrl) && (
                    <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="wl-src">
                      {s.sourceName ?? 'Source'} <ExternalLink size={11} />
                    </a>
                  )}
                  {(!s.sourceUrl || !/^https?:\/\//.test(s.sourceUrl)) && s.sourceName && <span className="wl-src plain">{s.sourceName}</span>}
                  <span className="mono">
                    {clock(s.at)}
                    {s.ms != null && ` · ${secs(s.ms)}`}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function download(name: string, html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'page';

function PagePreview({ a }: { a: DecreeArtifact }) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [full]);
  const html = a.html ?? '';
  const frame = (cls: string) => <iframe className={cls} title={a.title} sandbox="allow-scripts" srcDoc={html} referrerPolicy="no-referrer" loading="lazy" />;
  return (
    <figure className="art-page">
      <div className="art-page-bar">
        <span className="art-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="art-page-title">
          <Globe size={13} /> {a.title}
        </span>
        <span className="mono muted" style={{ fontSize: 11 }}>
          {((Number(a.meta.bytes) || html.length) / 1024).toFixed(1)} KB
        </span>
      </div>
      {frame('art-frame')}
      <figcaption className="art-actions">
        {typeof a.meta.liveUrl === 'string' && (
          <a className="btn btn-sm btn-primary" href={a.meta.liveUrl} target="_blank" rel="noopener noreferrer">
            <Globe size={14} /> Open live link
          </a>
        )}
        <button type="button" className="btn btn-sm" onClick={() => setFull(true)}>
          <Maximize2 size={14} /> Open full screen
        </button>
        <button type="button" className="btn btn-sm" onClick={() => download(slug(a.title) + '.html', html)}>
          <Download size={14} /> Download .html
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          Runs in a sandbox: scripts on, no access to this site.
        </span>
      </figcaption>
      {full && (
        <div className="art-full" role="dialog" aria-modal="true" aria-label={a.title}>
          <div className="art-full-bar">
            <span className="art-page-title">
              <Globe size={14} /> {a.title}
            </span>
            <button type="button" className="btn btn-sm" onClick={() => download(slug(a.title) + '.html', html)}>
              <Download size={14} /> Download
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setFull(false)} autoFocus>
              <X size={14} /> Close
            </button>
          </div>
          {frame('art-full-frame')}
        </div>
      )}
    </figure>
  );
}

type Credit = { kind?: string; title?: string; author?: string; authorUrl?: string; pageUrl?: string; license?: string; licenseUrl?: string };
const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//.test(u);
const ext = (href: unknown, text: string) =>
  isHttp(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  ) : (
    <span>{text}</span>
  );

function FilmCredits({ a }: { a: DecreeArtifact }) {
  const credits = (Array.isArray(a.meta.credits) ? a.meta.credits : []) as Credit[];
  const notes = (Array.isArray(a.meta.notes) ? a.meta.notes : []) as string[];
  if (!credits.length && !a.meta.narration && !notes.length) return null;
  const kindLabel = (k?: string) => (k === 'music' ? 'Music' : k === 'photo' ? 'Photo' : 'Footage');
  return (
    <div className="film-credits">
      <div className="film-credits-head">Credits</div>
      <ul>
        {credits.map((c, k) => (
          <li key={k}>
            <span className="tag">{kindLabel(c.kind)}</span>
            {ext(c.pageUrl, c.title || 'Untitled')}
            <span className="muted"> by </span>
            {ext(c.authorUrl, c.author || 'unknown')}
            <span className="muted"> · </span>
            {ext(c.licenseUrl, c.license || 'license unknown')}
          </li>
        ))}
        {Boolean(a.meta.narration) && (
          <li>
            <span className="tag">Voice</span>
            <span>Narration synthesised with {String(a.meta.narrationModel ?? 'Cloudflare MeloTTS')}</span>
          </li>
        )}
      </ul>
      {typeof a.meta.narrationText === 'string' && a.meta.narrationText && (
        <details>
          <summary>Narration script</summary>
          <p>{a.meta.narrationText}</p>
        </details>
      )}
      {notes.length > 0 && (
        <p className="film-notes">
          <AlertTriangle size={12} /> {notes.join(' ')}
        </p>
      )}
    </div>
  );
}

function SiteCard({ a }: { a: DecreeArtifact }) {
  const status = String(a.meta.status ?? 'dry-run');
  const live = status === 'live' && isHttp(a.url);
  const label = live ? 'Live' : status === 'building' ? 'Building on GitHub Pages' : 'Prepared, not live yet';
  return (
    <div className={'art-card site-' + (live ? 'live' : status)}>
      <div className="art-card-row">
        <Rocket size={16} />
        <b>{a.title}</b>
        <span className={'tag ' + (live ? 'gold' : '')}>{label}</span>
      </div>
      <p className="muted art-card-text">
        {live ? (
          <>
            Published as <span className="mono">{String(a.meta.slug)}</span> on GitHub Pages:{' '}
            <a href={a.url!} target="_blank" rel="noopener noreferrer">
              {a.url} <ExternalLink size={11} />
            </a>
          </>
        ) : status === 'building' ? (
          <>The page was committed to GitHub; Pages was still deploying when the agent checked, so there is no confirmed public address yet.</>
        ) : (
          <>Prepared for publishing as <span className="mono">{String(a.meta.slug)}</span>, but publishing is switched off on this server (dry run). Nothing is online yet.</>
        )}
      </p>
      {isHttp(a.meta.commitUrl) && (
        <a className="wl-src" href={a.meta.commitUrl} target="_blank" rel="noopener noreferrer">
          Commit on GitHub <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}

function DraftCard({ a }: { a: DecreeArtifact }) {
  const status = String(a.meta.status ?? 'pending');
  return (
    <div className="art-card draft">
      <div className="art-card-row">
        <Megaphone size={16} />
        <b>Bluesky draft</b>
        <span className="tag">
          <Hourglass size={11} /> {status === 'pending' ? 'Waiting for the Herald’s approval' : status}
        </span>
      </div>
      <blockquote className="draft-text">{String(a.meta.text ?? '')}</blockquote>
      {typeof a.meta.image === 'string' && a.meta.image.startsWith('/uploads/') && <img className="draft-img" src={a.meta.image} alt={String(a.meta.alt ?? '')} loading="lazy" />}
      <p className="muted art-card-text">Not posted. Nothing goes to Bluesky until the realm’s Herald approves this draft.</p>
    </div>
  );
}

function AuditCard({ a }: { a: DecreeArtifact }) {
  const scores = (a.meta.scores && typeof a.meta.scores === 'object' ? a.meta.scores : {}) as Record<string, number | null>;
  const metrics = (Array.isArray(a.meta.metrics) ? a.meta.metrics : []) as { label: string; value: string }[];
  const name: Record<string, string> = { performance: 'Performance', accessibility: 'Accessibility', 'best-practices': 'Best practices', seo: 'SEO' };
  return (
    <div className="art-card audit">
      <div className="art-card-row">
        <Gauge size={16} />
        <b>{a.title}</b>
        <span className="tag">{String(a.meta.strategy ?? 'mobile')}</span>
      </div>
      <div className="audit-scores">
        {Object.entries(scores).map(([k, v]) => (
          <div key={k} className={'audit-score ' + (v == null ? '' : v >= 90 ? 'good' : v >= 50 ? 'mid' : 'bad')}>
            <span className="audit-num">{v ?? '–'}</span>
            <span className="audit-label">{name[k] ?? k}</span>
          </div>
        ))}
      </div>
      {metrics.length > 0 && (
        <p className="muted art-card-text">
          {metrics.map((m) => `${m.label} ${m.value}`).join(' · ')}
        </p>
      )}
      {isHttp(a.meta.sourceUrl) && (
        <a className="wl-src" href={a.meta.sourceUrl} target="_blank" rel="noopener noreferrer">
          Full PageSpeed report <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}

export function Artifacts({ d }: { d: Decree }) {
  const arts = d.artifacts ?? [];
  const images = useMemo(() => arts.filter((a) => a.kind === 'image'), [arts]);
  const videos = arts.filter((a) => a.kind === 'video');
  const audios = arts.filter((a) => a.kind === 'audio');
  const files = arts.filter((a) => a.kind === 'file');
  const pages = arts.filter((a) => a.kind === 'html').reverse(); // newest version first
  const records = arts.filter((a) => a.kind === 'site' || a.kind === 'draft' || a.kind === 'audit');
  const multi = new Set(arts.map((a) => a.revision)).size > 1;
  if (!arts.length) return null;
  return (
    <section className="dw-section">
      <div className="dw-head static">
        <span className="dw-head-title">
          <span className="kicker">
            Deliverables
          </span>
          <span className="display dw-h2">Artifacts</span>
        </span>
        <span className="dw-head-tags">
          <span className="tag gold">
            {arts.length} item{arts.length === 1 ? '' : 's'}
          </span>
        </span>
      </div>

      {records.map((a) => (
        <div key={a.id} className="art-block">
          <div className="art-kicker">
            {a.kind === 'site' ? <Rocket size={13} /> : a.kind === 'draft' ? <Megaphone size={13} /> : <Gauge size={13} />}{' '}
            {a.kind === 'site' ? 'Published site' : a.kind === 'draft' ? 'Social draft' : 'Site audit'}
            {multi && ` · revision ${a.revision}`}
          </div>
          {a.kind === 'site' ? <SiteCard a={a} /> : a.kind === 'draft' ? <DraftCard a={a} /> : <AuditCard a={a} />}
        </div>
      ))}

      {pages.map((a) => (
        <div key={a.id} className="art-block">
          <div className="art-kicker">
            <Code2 size={13} /> Web page{multi && ` · revision ${a.revision}`}
          </div>
          <PagePreview a={a} />
        </div>
      ))}

      {videos.map((a) => (
        <div key={a.id} className="art-block">
          <div className="art-kicker">
            <Clapperboard size={13} /> {a.meta.film ? 'Film' : 'Video'}
            {multi && ` · revision ${a.revision}`}
          </div>
          <figure className="art-video">
            <video
              controls
              preload="metadata"
              playsInline
              src={a.url ?? undefined}
              poster={Array.isArray(a.meta.frames) && a.meta.frames.length ? String(a.meta.frames[0]) : undefined}
            />
            <figcaption>
              <span className="art-video-text">
              <b className="art-cap-title">{a.title}</b>
              <span className="art-cap-meta">
                {String(a.meta.durationSec ?? '?')} s · {a.meta.film ? `${String(a.meta.scenes ?? '?')} scenes` : `${String(a.meta.slides ?? '?')} slides`} · {String(a.meta.width)}×{String(a.meta.height)} · H.264 MP4
                {a.meta.film ? (a.meta.narration ? ' · narration' : '') + (a.meta.music ? ' · music' : '') + (!a.meta.narration && !a.meta.music ? ' · no sound' : '') : ''}
                {a.meta.subtitles ? ' · captions (CC)' : ''}
              </span>
              </span>
              <a className="btn btn-sm" href={a.url ?? '#'} download>
                <Download size={14} /> Download .mp4
              </a>
            </figcaption>
            {Boolean(a.meta.film) && <FilmCredits a={a} />}
          </figure>
        </div>
      ))}

      {audios.map((a) => (
        <div key={a.id} className="art-block">
          <div className="art-kicker">
            <AudioLines size={13} /> Voice-over{multi && ` · revision ${a.revision}`}
          </div>
          <div className="art-card art-audio">
            <div className="art-card-row">
              <b>{a.title}</b>
              <span className="tag">
                {[a.meta.voice ? `${String(a.meta.voice)} voice` : null, typeof a.meta.durationSec === 'number' ? `${Math.round(a.meta.durationSec)} s` : null, 'MP3'].filter(Boolean).join(' · ')}
              </span>
            </div>
            <audio controls preload="metadata" src={a.url ?? undefined} />
            {typeof a.meta.text === 'string' && a.meta.text && (
              <details>
                <summary>Script</summary>
                <p className="art-card-text">{a.meta.text}</p>
              </details>
            )}
            <span className="art-img-meta">
              <span className="muted">{String(a.meta.attribution ?? 'Voice by ElevenLabs')}</span>
              <a href={a.url ?? '#'} download className="wl-src">
                Download .mp3 <Download size={11} />
              </a>
            </span>
          </div>
        </div>
      ))}

      {files.length > 0 && (
        <div className="art-block">
          <div className="art-kicker">
            <FileText size={13} /> Files
          </div>
          {files.map((a) => (
            <div key={a.id} className="art-card art-file">
              <div className="art-card-row">
                <b>{a.title}</b>
                <span className="tag">.{String(a.meta.format ?? 'txt')}</span>
                {multi && <span className="wl-rev">rev {a.revision}</span>}
              </div>
              {typeof a.meta.preview === 'string' && a.meta.preview && <p className="muted art-card-text">{a.meta.preview.length >= 600 ? a.meta.preview + '…' : a.meta.preview}</p>}
              <span className="art-img-meta">
                <span className="muted">
                  {[a.meta.provider ? String(a.meta.provider) : null, typeof a.meta.durationSec === 'number' ? `${Math.round(a.meta.durationSec)} s of audio` : null, a.meta.truncated ? 'first part only' : null].filter(Boolean).join(' · ')}
                </span>
                <a href={a.url ?? '#'} download className="wl-src">
                  Download <Download size={11} />
                </a>
              </span>
            </div>
          ))}
        </div>
      )}

      {images.length > 0 && (
        <div className="art-block">
          <div className="art-kicker">
            <ImageIcon size={13} /> Images
          </div>
          <div className="art-gallery">
            {images.map((a, i) => (
              <figure key={a.id} className="art-img">
                <a href={a.url ?? '#'} target="_blank" rel="noopener noreferrer">
                  <img
                    src={a.url ?? ''}
                    alt={typeof a.meta.alt === 'string' && a.meta.alt ? a.meta.alt : a.title}
                    loading="lazy"
                    style={{ aspectRatio: `${Number(a.meta.width) || 4} / ${Number(a.meta.height) || 3}` }}
                  />
                </a>
                <figcaption>
                  <span className="art-img-no">Image {String(i + 1).padStart(2, '0')}</span>
                  <b className="art-cap-title">{a.title}</b>
                  {multi && <span className="wl-rev">rev {a.revision}</span>}
                  {typeof a.meta.alt === 'string' && a.meta.alt && (
                    <span className="art-alt">
                      <span className="tag">ALT</span> {a.meta.alt}
                    </span>
                  )}
                  {a.meta.credit != null && typeof a.meta.credit === 'object' && (
                    <span className="art-alt">
                      Photo by {ext((a.meta.credit as Credit).authorUrl, (a.meta.credit as Credit).author ?? 'Pixabay user')} on {ext((a.meta.credit as Credit).pageUrl, 'Pixabay')} ·{' '}
                      {ext((a.meta.credit as Credit).licenseUrl, (a.meta.credit as Credit).license ?? 'Pixabay Content License')}
                    </span>
                  )}
                  {a.meta.prompt != null && (
                    <details>
                      <summary>Prompt</summary>
                      <p>{String(a.meta.prompt)}</p>
                    </details>
                  )}
                  <span className="art-img-meta">
                    <span className="muted">
                      {String(a.meta.width)}×{String(a.meta.height)} · {String(a.meta.provider ?? 'Pollinations')}
                    </span>
                    {typeof a.meta.sourceUrl === 'string' && (
                      <a href={a.meta.sourceUrl} target="_blank" rel="noopener noreferrer" className="wl-src">
                        Source <ExternalLink size={11} />
                      </a>
                    )}
                    <a href={a.url ?? '#'} download className="wl-src">
                      Download <Download size={11} />
                    </a>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
