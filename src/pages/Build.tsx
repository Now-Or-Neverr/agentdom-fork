// /build — App Builder: describe a page, an app or a file; it is written for you and goes live
// at its own link (/p/<slug>). Revise it in plain words, restore older versions, download it.
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, Copy, Download, ExternalLink, FileText, Flag, History, Laptop, Loader2, RotateCcw, Shuffle, Smartphone, Sparkles, Wand2 } from 'lucide-react';
import { AppShell } from '../app/AppShell';
import { useApp } from '../lib/store';
import { ago } from '../lib/api';
import { buildApi, pageUrl, type BuildFormat, type BuildView, type BuilderStatus, type GalleryPage } from '../lib/buildApi';
import './build.css';
import { NotifyButton } from '../components/NotifyButton';

const FORMATS: { id: BuildFormat; label: string }[] = [
  { id: 'auto', label: 'Let it decide' },
  { id: 'web', label: 'Web page or app' },
  { id: 'md', label: 'Markdown' },
  { id: 'csv', label: 'CSV' },
  { id: 'json', label: 'JSON' },
  { id: 'txt', label: 'Text' },
  { id: 'svg', label: 'SVG' },
];

const IDEAS: { label: string; prompt: string; format: BuildFormat }[] = [
  { label: 'Landing page', format: 'web', prompt: 'A landing page for a weekend pottery workshop in Lisbon: hero, what you will make, schedule, price, FAQ and a sign-up section (display only, no real sign-ups). Warm, earthy and modern.' },
  { label: 'Budget calculator', format: 'web', prompt: 'A monthly budget calculator: income, fixed costs and spending categories, a live chart of where the money goes, and the 50/30/20 rule check.' },
  { label: 'Mini game', format: 'web', prompt: 'A small browser game: catch falling stars with a basket using the arrow keys or touch, score, lives, speed that ramps up, and a restart button.' },
  { label: 'Portfolio', format: 'web', prompt: 'A one-page portfolio for a freelance illustrator called Mara Quinn: selected work grid with SVG placeholders, services, process, testimonials and contact.' },
  { label: 'Wedding invite', format: 'web', prompt: 'An elegant wedding invitation page for Anna and Leo, 14 June, a countdown, the day plan, map directions text and an RSVP form that shows a thank-you message (forms are display only).' },
  { label: 'Quiz', format: 'web', prompt: 'A 10-question quiz about the solar system with instant feedback, a score at the end and a share-your-score text.' },
  { label: 'README', format: 'md', prompt: 'A README for an open source habit tracker app: features, screenshots section, install, configuration, contributing and license.' },
  { label: 'Content plan', format: 'csv', prompt: 'A 30-day Instagram content plan for a vegan bakery as CSV: date, pillar, format, idea, caption hook, call to action.' },
];

const STAGES = ['Reading your request', 'Planning the layout', 'Writing the file', 'Polishing the details', 'Almost there'];

function useStatus() {
  const [st, setSt] = useState<BuilderStatus | null>(null);
  const load = useCallback(() => buildApi.status().then(setSt).catch(() => null), []);
  useEffect(() => {
    load();
  }, [load]);
  return [st, load] as const;
}

function Progress({ b }: { b: BuildView }) {
  const secs = b.progress?.seconds ?? 0;
  const chars = b.progress?.chars ?? 0;
  const painting = b.progress?.stage === 'images';
  const stage = painting ? 'Painting images' : STAGES[Math.min(STAGES.length - 1, chars < 200 ? 0 : chars < 1500 ? 1 : chars < 9000 ? 2 : chars < 20000 ? 3 : 4)];
  return (
    <div className="bd-progress" role="status" aria-live="polite">
      <div className="bd-loom" aria-hidden>
        {Array.from({ length: 18 }, (_, i) => (
          <span key={i} style={{ animationDelay: `${(i % 6) * 0.12 + Math.floor(i / 6) * 0.2}s` }} />
        ))}
      </div>
      <div>
        <b>{stage}…</b>
        <p>
          {painting
            ? `The page is written. Painting its pictures${b.progress?.images ? ` (${b.progress.images} done)` : ''}`
            : chars > 0
              ? `${chars.toLocaleString('en')} characters written`
              : 'Starting up'}{' '}
          · {secs}s
        </p>
        <small>Big pages can take a minute or two. You can leave this page; your build keeps going and stays in “Your builds”.</small>
        {b.mine && (
          <div style={{ marginTop: 10 }}>
            <NotifyButton />
          </div>
        )}
      </div>
    </div>
  );
}

function OwnerTools({ b, onChange }: { b: BuildView; onChange: (b: BuildView) => void }) {
  const { toast } = useApp();
  const [name, setName] = useState(b.slug);
  const [saving, setSaving] = useState(false);
  const [pub, setPub] = useState(false);
  useEffect(() => setName(b.slug), [b.slug]);
  const clean = name.trim().toLowerCase();
  const valid = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(clean) && clean.length >= 3 && clean.length <= 40 && !clean.includes('--');

  const togglePublic = async (on: boolean) => {
    setPub(true);
    try {
      onChange(await buildApi.setPublic(b.id, on));
      toast(on ? 'It is in the gallery now.' : 'Taken out of the gallery.');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setPub(false);
    }
  };
  const rename = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || clean === b.slug) return;
    setSaving(true);
    try {
      onChange(await buildApi.rename(b.id, clean));
      toast('New link saved. The old link still works.');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bd-owner">
      <label className="bd-check">
        <input type="checkbox" checked={b.isPublic} disabled={pub} onChange={(e) => togglePublic(e.target.checked)} />
        <span>
          <b>Show in the gallery</b>
          <small>Anyone can find it under “Made with Agentdom” and remix it.</small>
        </span>
      </label>
      <form className="bd-rename" onSubmit={rename}>
        <label htmlFor="bd-slug">Link name</label>
        <div className="bd-rename-row">
          <span aria-hidden>/p/</span>
          <input
            id="bd-slug"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40))}
            spellCheck={false}
            autoComplete="off"
            aria-describedby="bd-slug-help"
          />
          <button className="bd-mini" disabled={saving || !valid || clean === b.slug}>
            {saving ? <Loader2 size={12} className="spin" /> : <Check size={12} />} Save
          </button>
        </div>
        <small id="bd-slug-help">3 to 40 lowercase letters, numbers or dashes. Old links keep working.</small>
      </form>
    </div>
  );
}

function RemixBox({ b, status, onRemixed }: { b: BuildView; status: BuilderStatus | null; onRemixed: (id: string) => void }) {
  const { toast } = useApp();
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (!ask.trim()) return;
    setBusy(true);
    try {
      const r = await buildApi.remix(b.slug, ask.trim());
      setAsk('');
      onRemixed(r.id);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="bd-revise" onSubmit={go}>
      <label htmlFor="bd-remix">Remix this</label>
      <p className="bd-fine" style={{ margin: 0 }}>
        Start your own build from this file. Say what to change; the original stays as it is.
      </p>
      <textarea
        id="bd-remix"
        value={ask}
        onChange={(e) => setAsk(e.target.value)}
        placeholder="e.g. make it for my coffee shop in Bandung, switch to a dark theme"
        rows={3}
        maxLength={2000}
      />
      <button className="btn btn-primary" disabled={busy || !ask.trim() || (status ? !status.open : false)}>
        {busy ? <Loader2 size={15} className="spin" /> : <Shuffle size={15} />} Remix it
      </button>
    </form>
  );
}

function Gallery({ onRemix }: { onRemix: (slug: string) => void }) {
  const [items, setItems] = useState<GalleryPage['items'] | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const load = useCallback((offset: number) => {
    setLoading(true);
    buildApi
      .gallery(offset, 12)
      .then((p) => {
        setItems((prev) => (offset ? [...(prev ?? []), ...p.items] : p.items));
        setMore(p.more);
      })
      .catch(() => setItems((prev) => prev ?? []))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => load(0), [load]);
  if (!items || !items.length) return null;
  return (
    <section className="bd-mine bd-gallery" aria-labelledby="bd-gallery-h">
      <div className="bd-mine-head">
        <h2 id="bd-gallery-h">Made with Agentdom</h2>
        <span>Shared by their makers</span>
      </div>
      <div className="bd-ggrid">
        {items.map((g) => (
          <article key={g.slug} className="bd-gcard">
            <a className="bd-thumb" href={`/p/${g.slug}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${g.title}`}>
              {g.ext === 'html' ? (
                <iframe src={`/p/${g.slug}?thumb=1`} title="" loading="lazy" tabIndex={-1} aria-hidden sandbox="allow-scripts" scrolling="no" />
              ) : (
                <span className="bd-thumb-ext">.{g.ext}</span>
              )}
            </a>
            <div className="bd-gbody">
              <b>{g.title}</b>
              <small>
                {g.ext.toUpperCase()} · {g.views.toLocaleString('en')} views{g.remixes ? ` · ${g.remixes} ${g.remixes === 1 ? 'remix' : 'remixes'}` : ''}
              </small>
            </div>
            <div className="bd-gacts">
              <a className="bd-mini" href={`/p/${g.slug}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={12} /> Open
              </a>
              <button className="bd-mini" onClick={() => onRemix(g.slug)}>
                <Shuffle size={12} /> Remix
              </button>
            </div>
          </article>
        ))}
      </div>
      {more && (
        <div className="bd-gmore">
          <button className="btn btn-quiet" disabled={loading} onClick={() => load(items.length)}>
            {loading ? <Loader2 size={15} className="spin" /> : null} More
          </button>
        </div>
      )}
    </section>
  );
}

function Result({ b, onChange, status, onRemixed }: { b: BuildView; onChange: (b: BuildView) => void; status: BuilderStatus | null; onRemixed?: (id: string) => void }) {
  const { toast } = useApp();
  const [view, setView] = useState<'desktop' | 'mobile'>('desktop');
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reload, setReload] = useState(0);
  const url = pageUrl(b.slug);
  const isWeb = b.ext === 'html';
  useEffect(() => setReload((r) => r + 1), [b.version]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast('Copy failed. Select the link and copy it by hand.');
    }
  };
  const revise = async (e: FormEvent) => {
    e.preventDefault();
    if (!ask.trim()) return;
    setBusy(true);
    try {
      await buildApi.revise(b.id, ask.trim());
      setAsk('');
      onChange(await buildApi.get(b.id));
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const restore = async (v: number) => {
    try {
      onChange(await buildApi.restore(b.id, v));
      toast(`Version ${v} is live again.`);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <div className="bd-result">
      <div className="bd-stage">
        <div className="bd-stage-bar">
          <span className="bd-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <a className="bd-url" href={url} target="_blank" rel="noopener noreferrer">
            {url.replace(/^https?:\/\//, '')}
          </a>
          {isWeb && (
            <div className="bd-seg" role="group" aria-label="Preview size">
              <button className={view === 'desktop' ? 'on' : ''} onClick={() => setView('desktop')} aria-label="Desktop preview">
                <Laptop size={14} />
              </button>
              <button className={view === 'mobile' ? 'on' : ''} onClick={() => setView('mobile')} aria-label="Phone preview">
                <Smartphone size={14} />
              </button>
            </div>
          )}
        </div>
        <div className={`bd-frame-wrap ${view}`}>
          {b.status === 'building' && <div className="bd-frame-veil">{b.progress ? <Progress b={b} /> : null}</div>}
          <iframe
            key={reload}
            className="bd-frame"
            title={b.title}
            src={`/p/${b.slug}`}
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
          />
        </div>
      </div>

      <aside className="bd-side">
        <span className="bd-kicker">
          <FileText size={13} /> {b.filename} · v{b.version}
        </span>
        <h2>{b.title}</h2>
        <div className="bd-link">
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Public link" />
          <button className="btn btn-primary" onClick={copy}>
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        <div className="bd-actions">
          <a className="btn btn-quiet" href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={15} /> Open
          </a>
          <a className="btn btn-quiet" href={`/p/${b.slug}?download=1`}>
            <Download size={15} /> Download
          </a>
        </div>
        {b.error && <p className="bd-error">{b.error}</p>}
        {b.remixedFrom && (
          <p className="bd-origin">
            <Shuffle size={13} /> Remixed from{' '}
            <a href={`/p/${b.remixedFrom.slug}`} target="_blank" rel="noopener noreferrer">
              {b.remixedFrom.title}
            </a>
          </p>
        )}

        {b.mine && b.status === 'live' && <OwnerTools b={b} onChange={onChange} />}
        {!b.mine && b.status === 'live' && onRemixed && <RemixBox b={b} status={status} onRemixed={onRemixed} />}

        {b.mine && (
          <form className="bd-revise" onSubmit={revise}>
            <label htmlFor="bd-ask">Change something</label>
            <textarea
              id="bd-ask"
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder="e.g. make it dark green, add a pricing table, translate it to Spanish"
              rows={3}
              maxLength={2000}
              disabled={b.status === 'building'}
            />
            <button className="btn btn-primary" disabled={busy || b.status === 'building' || !ask.trim() || (status ? !status.open : false)}>
              {busy || b.status === 'building' ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />} {b.status === 'building' ? 'Updating…' : 'Update it'}
            </button>
          </form>
        )}

        {b.mine && b.versions.length > 1 && (
          <details className="bd-versions">
            <summary>
              <History size={14} /> {b.versions.length} versions
            </summary>
            <ol>
              {b.versions.map((v) => (
                <li key={v.version}>
                  <div>
                    <b>v{v.version}</b> <span>{v.prompt}</span>
                    <small>{ago(v.createdAt)}</small>
                  </div>
                  {v.version !== b.version && (
                    <button className="bd-mini" onClick={() => restore(v.version)} disabled={b.status === 'building'}>
                      <RotateCcw size={12} /> Restore
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </details>
        )}
        <p className="bd-fine">Anyone with the link can open it. Pages run in a locked sandbox: they can’t send data anywhere, submit forms or read anything from this site. They can load images and common libraries from public CDNs.</p>
      </aside>
    </div>
  );
}

function ReportBox({ slug, onDone }: { slug: string; onDone: () => void }) {
  const { toast } = useApp();
  const [why, setWhy] = useState('');
  const [sent, setSent] = useState(false);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await buildApi.report(slug, why.trim());
      setSent(true);
    } catch (err) {
      toast((err as Error).message);
    }
  };
  return (
    <section className="bd-report card">
      <Flag size={18} />
      {sent ? (
        <div>
          <h3>Thanks, we got it.</h3>
          <p>We’ll review /p/{slug}. Pages with several reports are hidden until checked.</p>
          <button className="btn btn-quiet" onClick={onDone}>
            Close
          </button>
        </div>
      ) : (
        <form onSubmit={send}>
          <h3>Report /p/{slug}</h3>
          <p>Tell us what’s wrong: scam, impersonation, offensive content or anything else.</p>
          <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={3} maxLength={300} placeholder="What did you see?" />
          <div className="bd-actions">
            <button className="btn btn-primary">Send report</button>
            <button type="button" className="btn btn-quiet" onClick={onDone}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

export default function Build() {
  const { user, toast } = useApp();
  const [params, setParams] = useSearchParams();
  const [status, loadStatus] = useStatus();
  const [prompt, setPrompt] = useState('');
  const [format, setFormat] = useState<BuildFormat>('auto');
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<BuildView | null>(null);
  const [mine, setMine] = useState<BuildView[] | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const openId = params.get('b');
  const report = params.get('report');

  const loadMine = useCallback(() => {
    buildApi
      .mine()
      .then(setMine)
      .catch(() => setMine([]));
  }, []);
  useEffect(() => {
    if (user) loadMine();
  }, [user, loadMine]);

  // open ?b=<id>
  useEffect(() => {
    if (!openId || current?.id === openId) return;
    buildApi
      .get(openId)
      .then(setCurrent)
      .catch(() => setParams({}, { replace: true }));
  }, [openId]);

  // open ?remix=<slug> (from the gallery or the Remix link in a page's badge)
  const remixSlug = params.get('remix');
  useEffect(() => {
    if (!remixSlug || openId) return;
    buildApi
      .get(remixSlug)
      .then((b) => {
        setCurrent(b);
        setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      })
      .catch(() => {
        toast('That page is not available to remix.');
        setParams({}, { replace: true });
      });
  }, [remixSlug, openId]);

  const onRemixed = async (id: string) => {
    try {
      setCurrent(await buildApi.get(id));
    } catch {
      /* the poller picks it up */
    }
    setParams({ b: id });
    loadStatus();
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  // poll while building
  useEffect(() => {
    if (!current || current.status !== 'building') return;
    const t = window.setInterval(async () => {
      try {
        const b = await buildApi.get(current.id);
        setCurrent(b);
        if (b.status !== 'building') {
          loadMine();
          loadStatus();
          if (b.status === 'failed') toast(b.error || 'The build failed.');
        }
      } catch {
        /* keep polling */
      }
    }, 1500);
    return () => clearInterval(t);
  }, [current?.id, current?.status]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (prompt.trim().length < 8) return toast('Describe what you want in a few more words.');
    setBusy(true);
    try {
      const r = await buildApi.create(prompt.trim(), format);
      const b = await buildApi.get(r.id);
      setCurrent(b);
      setParams({ b: r.id });
      loadStatus();
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const limitLine = useMemo(() => {
    if (!status) return '';
    if (!status.open) return status.reason ?? 'The builder is closed right now.';
    if (!status.limitsActive) return 'Free during launch. One build per minute, no sign-up.';
    const p = status.perUser;
    return p ? `Free. ${p.buildsLeft} of ${p.builds} builds and ${p.revisionsLeft} changes left today.` : 'Free. One build per minute.';
  }, [status]);

  const others = (mine ?? []).filter((b) => b.id !== current?.id);

  return (
    <AppShell>
      <div className="bd-page">
        <div className="wrap">
          {report && <ReportBox slug={report} onDone={() => setParams({}, { replace: true })} />}

          <header className="bd-head">
            <span className="kicker">App Builder</span>
            <h1 className="display">
              Build <em>anything.</em> Get a link.
            </h1>
            <p className="lede">Describe a page, an app or a file in your own words. It is written for you and goes live at its own link as soon as it is written, usually within a minute or two. No sign-up, no code.</p>
          </header>

          <form className="bd-composer" onSubmit={submit}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should we build? A landing page for my bakery, a habit tracker, a quiz for my class, a README for my project…"
              rows={5}
              maxLength={4000}
              aria-label="Describe what to build"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement)?.requestSubmit();
              }}
            />
            <div className="bd-comp-row">
              <div className="bd-formats" role="radiogroup" aria-label="File type">
                {FORMATS.map((f) => (
                  <button type="button" role="radio" aria-checked={format === f.id} key={f.id} className={format === f.id ? 'on' : ''} onClick={() => setFormat(f.id)}>
                    {f.label}
                  </button>
                ))}
              </div>
              <button className="btn btn-primary btn-lg" disabled={busy || !status?.open || current?.status === 'building'}>
                {busy ? <Loader2 size={17} className="spin" /> : <Sparkles size={17} />} Build it
              </button>
            </div>
            <p className="bd-limit">{limitLine}</p>
          </form>

          <div className="bd-ideas" aria-label="Ideas">
            <span>Try</span>
            {IDEAS.map((i) => (
              <button
                key={i.label}
                type="button"
                onClick={() => {
                  setPrompt(i.prompt);
                  setFormat(i.format);
                }}
              >
                {i.label}
              </button>
            ))}
          </div>

          <div ref={resultRef}>
            {current && current.status === 'building' && current.version === 0 && (
              <div className="bd-building card">
                <Progress b={current} />
              </div>
            )}
            {current && current.status === 'failed' && (
              <div className="bd-failed card">
                <b>That build didn’t work.</b>
                <p>{current.error}</p>
                {current.prompt && (
                  <button className="btn btn-quiet" onClick={() => setPrompt(current.prompt ?? '')}>
                    Put my request back
                  </button>
                )}
              </div>
            )}
            {current && current.version > 0 && current.status !== 'failed' && <Result b={current} onChange={setCurrent} status={status} onRemixed={onRemixed} />}
          </div>

          {others.length > 0 && (
            <section className="bd-mine">
              <div className="bd-mine-head">
                <h2>Your builds</h2>
                <span>Linked to this browser</span>
              </div>
              <div className="bd-grid">
                {others.map((b) => (
                  <button
                    key={b.id}
                    className="bd-tile"
                    onClick={() => {
                      setCurrent(b);
                      setParams({ b: b.id });
                      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
                    }}
                  >
                    <span className="bd-tile-ext">{b.ext}</span>
                    <b>{b.title}</b>
                    <small>
                      {b.status === 'building' ? 'Building…' : b.status === 'failed' ? 'Failed' : `v${b.version} · ${ago(b.updatedAt)}`}
                    </small>
                    <ArrowRight size={15} />
                  </button>
                ))}
              </div>
            </section>
          )}

          <Gallery onRemix={(slug) => setParams({ remix: slug })} />

          <section className="bd-how">
            <div>
              <span className="bd-no">01</span>
              <h3>Describe it</h3>
              <p>Plain words in any language. Pick a file type or let the builder decide.</p>
            </div>
            <div>
              <span className="bd-no">02</span>
              <h3>It gets built</h3>
              <p>A top model writes one complete file: a page, an app, a game or a document.</p>
            </div>
            <div>
              <span className="bd-no">03</span>
              <h3>Share the link</h3>
              <p>It goes live the moment it is written. Ask for changes anytime, or download the file.</p>
            </div>
          </section>
          <p className="bd-foot">
            Want an agent to do deeper work, like research, code reviews or videos? <Link to="/hall">Visit the Decree Hall</Link>.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
