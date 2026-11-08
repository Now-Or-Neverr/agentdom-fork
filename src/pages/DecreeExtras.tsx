// Decree page extras: downloads (.md, .docx, print to PDF), the share link and the follow-up chat.
// The .docx writer (docx + a Markdown parser) is loaded on demand so it stays out of the main bundle.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Copy, Download, FileText, Link2, Loader2, MessageCircle, Printer, Send, Share2 } from 'lucide-react';
import type { Decree } from '../../shared/types';
import type { FollowUpThread, ShareState } from '../../shared/decreeExtras';
import { Markdown } from '../components/Markdown';
import { getUid } from '../lib/api';
import { BRAND } from '../config';
import './decree.css';

export const FOOTER = `Made with ${BRAND.name} · ${BRAND.domain}`;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const uid = getUid();
  if (uid) headers['x-user'] = uid;
  if (typeof init.body === 'string') headers['content-type'] = 'application/json';
  const res = await fetch('/api' + path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

/** Read-only public view of a shared decree (no brief, notes, log or chat). */
export const fetchPublicDecree = (id: string) => call<Decree>(`/decrees/${id}/public`);
/** The decree page's first load: full decree for the owner, public view for anyone else (404 if private). */
export const fetchDecreeView = (id: string) => call<{ mode: 'owner' | 'public'; decree: Decree }>(`/decrees/${id}/view`);

const fileSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'decree';
const dateLine = (d: Decree) => new Date(d.finishedAt ?? d.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function save(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------- downloads ----------------
export function DownloadTools({ d, toast }: { d: Decree; toast: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const base = fileSlug(d.title);
  const byline = `${d.agent ? `By ${d.agent.name}` : 'By an Agentdom agent'} · ${dateLine(d)}`;

  const md = () => save(`${base}.md`, new Blob([`${d.result.trimEnd()}\n\n---\n\n${FOOTER}\n`], { type: 'text/markdown;charset=utf-8' }));

  async function docx() {
    setBusy(true);
    try {
      const { markdownToDocx } = await import('../lib/docxExport');
      save(`${base}.docx`, await markdownToDocx(d.result, { title: d.title, byline, footer: FOOTER }));
    } catch (e) {
      console.warn('[docx]', e);
      toast('Could not build the Word file. Try the .md download instead.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn btn-sm" onClick={md} title="Download the raw Markdown">
        <Download size={14} /> Download .md
      </button>
      <button className="btn btn-sm" onClick={docx} disabled={busy} title="Download as a Word document">
        {busy ? <Loader2 size={14} className="spin" /> : <FileText size={14} />} .docx
      </button>
      <button className="btn btn-sm" onClick={() => window.print()} title="Opens the print dialog; choose Save as PDF there">
        <Printer size={14} /> Print / Save as PDF
      </button>
    </>
  );
}

/** Print-only copy of the result, outside the app shell (hidden on screen, see decree.css). */
export function PrintView({ d }: { d: Decree }) {
  if (!d.result) return null;
  return createPortal(
    <div className="dp-print-root" aria-hidden>
      <h1 className="dp-print-title">{d.title}</h1>
      <p className="dp-print-meta">
        {d.agent ? `By ${d.agent.name}, ${d.agent.title}` : 'By an Agentdom agent'} · {dateLine(d)}
      </p>
      <div className="dp-print-body">
        <Markdown>{d.result}</Markdown>
      </div>
      <p className="dp-print-foot">{FOOTER}</p>
    </div>,
    document.body,
  );
}

// ---------------- share ----------------
export function ShareCard({ d, toast }: { d: Decree; toast: (m: string) => void }) {
  const [s, setS] = useState<ShareState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call<ShareState>(`/decrees/${d.id}/share`).then(setS).catch(() => setS(null));
  }, [d.id, d.status]);
  if (!s) return null;
  const url = `${window.location.origin}/decrees/${d.id}`;
  const msg = `“${d.title}”${d.agent ? ` by ${d.agent.name}` : ''} on ${BRAND.name}`;
  const canNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function set(on: boolean) {
    setBusy(true);
    try {
      setS(await call<ShareState>(`/decrees/${d.id}/share`, { method: 'POST', body: JSON.stringify({ on }) }));
      toast(on ? 'Share link is on.' : 'Share link turned off.');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const copy = () =>
    navigator.clipboard?.writeText(url).then(
      () => toast('Link copied.'),
      () => toast('Could not copy. Select the link and copy it.'),
    );

  return (
    <div className="dp-card dp-share">
      <h3 className="display dp-card-title">Share</h3>
      {!s.open ? (
        <>
          <p className="dp-share-text">
            {s.canShare
              ? 'Create a link to show this result to others. Anyone with the link can see the title, the result and its files. Your brief, revision notes, work log and follow-up chat stay private.'
              : 'You can share this decree once its result has been delivered.'}
          </p>
          {s.canShare && (
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => set(true)}>
              <Link2 size={14} /> Create share link
            </button>
          )}
        </>
      ) : (
        <>
          <p className="dp-share-text">Anyone with the link can see the title, the result and its files. Your brief, revision notes, work log and follow-up chat stay private.</p>
          <input className="field dp-share-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
          <div className="dp-share-actions">
            <button className="btn btn-sm" onClick={copy}>
              <Copy size={14} /> Copy link
            </button>
            <a className="btn btn-sm" href={`https://x.com/intent/post?text=${encodeURIComponent(msg)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer">
              Post on X
            </a>
            <a className="btn btn-sm" href={`https://wa.me/?text=${encodeURIComponent(`${msg} ${url}`)}`} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
            {canNative && (
              <button className="btn btn-sm" onClick={() => navigator.share({ title: d.title, text: msg, url }).catch(() => {})}>
                <Share2 size={14} /> Share…
              </button>
            )}
          </div>
          {s.shared && (
            <button className="btn btn-sm btn-quiet dp-share-off" disabled={busy} onClick={() => set(false)}>
              Turn off link
            </button>
          )}
          {s.portfolio && <p className="dp-share-note">This work is in the agent’s public portfolio, so the link works{s.shared ? ' even if you turn it off' : ''}.</p>}
        </>
      )}
    </div>
  );
}

/** Shown to visitors of a shared decree. */
export function MakeYourOwn() {
  return (
    <div className="dp-card dp-cta">
      <span className="dp-label">Shared from {BRAND.name}</span>
      <h3 className="display dp-card-title">Have an agent make yours</h3>
      <p className="dp-share-text">Write a short brief and an AI agent of the realm carries it out.</p>
      <Link to="/hall" className="btn btn-primary btn-sm">
        Make your own
      </Link>
    </div>
  );
}

// ---------------- follow-ups ----------------
const IDEAS = ['Continue', 'Shorten section 2', 'Give me 5 more ideas'];

export function FollowUps({ d, toast }: { d: Decree; toast: (m: string) => void }) {
  const [t, setT] = useState<FollowUpThread | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const ready = d.status === 'delivered' || d.status === 'approved';

  const load = useCallback(() => call<FollowUpThread>(`/decrees/${d.id}/followups`).then(setT), [d.id]);
  useEffect(() => {
    load().catch(() => setT(null));
  }, [load, d.status]);

  const pending = !!t?.messages.some((m) => m.status === 'pending');
  useEffect(() => {
    if (!pending) return;
    const iv = setInterval(() => load().catch(() => {}), 1000);
    return () => clearInterval(iv);
  }, [pending, load]);

  if (!t || (!ready && t.messages.length === 0)) return null;
  const max = t.maxChars;

  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      setT(await call<FollowUpThread>(`/decrees/${d.id}/followups`, { method: 'POST', body: JSON.stringify({ content }) }));
      setInput('');
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dp-fu">
      <div className="dp-fu-head">
        <span className="kicker">Follow-up</span>
        <h2 className="display dp-h2">
          Ask <em>{d.agent?.name ?? 'the agent'}</em>
        </h2>
        <p className="dp-fu-note">
          Short questions about this result. Each follow-up uses the agent’s AI; limits apply. Follow-ups do not change the decree or its review.
        </p>
      </div>

      {t.messages.length > 0 && (
        <ol className="dp-fu-thread">
          {t.messages.map((m) => (
            <li key={m.id} className={'dp-fu-msg ' + m.role + (m.status === 'failed' ? ' failed' : '')}>
              <span className="dp-label">{m.role === 'user' ? 'You' : d.agent?.name ?? 'Agent'}</span>
              {m.role === 'user' ? (
                <p className="dp-fu-text">{m.content}</p>
              ) : m.status === 'failed' ? (
                <>
                  {m.content && <Markdown>{m.content}</Markdown>}
                  <p className="dp-fu-err">{m.error ?? 'The answer failed.'} This one does not count toward your limits.</p>
                </>
              ) : (
                <div className={m.status === 'pending' ? 'caret' : ''}>
                  {m.content ? <Markdown>{m.content}</Markdown> : <p className="dp-fu-wait">Thinking…</p>}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      <div ref={endRef} />

      {ready && (
        <div className="dp-fu-form">
          {t.messages.length === 0 && (
            <div className="dp-fu-ideas">
              {IDEAS.map((x) => (
                <button key={x} type="button" className="btn btn-sm btn-quiet" onClick={() => setInput(x)}>
                  {x}
                </button>
              ))}
            </div>
          )}
          <textarea
            className="field dp-fu-input"
            placeholder={t.open ? 'Ask a follow-up, e.g. “Make the intro shorter”' : (t.reason ?? 'Follow-ups are closed.')}
            value={input}
            maxLength={max}
            disabled={!t.open || busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void send();
              }
            }}
            aria-label="Follow-up question"
          />
          <div className="dp-fu-bar">
            <span className="dp-fu-count mono">
              {t.usedDecree}/{t.perDecree} on this decree · {t.usedToday}/{t.perUser} today{input.length > max * 0.8 ? ` · ${input.length}/${max}` : ''}
            </span>
            <button className="btn btn-sm btn-primary" disabled={!t.open || busy || !input.trim()} onClick={send}>
              {busy || pending ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Send
            </button>
          </div>
          {!t.open && t.reason && !pending && (
            <p className="dp-fu-reason">
              <MessageCircle size={13} /> {t.reason}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
