import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Festival, RealmLive, Weather } from '../../shared/live';
import type { Banner } from '../../shared/types';
import { PROVINCES, type ProvinceId } from '../../shared/realm';
import { provinceIcon } from '../components/ProvinceIcon';
import { RealmEngine, isMobileDevice } from './engine';
import { PreviewEngine } from './preview';
import './realm.css';

export type RealmPick = { kind: 'hall'; province: ProvinceId } | { kind: 'banner'; bannerId: string } | { kind: 'agent'; agentId: string } | { kind: 'none' };

export interface RealmHandle {
  zoomIn(): void;
  zoomOut(): void;
  recenter(): void;
  undo(): void;
  redo(): void;
  focusProvince(id: ProvinceId): void;
  toggleFullscreen(): void;
  focusAgent?(id: string): void;
  selectAgent?(id: string | null): void;
}

export interface RealmProps {
  mode: 'hero' | 'full';
  paused?: boolean;
  banners?: Banner[];
  /** Banner rental is open (crowns on). Off: vacant banners read "Vacant" instead of "Rent this banner". */
  rentOpen?: boolean;
  online?: Partial<Record<ProvinceId, number>>;
  time?: 'auto' | 'day' | 'night';
  // live realm (full mode): real agents, real weather, today's real holiday
  live?: RealmLive | null;
  weather?: Weather | null;
  festival?: Festival | null;
  onPick?: (p: RealmPick) => void;
  onZoom?: (pct: number) => void;
  onReady?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

// SVG markup of a guild's icon for the champion standard texture, taken from
// the province plaque already rendered on the map (lucide icon), recoloured.
function plaqueIcon(labels: Map<ProvinceId, HTMLElement>, id: ProvinceId): string | undefined {
  const svg = labels.get(id)?.querySelector('svg');
  if (!svg) return undefined;
  const c = svg.cloneNode(true) as SVGElement;
  c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  c.setAttribute('width', '128');
  c.setAttribute('height', '128');
  c.setAttribute('stroke', '#f6d064');
  c.setAttribute('stroke-width', '1.8');
  return c.outerHTML;
}

function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

// Painted sky behind the transparent canvas (full mode): pastel day sky or a
// starry purple night, sun / moon and drifting clouds. Cross-fades with --night.
function Backdrop() {
  return (
    <div className="realm-sky" aria-hidden>
      <div className="realm-sky-day" />
      <div className="realm-sky-night">
        <div className="realm-stars" />
      </div>
      <div className="realm-orb" />
      <div className="realm-cloud c3" />
      <div className="realm-cloud c1" />
      <div className="realm-cloud c2" />
      <div className="realm-haze" />
    </div>
  );
}

export const RealmCanvas = forwardRef<RealmHandle, RealmProps>(function RealmCanvas(props, ref) {
  const { mode, paused, banners, rentOpen = false, online, time, live: liveData, weather, festival, className, style } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const eng = useRef<RealmEngine | null>(null);
  const labelEls = useRef(new Map<ProvinceId, HTMLElement>());
  const agentLayer = useRef<HTMLDivElement>(null);
  const cbs = useRef(props);
  cbs.current = props;
  const live = useRef({ paused, banners, rentOpen, online, time, liveData, weather, festival });
  live.current = { paused, banners, rentOpen, online, time, liveData, weather, festival };

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    if (!supportsWebGL()) {
      cbs.current.onReady?.();
      return;
    }
    let e: RealmEngine | null = null;
    let disposed = false;
    const start = () => {
      if (disposed) return;
      e = new RealmEngine(el, mode, {
        onPick: (p) => cbs.current.onPick?.(p),
        onZoom: (z) => cbs.current.onZoom?.(z),
        onReady: () => {
          // Fade the live scene in over the still poster instead of swapping abruptly.
          wrap.current?.classList.add('is-live');
          cbs.current.onReady?.();
        },
        onNight: (n) => wrap.current?.style.setProperty('--night', n.toFixed(3)),
      });
      eng.current = e;
      const l = live.current;
      e.setTime(l.time ?? (mode === 'hero' ? 'day' : 'auto'));
      e.setPaused(!!l.paused);
      if (l.banners) e.setBanners(l.banners, l.rentOpen);
      if (l.online) e.setOnline(l.online);
      if (mode === 'full') {
        e.setLabels(labelEls.current);
        e.setAgentLayer(agentLayer.current);
        e.setIconSource((id) => plaqueIcon(labelEls.current, id));
        e.setLive(l.liveData);
        e.setWeather(l.weather);
        e.setFestival(l.festival);
      }
    };
    // On the landing page, build the bay after the hero text has animated in, so the
    // build does not freeze the first second. The full realm starts right away.
    let timer = 0;
    let idle = 0;
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void });
    if (mode === 'hero') {
      timer = window.setTimeout(() => {
        if (ric.requestIdleCallback) idle = ric.requestIdleCallback(start, { timeout: 1500 });
        else start();
      }, isMobileDevice() ? 500 : 700);
    } else start();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      if (idle) ric.cancelIdleCallback?.(idle);
      e?.dispose();
      eng.current = null;
    };
  }, [mode]);

  useEffect(() => {
    eng.current?.setPaused(!!paused);
  }, [paused]);
  useEffect(() => {
    eng.current?.setBanners(banners, rentOpen);
  }, [banners, rentOpen]);
  useEffect(() => {
    eng.current?.setOnline(online);
  }, [online]);
  useEffect(() => {
    eng.current?.setLive(liveData);
  }, [liveData]);
  useEffect(() => {
    eng.current?.setWeather(weather);
  }, [weather]);
  useEffect(() => {
    eng.current?.setFestival(festival);
  }, [festival]);
  useEffect(() => {
    eng.current?.setTime(time ?? (mode === 'hero' ? 'day' : 'auto'));
  }, [time, mode]);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => eng.current?.zoomBy(1.3),
      zoomOut: () => eng.current?.zoomBy(1 / 1.3),
      recenter: () => eng.current?.recenter(),
      undo: () => eng.current?.undo(),
      redo: () => eng.current?.redo(),
      focusProvince: (id) => eng.current?.focusProvince(id),
      toggleFullscreen: () => eng.current?.toggleFullscreen(),
      focusAgent: (id) => eng.current?.focusAgent(id),
      selectAgent: (id) => eng.current?.selectAgent(id),
    }),
    [],
  );

  return (
    <div ref={wrap} className={'realm-wrap ' + (className ?? '')} style={style} data-mode={mode}>
      {mode === 'full' && <Backdrop />}
      <div ref={stage} className="realm-stage" />
      {mode === 'full' && (
        <>
          <div className="realm-fog" aria-hidden />
          <div className="realm-flash" aria-hidden />
          <div ref={agentLayer} className="realm-agents" />
        </>
      )}
      {mode === 'full' && (
        <div className="realm-labels">
          {PROVINCES.map((p) => {
            const I = provinceIcon(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={'realm-plaque' + (p.id === 'throne' ? ' is-throne' : '')}
                style={{ '--accent': p.color } as React.CSSProperties}
                ref={(el) => {
                  if (el) labelEls.current.set(p.id, el);
                  else labelEls.current.delete(p.id);
                }}
                onClick={() => eng.current?.pickProvince(p.id)}
              >
                <span className="realm-plaque-ic">
                  <I size={12} strokeWidth={2.2} />
                </span>
                <span className="realm-plaque-name">{p.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

export function ProvincePreview({ province, paused, className, style }: { province: ProvinceId; paused?: boolean; className?: string; style?: React.CSSProperties }) {
  const wrap = useRef<HTMLDivElement>(null);
  const eng = useRef<PreviewEngine | null>(null);
  const cur = useRef({ province, paused });
  cur.current = { province, paused };

  useEffect(() => {
    const el = wrap.current;
    if (!el || !supportsWebGL()) return;
    const e = new PreviewEngine(el);
    eng.current = e;
    e.setPaused(!!cur.current.paused);
    e.show(cur.current.province);
    return () => {
      e.dispose();
      eng.current = null;
    };
  }, []);

  useEffect(() => {
    eng.current?.show(province);
  }, [province]);
  useEffect(() => {
    eng.current?.setPaused(!!paused);
  }, [paused]);

  return <div ref={wrap} className={'realm-preview ' + (className ?? '')} style={style} data-province={province} />;
}
