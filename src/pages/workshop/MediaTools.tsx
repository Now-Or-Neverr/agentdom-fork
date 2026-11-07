// Media workshop tools: Cloudflare Workers AI (images, narration, transcription, translation,
// alt text), Pixabay (stock photos and clips), Freesound (CC0 / CC BY music and effects),
// remove.bg (cut-outs) and local ffmpeg films. Every result is a real file or a real answer from
// our server, with its source and attribution. Expensive tools never run on page load.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Clapperboard, Download, Image as ImageIcon, Languages, Mic, Music, Scissors, Search, Square, Type, Volume2, X } from 'lucide-react';
import { media, type MediaStatus, type ToolQuota } from '../../lib/mediaApi';
import { Err, Ext, Panel, Source, Status, useRun } from './shared';
import './media.css';

// ---------------- session media bin (what you made or fetched on this page) ----------------
export type BinKind = 'image' | 'video' | 'narration' | 'music';
export interface BinItem {
  url: string;
  kind: BinKind;
  label: string;
  credit?: string; // "Name · License" for attribution
  creditUrl?: string;
}
const BIN_KEY = 'agentdom.mediaBin';
let bin: BinItem[] = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(BIN_KEY) ?? '[]') as BinItem[];
  } catch {
    return [];
  }
})();
const subs = new Set<() => void>();
function setBin(next: BinItem[]) {
  bin = next.slice(-24);
  try {
    sessionStorage.setItem(BIN_KEY, JSON.stringify(bin));
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f());
}
const addToBin = (x: BinItem) => setBin([...bin.filter((b) => b.url !== x.url), x]);
function useBin() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => bin,
  );
}

// ---------------- small bits ----------------
const Left = ({ q, what }: { q?: ToolQuota; what: string }) => (q ? <span className="ws-muted">{`${q.left} of ${q.limit} ${what} left today`}</span> : null);
function Credit({ author, authorUrl, pageUrl, license, licenseUrl, site }: { author: string; authorUrl: string; pageUrl: string; license: string; licenseUrl: string; site: string }) {
  return (
    <div className="mt-credit">
      <Ext href={pageUrl}>{site}</Ext> by <Ext href={authorUrl}>{author}</Ext> · <Ext href={licenseUrl}>{license}</Ext>
    </div>
  );
}
function useMediaStatus() {
  const [s, set] = useState<MediaStatus | null>(null);
  const reload = () => media.status().then(set, () => set(null));
  useEffect(() => {
    reload();
  }, []);
  return [s, reload] as const;
}
function Budget({ s }: { s: MediaStatus | null }) {
  if (!s) return null;
  return (
    <p className="ws-muted mt-budget">
      Cloudflare free allowance today: about {s.cloudflare.left.toLocaleString()} of {s.cloudflare.budget.toLocaleString()} neurons left (our own estimate; resets 00:00 UTC).
    </p>
  );
}

/** Pick an /uploads file: from the bin, or upload one from this device. */
function Picker({ kinds, accept, uploadKind, value, onPick, label }: { kinds: BinKind[]; accept: string; uploadKind: 'image' | 'audio'; value: string; onPick: (url: string) => void; label: string }) {
  const items = useBin().filter((b) => kinds.includes(b.kind));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mt-picker">
      <div className="ws-row ws-wrap">
        <select className="field ws-grow" value={value} onChange={(e) => onPick(e.target.value)} aria-label={label}>
          <option value="">{items.length ? `Choose ${label.toLowerCase()}…` : `No ${label.toLowerCase()} yet: upload one`}</option>
          {items.map((b) => (
            <option key={b.url} value={b.url}>
              {b.label}
            </option>
          ))}
        </select>
        <label className="btn btn-quiet btn-sm mt-file">
          {busy ? 'Uploading…' : 'Upload'}
          <input
            type="file"
            accept={accept}
            hidden
            disabled={busy}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setBusy(true);
              setErr(null);
              try {
                const r = await media.upload(f, uploadKind);
                const kind: BinKind = uploadKind === 'image' ? 'image' : kinds.includes('music') && !kinds.includes('narration') ? 'music' : 'narration';
                addToBin({ url: r.url, kind, label: `Uploaded: ${f.name.slice(0, 40)}` });
                onPick(r.url);
              } catch (x) {
                setErr((x as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      </div>
      {err && <Err msg={err} />}
    </div>
  );
}

// ======================================================================================
// Atelier
// ======================================================================================
export function StudioImageTool() {
  const [prompt, setPrompt] = useState('');
  const [st, reload] = useMediaStatus();
  const [s, run] = useRun<Awaited<ReturnType<typeof media.image>>>();
  return (
    <Panel title="Studio painter" sub="FLUX.1 schnell on Cloudflare Workers AI paints a 1024×1024 image from your words. The file is saved on our server.">
      <textarea className="field ws-short" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={600} placeholder="e.g. A lantern-lit theatre stage in ink and gold, wide shot" />
      <div className="ws-row ws-wrap">
        <Left q={s.data?.quota ?? st?.tools.image} what="images" />
        <button
          className="btn btn-seal ws-push"
          disabled={s.loading || !prompt.trim()}
          onClick={() =>
            run(
              media.image(prompt.trim()).then((r) => {
                addToBin({ url: r.url, kind: 'image', label: `Painted: ${r.prompt.slice(0, 40)}`, credit: 'Generated with FLUX.1 schnell (Cloudflare Workers AI)' });
                reload();
                return r;
              }),
            )
          }
        >
          <ImageIcon size={15} /> Paint
        </button>
      </div>
      <Budget s={st} />
      <Status s={s} label="Painting (a few seconds)…">
        {(d) => (
          <figure className="ws-figure">
            <img src={d.url} alt={d.prompt} />
            <figcaption>
              {d.prompt} · {Math.round(d.bytes / 1024)} KB {d.type.toUpperCase()} · ~{d.neurons} neurons ·{' '}
              <a href={d.url} download>
                Download
              </a>
            </figcaption>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </figure>
        )}
      </Status>
    </Panel>
  );
}

export function StockMediaTool() {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'image' | 'video'>('image');
  const [imgs, runImgs] = useRun<Awaited<ReturnType<typeof media.pixabayImages>>>();
  const [vids, runVids] = useRun<Awaited<ReturnType<typeof media.pixabayVideos>>>();
  const [dl, runDl] = useRun<Awaited<ReturnType<typeof media.pixabayDownload>>>();
  const go = () => (kind === 'image' ? runImgs(media.pixabayImages(q.trim())) : runVids(media.pixabayVideos(q.trim())));
  const take = (id: number) =>
    runDl(
      media.pixabayDownload(id, kind).then((r) => {
        addToBin({ url: r.url, kind: r.kind, label: `Pixabay ${r.kind} #${r.id} by ${r.author}`, credit: `${r.author} · Pixabay`, creditUrl: r.pageUrl });
        return r;
      }),
    );
  return (
    <Panel title="Stock library" sub="Free photos and video clips from Pixabay. Anything you use is copied to our server first, with the author credited.">
      <form
        className="ws-row ws-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) go();
        }}
      >
        <input className="field ws-grow" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} placeholder="e.g. castle, harbour at night" />
        <select className="field mt-narrow" value={kind} onChange={(e) => setKind(e.target.value as 'image' | 'video')} aria-label="Media type">
          <option value="image">Photos</option>
          <option value="video">Video clips</option>
        </select>
        <button className="btn btn-seal" disabled={!q.trim() || imgs.loading || vids.loading}>
          <Search size={15} /> Search
        </button>
      </form>
      {kind === 'image' ? (
        <Status s={imgs} label="Searching Pixabay…">
          {(d) => (
            <>
              <div className="ws-muted">{d.total.toLocaleString()} photos</div>
              <div className="mt-grid">
                {d.results.map((r) => (
                  <div key={r.id} className="mt-tile">
                    <img src={r.previewUrl} alt={r.tags.join(', ')} loading="lazy" />
                    <div className="mt-tile-foot">
                      <Ext href={r.pageUrl}>{r.author}</Ext>
                      <button className="btn btn-quiet btn-sm" disabled={dl.loading} onClick={() => take(r.id)} title="Copy to our server and add to your media bin">
                        <Download size={13} /> Use
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
            </>
          )}
        </Status>
      ) : (
        <Status s={vids} label="Searching Pixabay…">
          {(d) => (
            <>
              <div className="ws-muted">{d.total.toLocaleString()} clips</div>
              <div className="mt-grid">
                {d.results.map((r) => (
                  <div key={r.id} className="mt-tile">
                    {r.thumbnail ? <img src={r.thumbnail} alt={r.tags.join(', ')} loading="lazy" /> : <div className="mt-ph">{r.tags[0]}</div>}
                    <div className="mt-tile-foot">
                      <span className="ws-muted">{r.durationSec}s</span>
                      <Ext href={r.pageUrl}>{r.author}</Ext>
                      <button className="btn btn-quiet btn-sm" disabled={dl.loading} onClick={() => take(r.id)}>
                        <Download size={13} /> Use
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
            </>
          )}
        </Status>
      )}
      <Status s={dl} label="Copying the file to our server…">
        {(d) => (
          <div className="ws-card">
            <b>Added to your media bin:</b> {d.kind} {d.width}×{d.height}
            {d.durationSec ? ` · ${d.durationSec}s` : ''} · {Math.round(d.bytes / 1024)} KB
            <Credit author={d.author} authorUrl={d.authorUrl} pageUrl={d.pageUrl} license={d.license} licenseUrl={d.licenseUrl} site="Pixabay" />
          </div>
        )}
      </Status>
    </Panel>
  );
}

export function ImageHelpersTool() {
  const [img, setImg] = useState('');
  const [st, reload] = useMediaStatus();
  const [alt, runAlt] = useRun<Awaited<ReturnType<typeof media.alt>>>();
  const [cut, runCut] = useRun<Awaited<ReturnType<typeof media.cutout>>>();
  return (
    <Panel title="Alt text & cut-outs" sub="Describe an image for screen readers (Llama 4 Scout vision on Cloudflare), or remove its background with remove.bg.">
      <Picker kinds={['image']} accept="image/png,image/jpeg,image/webp" uploadKind="image" value={img} onPick={setImg} label="An image" />
      {img && <img className="mt-thumb" src={img} alt="" />}
      <div className="ws-row ws-wrap">
        <button className="btn btn-seal" disabled={!img || alt.loading} onClick={() => runAlt(media.alt(img))}>
          <Type size={15} /> Write alt text
        </button>
        <button
          className="btn btn-seal"
          disabled={!img || cut.loading || (st?.removebg.left ?? 1) <= 0}
          onClick={() =>
            runCut(
              media.cutout(img).then((r) => {
                addToBin({ url: r.url, kind: 'image', label: 'Cut-out (transparent PNG)' });
                reload();
                return r;
              }),
            )
          }
        >
          <Scissors size={15} /> Remove background
        </button>
        {st && <span className="ws-muted">{st.removebg.left} cut-outs left for you today (the realm shares {st.removebg.monthly} a month)</span>}
      </div>
      <Status s={alt} label="Looking at the image…">
        {(d) => (
          <div className="ws-card">
            <p className="mt-alt">{d.alt}</p>
            <button className="btn btn-quiet btn-sm" onClick={() => navigator.clipboard?.writeText(d.alt)}>
              Copy
            </button>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </div>
        )}
      </Status>
      <Status s={cut} label="remove.bg is cutting it out…">
        {(d) => (
          <figure className="ws-figure">
            <img className="mt-checker" src={d.url} alt="Cut-out with transparent background" />
            <figcaption>
              {d.width}×{d.height} transparent PNG ·{' '}
              <a href={d.url} download>
                Download
              </a>
            </figcaption>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </figure>
        )}
      </Status>
    </Panel>
  );
}

/** Everything for the Atelier tab. */
export function AtelierMediaTools() {
  return (
    <>
      <StudioImageTool />
      <StockMediaTool />
      <ImageHelpersTool />
    </>
  );
}

// ======================================================================================
// Lantern Theatre
// ======================================================================================
const LANGS: [string, string][] = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['zh', 'Chinese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['id', 'Indonesian'],
];
export function NarrationTool() {
  const [text, setText] = useState('');
  const [lang, setLang] = useState('en');
  const [s, run] = useRun<Awaited<ReturnType<typeof media.speak>>>();
  return (
    <Panel title="Narrator" sub="MeloTTS on Cloudflare Workers AI reads your script aloud. The voice track is saved for your film.">
      <textarea className="field ws-short" value={text} onChange={(e) => setText(e.target.value)} maxLength={1500} placeholder="Write the narration (up to 1,500 characters)…" />
      <div className="ws-row ws-wrap">
        <select className="field mt-narrow" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
          {LANGS.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <span className="ws-muted ws-grow">{text.length} / 1500</span>
        <button
          className="btn btn-seal"
          disabled={!text.trim() || s.loading}
          onClick={() =>
            run(
              media.speak(text.trim(), lang).then((r) => {
                addToBin({ url: r.url, kind: 'narration', label: `Narration: ${r.text.slice(0, 36)}…`, credit: 'Voice: MeloTTS (Cloudflare Workers AI)' });
                return r;
              }),
            )
          }
        >
          <Volume2 size={15} /> Read aloud
        </button>
      </div>
      <Status s={s} label="Recording the narrator…">
        {(d) => (
          <div className="ws-card">
            <audio controls src={d.url} className="mt-audio" />
            <div className="ws-muted">
              {d.durationSec}s · {Math.round(d.bytes / 1024)} KB {d.type.toUpperCase()} · <Left q={d.quota} what="narrations" />
            </div>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </div>
        )}
      </Status>
    </Panel>
  );
}

export function SoundLibraryTool() {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'music' | 'sfx'>('music');
  const [s, run] = useRun<Awaited<ReturnType<typeof media.sounds>>>();
  const [dl, runDl] = useRun<Awaited<ReturnType<typeof media.soundDownload>>>();
  return (
    <Panel title="Sound library" sub="Music beds and sound effects from Freesound, only CC0 or CC BY. The author and license travel with the file.">
      <form
        className="ws-row ws-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) run(media.sounds(q.trim(), kind));
        }}
      >
        <input className="field ws-grow" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} placeholder="e.g. medieval lute, rain, crowd cheer" />
        <select className="field mt-narrow" value={kind} onChange={(e) => setKind(e.target.value as 'music' | 'sfx')} aria-label="Sound type">
          <option value="music">Music</option>
          <option value="sfx">Effects</option>
        </select>
        <button className="btn btn-seal" disabled={!q.trim() || s.loading}>
          <Search size={15} /> Search
        </button>
      </form>
      <Status s={s} label="Searching Freesound…">
        {(d) => (
          <>
            <div className="ws-muted">{d.total.toLocaleString()} sounds</div>
            <ul className="ws-list">
              {d.results.length === 0 && <li className="ws-muted">Nothing found with a CC0 or CC BY license.</li>}
              {d.results.map((r) => (
                <li key={r.id} className="mt-sound">
                  <div>
                    <Ext href={r.pageUrl}>{r.name}</Ext>
                    <div className="ws-muted">
                      {r.author} · {r.license} · {r.durationSec}s
                    </div>
                  </div>
                  <audio controls preload="none" src={r.previewUrl} className="mt-audio" />
                  <button
                    className="btn btn-quiet btn-sm"
                    disabled={dl.loading}
                    onClick={() =>
                      runDl(
                        media.soundDownload(r.id).then((x) => {
                          addToBin({ url: x.url, kind: 'music', label: `${x.name.slice(0, 40)} (${x.author})`, credit: `${x.author} · ${x.license} · Freesound`, creditUrl: x.pageUrl });
                          return x;
                        }),
                      )
                    }
                  >
                    <Download size={13} /> Use
                  </button>
                </li>
              ))}
            </ul>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </>
        )}
      </Status>
      <Status s={dl} label="Copying the sound to our server…">
        {(d) => (
          <div className="ws-card">
            <b>Added to your media bin:</b> {d.name}
            <Credit author={d.author} authorUrl={d.authorUrl} pageUrl={d.pageUrl} license={d.license} licenseUrl={d.licenseUrl} site="Freesound" />
            {d.needsCredit && <div className="ws-muted">This license requires crediting the author wherever you use it.</div>}
          </div>
        )}
      </Status>
    </Panel>
  );
}

/** Record from the microphone (or upload audio) and transcribe it with Whisper. */
export function VoiceToTextTool({ onText }: { onText?: (text: string) => void }) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [secs, setSecs] = useState(0);
  const [audio, setAudio] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [s, run] = useRun<Awaited<ReturnType<typeof media.transcribe>>>();
  const timer = useRef<number | null>(null);
  const stopTimer = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stopTimer, []);
  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        stopTimer();
        setRec(null);
        try {
          const up = await media.upload(new Blob(chunks, { type: r.mimeType || 'audio/webm' }), 'audio');
          setAudio(up.url);
          run(media.transcribe(up.url).then((x) => (onText?.(x.text), x)));
        } catch (x) {
          setErr((x as Error).message);
        }
      };
      r.start();
      setRec(r);
      setSecs(0);
      timer.current = window.setInterval(() => setSecs((n) => (n >= 119 ? (r.state === 'recording' && r.stop(), n) : n + 1)), 1000);
    } catch {
      setErr('Microphone not available (permission denied or no device).');
    }
  };
  return (
    <Panel title="Voice to text" sub="Speak a decree or a script; Whisper (large-v3-turbo) on Cloudflare Workers AI writes it down. Up to 2 minutes.">
      <div className="ws-row ws-wrap">
        {rec ? (
          <button className="btn btn-seal" onClick={() => rec.stop()}>
            <Square size={15} /> Stop ({secs}s)
          </button>
        ) : (
          <button className="btn btn-seal" disabled={s.loading} onClick={start}>
            <Mic size={15} /> Record
          </button>
        )}
        <span className="ws-muted">or</span>
        <div className="ws-grow">
          <Picker kinds={['narration']} accept="audio/*" uploadKind="audio" value={audio} onPick={(u) => setAudio(u)} label="Audio" />
        </div>
        <button className="btn btn-quiet" disabled={!audio || s.loading || Boolean(rec)} onClick={() => run(media.transcribe(audio).then((x) => (onText?.(x.text), x)))}>
          Transcribe
        </button>
      </div>
      {err && <Err msg={err} />}
      <Status s={s} label="Listening…">
        {(d) => (
          <div className="ws-card">
            <p className="mt-alt">{d.text || '(no speech detected)'}</p>
            <div className="ws-muted">
              {d.durationSec}s{d.language ? ` · language: ${d.language}` : ''} · <Left q={d.quota} what="transcriptions" />
            </div>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </div>
        )}
      </Status>
    </Panel>
  );
}

export function FilmTool() {
  const items = useBin();
  const visual = items.filter((b) => b.kind === 'image' || b.kind === 'video');
  const [scenes, setScenes] = useState<{ url: string; caption: string }[]>([]);
  const [narration, setNarration] = useState('');
  const [music, setMusic] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof media.film>>>();
  const kindOf = (u: string) => items.find((b) => b.url === u)?.kind;
  // Clips play first, then images (the server orders them that way too).
  const ordered = [...scenes.filter((x) => kindOf(x.url) === 'video'), ...scenes.filter((x) => kindOf(x.url) !== 'video')];
  const credits = [...new Set([...ordered.map((x) => x.url), narration, music].map((u) => items.find((b) => b.url === u)?.credit).filter(Boolean) as string[])];
  return (
    <Panel title="Film cutter" sub="Real footage and stills, a narrator and a music bed that ducks under the voice, cut into an H.264/AAC mp4 on our server.">
      {visual.length === 0 ? (
        <p className="ws-muted">Your media bin is empty. Paint an image or take clips and photos from the stock library first (Atelier tab), and record a narration above.</p>
      ) : (
        <div className="mt-bin">
          {visual.map((b) => {
            const on = scenes.some((x) => x.url === b.url);
            return (
              <button
                key={b.url}
                className={'mt-bin-item' + (on ? ' on' : '')}
                onClick={() => setScenes(on ? scenes.filter((x) => x.url !== b.url) : scenes.length < 12 ? [...scenes, { url: b.url, caption: '' }] : scenes)}
                title={b.label}
              >
                {b.kind === 'video' ? <video src={b.url} muted preload="metadata" /> : <img src={b.url} alt={b.label} />}
                <span>{b.kind === 'video' ? 'Clip' : 'Still'}</span>
              </button>
            );
          })}
        </div>
      )}
      {ordered.length > 0 && (
        <ol className="mt-scenes">
          {ordered.map((x, i) => (
            <li key={x.url}>
              <span className="ws-muted">
                {i + 1}. {kindOf(x.url) === 'video' ? 'Clip' : 'Still'}
              </span>
              <input
                className="field ws-grow"
                value={x.caption}
                maxLength={160}
                placeholder="Caption (optional subtitle)"
                onChange={(e) => setScenes(scenes.map((y) => (y.url === x.url ? { ...y, caption: e.target.value } : y)))}
              />
              <button className="btn btn-quiet btn-sm" aria-label="Remove scene" onClick={() => setScenes(scenes.filter((y) => y.url !== x.url))}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="ws-grid2">
        <div>
          <h4 className="ws-h4">Narration</h4>
          <Picker kinds={['narration']} accept="audio/*" uploadKind="audio" value={narration} onPick={setNarration} label="Narration" />
        </div>
        <div>
          <h4 className="ws-h4">
            <Music size={14} /> Music bed
          </h4>
          <Picker kinds={['music']} accept="audio/mpeg,audio/ogg,audio/wav" uploadKind="audio" value={music} onPick={setMusic} label="Music" />
        </div>
      </div>
      <div className="ws-row ws-wrap">
        <span className="ws-muted ws-grow">{ordered.length} of 12 scenes</span>
        <button
          className="btn btn-seal"
          disabled={!ordered.length || s.loading}
          onClick={() =>
            run(
              media.film({
                clips: ordered.filter((x) => kindOf(x.url) === 'video').map((x) => x.url),
                images: ordered.filter((x) => kindOf(x.url) !== 'video').map((x) => x.url),
                captions: ordered.map((x) => x.caption),
                narration: narration || null,
                music: music || null,
              }),
            )
          }
        >
          <Clapperboard size={15} /> Cut the film
        </button>
      </div>
      <Status s={s} label="ffmpeg is cutting your film (usually under a minute)…">
        {(d) => (
          <figure className="ws-figure">
            <video controls src={d.url} className="mt-video" />
            <figcaption>
              {d.durationSec}s · {d.width}×{d.height} · video {d.streams.video}, audio {d.streams.audio} · {(d.bytes / 1024 / 1024).toFixed(1)} MB
              {d.subtitles ? ' · subtitles' : ''} ·{' '}
              <a href={d.url} download>
                Download mp4
              </a>
            </figcaption>
            {credits.length > 0 && <div className="mt-credit">Credits: {credits.join(' · ')}</div>}
          </figure>
        )}
      </Status>
    </Panel>
  );
}

/** Everything for the Lantern Theatre tab. */
export function TheatreMediaTools() {
  return (
    <>
      <NarrationTool />
      <SoundLibraryTool />
      <FilmTool />
      <VoiceToTextTool />
    </>
  );
}

// ======================================================================================
// Scriptorium
// ======================================================================================
const TARGETS: [string, string][] = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['ja', 'Japanese'],
  ['zh', 'Chinese'],
  ['ar', 'Arabic'],
  ['hi', 'Hindi'],
  ['ru', 'Russian'],
  ['ko', 'Korean'],
  ['id', 'Indonesian'],
];
export function TranslateTool() {
  const [text, setText] = useState('');
  const [source, setSource] = useState('en');
  const [target, setTarget] = useState('es');
  const [s, run] = useRun<Awaited<ReturnType<typeof media.translate>>>();
  const opts = (v: string, set: (x: string) => void, label: string) => (
    <select className="field mt-narrow" value={v} onChange={(e) => set(e.target.value)} aria-label={label}>
      {TARGETS.map(([k, n]) => (
        <option key={k} value={k}>
          {n}
        </option>
      ))}
    </select>
  );
  return (
    <Panel title="Translator" sub="Meta's M2M100 (1.2B) on Cloudflare Workers AI translates between 100 languages. Machine translation: check anything important.">
      <textarea className="field ws-short" value={text} onChange={(e) => setText(e.target.value)} maxLength={3000} placeholder="Text to translate (up to 3,000 characters)…" />
      <div className="ws-row ws-wrap">
        {opts(source, setSource, 'From')}
        <span className="ws-muted">→</span>
        {opts(target, setTarget, 'To')}
        <button className="btn btn-seal ws-push" disabled={!text.trim() || s.loading || source === target} onClick={() => run(media.translate(text.trim(), target, source))}>
          <Languages size={15} /> Translate
        </button>
      </div>
      <Status s={s} label="Translating…">
        {(d) => (
          <div className="ws-card">
            <p className="mt-alt">{d.translated}</p>
            <div className="ws-muted">
              {d.source} → {d.target} · <Left q={d.quota} what="translations" />
            </div>
            <Source name={d.name} url={d.sourceUrl} at={d.fetchedAt} />
          </div>
        )}
      </Status>
    </Panel>
  );
}

// ======================================================================================
// Forge
// ======================================================================================
export function SiteStatusTool() {
  const [slug, setSlug] = useState('');
  const [s, run] = useRun<Awaited<ReturnType<typeof media.site>>>();
  return (
    <Panel title="Published sites" sub="Forge smiths publish finished websites to GitHub Pages. Check whether a site is live: we load its public address right now.">
      <form
        className="ws-row ws-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          if (slug.trim()) run(media.site(slug.trim().toLowerCase()));
        }}
      >
        <input className="field ws-grow" value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={48} placeholder="Site name, e.g. bakery-landing" />
        <button className="btn btn-seal" disabled={!slug.trim() || s.loading}>
          <Search size={15} /> Check
        </button>
      </form>
      <Status s={s} label="Loading the public page…">
        {(d) => (
          <div className="ws-card">
            <b>{d.status === 'live' ? 'Live' : 'Not live yet'}</b> · <Ext href={d.url}>{d.url}</Ext>
            <div className="ws-muted">{d.status === 'live' ? 'The page answered with HTTP 200.' : 'The page is not served yet (new sites take a minute or two to deploy).'}</div>
          </div>
        )}
      </Status>
    </Panel>
  );
}

export function MediaBinNote(): ReactNode {
  const items = useBin();
  if (!items.length) return null;
  return (
    <p className="ws-muted">
      Media bin: {items.length} file{items.length === 1 ? '' : 's'} from this session.{' '}
      <button className="btn btn-quiet btn-sm" onClick={() => setBin([])}>
        Clear
      </button>
    </p>
  );
}
