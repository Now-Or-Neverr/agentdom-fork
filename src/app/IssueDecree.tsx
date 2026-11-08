import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Crown, Lock, Mic, Square, X } from 'lucide-react';
import type { AgentLite, Commission, RealmStatus } from '../../shared/types';
import { GUILDS, PROVINCE, type ProvinceId } from '../../shared/realm';
import { Figure } from '../components/Character';
import { api, fmt } from '../lib/api';
import { useApp } from '../lib/store';
import { AgentPortrait } from './parts';
import { BRAND } from '../config';
import { FreeTag } from '../components/Free';
import { media } from '../lib/mediaApi';
import { schedulesApi } from '../lib/courtApi2';
import { CadencePicker, defaultCadence, type CadenceValue } from '../pages/Schedules';
import '../pages/schedules.css';

export interface IssuePreset {
  commission?: Commission;
  agent?: AgentLite;
  province?: ProvinceId;
  title?: string;
}

export function IssueDecree({ preset, onClose }: { preset: IssuePreset; onClose: () => void }) {
  const nav = useNavigate();
  const { user, crowns, refresh, toast } = useApp();
  const c = preset.commission;
  const agent = preset.agent ?? c?.agent;
  const toVizier = !c && !preset.agent;
  const [title, setTitle] = useState(preset.title ?? '');
  const [brief, setBrief] = useState('');
  const [price, setPrice] = useState(c?.price ?? 40);
  const [province, setProvince] = useState<ProvinceId | ''>(preset.province && preset.province !== 'throne' ? preset.province : '');
  const [isPublic, setPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<RealmStatus | null>(null);
  const [standing, setStanding] = useState(false);
  const [cad, setCad] = useState<CadenceValue>(defaultCadence);

  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const d = await api.issue({
        title,
        brief,
        price,
        commissionId: c?.id,
        agentId: c ? undefined : preset.agent?.id,
        province: toVizier && province ? province : undefined,
        isPublic,
      });
      if (standing) {
        try {
          await schedulesApi.create({ decreeId: d.id, cadence: cad.cadence, weekday: cad.weekday, hour: cad.hour });
          toast('Decree sealed and saved as a standing decree. It will repeat on schedule.');
        } catch (x) {
          toast(`Decree sealed, but the standing decree was not saved: ${(x as Error).message}`);
        }
      }
      await refresh();
      if (!standing)
        toast(crowns ? `Decree sealed for ${d.agent?.name ?? 'an agent'}. ${fmt(d.price)} ${BRAND.currencyShort} locked in the Royal Vault.` : `Decree sealed for ${d.agent?.name ?? 'an agent'}. It is free during launch.`);
      nav(`/decrees/${d.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const left = status?.usedToday != null ? Math.max(0, status.dailyLimitPerUser - status.usedToday) : null;

  return (
    <div className="overlay" onClick={onClose}>
      <form className="sheet sd-sheet isd" onClick={(e) => e.stopPropagation()} onSubmit={submit} aria-label="Issue a decree">
        <div className="sd-sheet-head">
          {toVizier ? (
            <span className="sd-figure">
              <Figure role="vizier" size={70} color={PROVINCE.throne.color} />
            </span>
          ) : (
            agent && <AgentPortrait a={agent} size={52} />
          )}
          <div className="sd-sheet-title">
            <div className="kicker">New decree</div>
            <div className="display sd-h">
              {toVizier ? 'To the Grand Vizier' : `For ${agent?.name}`}
            </div>
          </div>
          <button type="button" className="btn btn-icon btn-sm sd-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {toVizier && (
          <p className="sd-intro">
            The Grand Vizier reads your decree and hands it to the best-suited agent. You can also limit it to one guild.
          </p>
        )}
        {c && (
          <div className="isd-commission" style={{ ['--g' as string]: PROVINCE[c.province].color }}>
            <div className="isd-commission-craft">{PROVINCE[c.province].craft.toUpperCase()}</div>
            <div className="isd-commission-title">{c.title}</div>
          </div>
        )}

        {status && !status.aiEnabled && (
          <div className="isd-warn">
            <AlertTriangle size={17} />
            <span>
              Preview mode: the realm’s AI is not connected yet, so your decree will <b>wait in the queue</b>. You can cancel it any time for a full refund.
            </span>
          </div>
        )}

        <div className="isd-fields">
          {toVizier && (
            <div>
              <label className="label" htmlFor="guild">
                Guild (optional)
              </label>
              <select id="guild" className="field" value={province} onChange={(e) => setProvince(e.target.value as ProvinceId | '')}>
                <option value="">Let the Grand Vizier choose</option>
                {GUILDS.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} — {g.craft}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label" htmlFor="dtitle">
              Title
            </label>
            <input id="dtitle" className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. A logo for my tea house" maxLength={140} required />
          </div>
          <div>
            <label className="label" htmlFor="dbrief">
              The decree
            </label>
            <textarea
              id="dbrief"
              className="field"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={c?.sampleBrief || 'Describe what you need, who it is for, and what a great result looks like.'}
              maxLength={6000}
              required
            />
            <VoiceDecree onText={(t) => setBrief((b) => (b.trim() ? b.trimEnd() + '\n' + t : t))} />
          </div>
          <div className="isd-pair">
            <div>
              <label className="label" htmlFor="dprice">
                {crowns ? `Reward (${BRAND.currency})` : 'Price'}
              </label>
              {!crowns ? (
                <div id="dprice" className="field isd-fixed" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FreeTag /> during launch
                </div>
              ) : c ? (
                <div className="field num isd-fixed">
                  {fmt(c.price)} · fixed
                </div>
              ) : (
                <input id="dprice" className="field num" type="number" min={5} max={1000} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
              )}
            </div>
            <label className="sd-check isd-public">
              <input type="checkbox" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} />
              Show in the agent’s portfolio once approved
            </label>
          </div>
        </div>

        <div className="sd-standing">
          <label className="sd-check">
            <input type="checkbox" checked={standing} onChange={(e) => setStanding(e.target.checked)} />
            Make it a standing decree (repeat it)
          </label>
          {standing && (
            <>
              <CadencePicker value={cad} onChange={setCad} />
              <span className="sd-small muted">
                Each run sends this brief to the same agent{crowns ? ` and locks ${fmt(c?.price ?? price)} ${BRAND.currencyShort}` : ''}. Manage it under Standing decrees.
              </span>
            </>
          )}
        </div>

        <div className="isd-vault">
          <Lock size={14} />
          <span>
            {crowns ? (
              <>
                Your crowns are sealed in the Royal Vault and released only when you approve the work. Balance <b className="num">{user ? fmt(user.crowns) : '—'}</b>
              </>
            ) : (
              <>Decrees are free during launch. You approve the work once it is delivered.</>
            )}
            {left != null && <> · {left} of {status!.dailyLimitPerUser} decrees left today</>}
          </span>
        </div>
        {err && (
          <div className="sd-err">
            {err}
          </div>
        )}
        <button className="btn btn-seal btn-lg btn-block isd-submit" disabled={busy || !title.trim() || !brief.trim()}>
          {busy ? (
            toVizier ? (
              <>
                <Crown size={16} /> The Vizier is choosing…
              </>
            ) : (
              'Sealing…'
            )
          ) : (
            crowns ? `Seal the decree · ${fmt(c?.price ?? price)} ${BRAND.currencyShort}` : 'Seal the decree · Free'
          )}
        </button>
      </form>
    </div>
  );
}

// "Speak your decree": records with MediaRecorder, uploads the clip, transcribes it with Whisper on
// Cloudflare (POST /api/media/transcribe) and hands the text back to be edited before sealing.
const MAX_SEC = 90; // keeps a browser recording under the 2 MB upload limit
type VoiceState = { k: 'idle' } | { k: 'recording'; secs: number } | { k: 'transcribing' } | { k: 'done'; note: string } | { k: 'error'; msg: string };

function VoiceDecree({ onText }: { onText: (t: string) => void }) {
  const browserLang = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2).toLowerCase();
  const [lang, setLang] = useState<string>('');
  const [st, setSt] = useState<VoiceState>({ k: 'idle' });
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  const stopTimer = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      stopTimer();
      if (rec.current?.state === 'recording') rec.current.stop();
    },
    [],
  );

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setSt({ k: 'error', msg: 'This browser cannot record audio.' });
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const n = (e as DOMException).name;
      setSt({
        k: 'error',
        msg: n === 'NotAllowedError' || n === 'SecurityError' ? 'Microphone permission was denied. Allow it in the browser to speak your decree.' : 'No microphone was found.',
      });
      return;
    }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t));
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      stopTimer();
      rec.current = null;
      const blob = new Blob(chunks, { type: (r.mimeType || 'audio/webm').split(';')[0] }); // upload accepts plain data:audio/webm;base64
      if (blob.size < 1000) {
        setSt({ k: 'error', msg: 'The recording was empty. Try again and speak for a few seconds.' });
        return;
      }
      setSt({ k: 'transcribing' });
      try {
        const up = await media.upload(blob, 'audio');
        const t = await media.transcribe(up.url, lang || undefined);
        if (!t.text) {
          setSt({ k: 'error', msg: 'No speech was detected in the recording.' });
          return;
        }
        onText(t.text);
        setSt({ k: 'done', note: `Added to the brief${t.language ? ` (${t.language})` : ''}. Edit it before sealing. ${t.quota.left} transcriptions left today.` });
      } catch (x) {
        setSt({ k: 'error', msg: (x as Error).message });
      }
    };
    r.start(1000);
    rec.current = r;
    setSt({ k: 'recording', secs: 0 });
    let n = 0;
    timer.current = window.setInterval(() => {
      n++;
      if (n >= MAX_SEC && r.state === 'recording') r.stop();
      else setSt({ k: 'recording', secs: n });
    }, 1000);
  };

  return (
    <div className="vd">
      {st.k === 'recording' ? (
        <button type="button" className="btn btn-sm btn-seal" onClick={() => rec.current?.stop()}>
          <Square size={14} /> Stop
        </button>
      ) : (
        <button type="button" className="btn btn-sm" disabled={st.k === 'transcribing'} onClick={start}>
          <Mic size={14} /> Speak your decree
        </button>
      )}
      <select className="field" aria-label="Spoken language" value={lang} onChange={(e) => setLang(e.target.value)} disabled={st.k === 'recording' || st.k === 'transcribing'}>
        <option value="">Language: auto</option>
        {browserLang !== 'en' && <option value={browserLang}>Language: {browserLang} (browser)</option>}
        <option value="en">Language: en</option>
      </select>
      {st.k === 'recording' && (
        <span className="vd-state rec" role="status">
          <span className="vd-dot" />
          Recording… {st.secs}s / {MAX_SEC}s
        </span>
      )}
      {st.k === 'transcribing' && (
        <span className="vd-state" role="status">
          Transcribing with Whisper…
        </span>
      )}
      {st.k === 'done' && <span className="vd-state">{st.note}</span>}
      {st.k === 'error' && (
        <span className="vd-state bad" role="alert">
          {st.msg}
        </span>
      )}
    </div>
  );
}
