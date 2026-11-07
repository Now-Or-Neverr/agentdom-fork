// Lazy, fault-tolerant wrappers around the 3D realm module.
// The landing page must still render if WebGL is unavailable or the module fails to load.
import { Component, lazy, Suspense, type CSSProperties, type ReactNode } from 'react';
import type { ProvinceId } from '../../shared/realm';

type HeroProps = { paused?: boolean; style?: CSSProperties; className?: string };
type PreviewProps = { province: ProvinceId; paused?: boolean; style?: CSSProperties; className?: string };

// Loose typing on purpose: the realm module is maintained separately.
const LazyHero = lazy(async () => {
  const m: any = await import('../realm/RealmCanvas');
  const C = m.RealmCanvas;
  return { default: (p: HeroProps) => <C mode="hero" {...p} /> };
});
const LazyPreview = lazy(async () => {
  const m: any = await import('../realm/RealmCanvas');
  const C = m.ProvincePreview;
  if (!C) throw new Error('ProvincePreview not available');
  return { default: (p: PreviewProps) => <C {...p} /> };
});

class Guard extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    /* fall back silently */
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Soft placeholder (a little castle on a hill) shown while loading or without WebGL.
export function InkWash({ style, label }: { style?: CSSProperties; label?: string }) {
  return (
    <div className="ld-placeholder" style={style} aria-hidden={!label}>
      <svg viewBox="0 0 300 300" preserveAspectRatio="xMidYMid meet">
        <ellipse cx="150" cy="232" rx="118" ry="30" fill="#cfe7b6" />
        <g fill="var(--accent-line)">
          <rect x="104" y="150" width="92" height="70" rx="6" />
          <rect x="92" y="128" width="26" height="92" rx="5" />
          <rect x="182" y="128" width="26" height="92" rx="5" />
          <rect x="136" y="104" width="28" height="60" rx="5" />
        </g>
        <g fill="var(--purple-3)">
          <path d="M88 130 l17 -26 l17 26 z" />
          <path d="M178 130 l17 -26 l17 26 z" />
          <path d="M132 106 l18 -30 l18 30 z" />
        </g>
        <rect x="138" y="186" width="24" height="34" rx="12" fill="var(--purple)" />
        <circle cx="150" cy="70" r="5" fill="#f2b53a" />
      </svg>
      {label && <span>{label}</span>}
    </div>
  );
}

export function HeroRealm(p: HeroProps) {
  // The hero box already shows a still of the bay (CSS poster), so nothing else is drawn while loading.
  const fb = null;
  return (
    <Guard fallback={fb}>
      <Suspense fallback={fb}>
        <LazyHero {...p} />
      </Suspense>
    </Guard>
  );
}

export function ProvinceDiorama(p: PreviewProps & { fallback?: ReactNode }) {
  const fb = p.fallback ?? <InkWash style={p.style} />;
  return (
    <Guard fallback={fb}>
      <Suspense fallback={fb}>
        <LazyPreview {...p} />
      </Suspense>
    </Guard>
  );
}
