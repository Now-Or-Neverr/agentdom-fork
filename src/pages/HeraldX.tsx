// X panel on /admin/herald: connect the realm's X account and write X drafts.
// The server only accepts the account named in X_HANDLE, so connecting while logged in to X as
// anyone else is refused and nothing is saved.
import { useEffect, useMemo, useState } from 'react';
import { Link2, Loader2, Send, Unlink } from 'lucide-react';
import { herald, type XInfo } from '../lib/mediaApi';

/** Same weighting as the server (links 23, CJK and emoji 2). */
function xLength(text: string): number {
  let n = 0;
  const rest = text.replace(/https?:\/\/\S+/gi, () => {
    n += 23;
    return '';
  });
  for (const ch of rest) {
    const c = ch.codePointAt(0)!;
    n += c <= 4351 || (c >= 8192 && c <= 8205) || (c >= 8208 && c <= 8223) || (c >= 8242 && c <= 8247) ? 1 : 2;
  }
  return n;
}

export function XPanel({ adminKey, info, onChange, onError }: { adminKey: string; info: XInfo; onChange: () => void; onError: (m: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [image, setImage] = useState('');
  const [alt, setAlt] = useState('');
  const [at, setAt] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const len = useMemo(() => xLength(text.trim()), [text]);

  // Result of the X redirect back to this page.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('x');
    if (!r) return;
    if (r === 'connected') setNote(`Connected @${p.get('user')}. Posts will go out from this account.`);
    else onError(p.get('msg') || 'X connect failed.');
    window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    setBusy(true);
    onError(null);
    try {
      window.location.href = (await herald.xConnect(adminKey)).url;
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  };
  const disconnect = async () => {
    if (!window.confirm(`Disconnect @${info.username}? Nothing will post to X until you connect again.`)) return;
    setBusy(true);
    try {
      await herald.xDisconnect(adminKey);
      setNote(null);
      onChange();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const queue = async () => {
    setBusy(true);
    onError(null);
    try {
      await herald.queue(adminKey, {
        text,
        network: 'x',
        image: image.trim() || undefined,
        alt: alt.trim() || undefined,
        scheduledAt: at ? new Date(at).toISOString() : undefined,
      });
      setText('');
      setImage('');
      setAlt('');
      setAt('');
      setNote(at ? (info.autopost ? 'Draft queued. It will post at its scheduled time.' : 'Draft queued with a time. Auto-post is off, so approve it below when you want it out.') : 'Draft queued. Approve it below to post.');
      onChange();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ws-panel hq-post">
      <header>
        <h3>X · @{info.allowedHandle}</h3>
        <p>
          {!info.configured
            ? 'X is not configured on this server (X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI).'
            : info.connected
              ? `Connected as @${info.username}. ${info.postedToday}/${info.dailyLimit} posts today. Auto-post is ${info.autopost ? 'ON: admin drafts with a time post by themselves' : 'OFF: every post needs Approve'}.`
              : `Not connected. Log in to X as @${info.allowedHandle} in this browser first, then press Connect X. Any other account is refused.`}
        </p>
      </header>
      {note && <div className="ws-muted">{note}</div>}
      {info.configured && (
        <div className="ws-row ws-wrap">
          {info.connected ? (
            <button className="btn btn-quiet btn-sm" disabled={busy} onClick={disconnect}>
              <Unlink size={13} /> Disconnect
            </button>
          ) : (
            <button className="btn btn-seal btn-sm" disabled={busy} onClick={connect}>
              {busy ? <Loader2 size={13} className="ws-spin" /> : <Link2 size={13} />} Connect X
            </button>
          )}
        </div>
      )}
      {info.connected && (
        <form
          className="hq-compose"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() && len <= info.maxChars) queue();
          }}
        >
          <textarea className="field" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write an X post" />
          <div className="ws-row ws-wrap">
            <span className="ws-muted" style={{ color: len > info.maxChars ? 'var(--bad)' : undefined }}>
              {len}/{info.maxChars}
            </span>
            <input className="field ws-grow" value={image} onChange={(e) => setImage(e.target.value)} placeholder="Image /uploads/… (optional)" />
            {image.trim() && <input className="field ws-grow" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Alt text" />}
            <input className="field" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} title="Post at (optional)" />
            <button className="btn btn-ink btn-sm" disabled={busy || !text.trim() || len > info.maxChars}>
              <Send size={13} /> Queue draft
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
