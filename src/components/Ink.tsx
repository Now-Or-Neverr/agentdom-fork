// Small decorative pieces shared across pages (bright royal style).
import type { CSSProperties, ReactNode } from 'react';

// Soft highlighter swoosh under a word.
export function BrushStroke({ width = 220, color = 'var(--gold-2)', style }: { width?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={width} height={width * 0.08} viewBox="0 0 400 32" preserveAspectRatio="none" style={style} aria-hidden>
      <path d="M6 18 C80 8, 200 6, 394 12 L392 24 C220 20, 100 24, 8 28 Z" fill={color} />
    </svg>
  );
}

// Rounded badge (was a red seal). Keeps the same API.
export function Seal({ children, size = 64, rotate = -6, color = 'var(--purple)' }: { children: ReactNode; size?: number; rotate?: number; color?: string }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        background: color,
        color: '#fff',
        borderRadius: size * 0.3,
        boxShadow: `0 ${size * 0.08}px ${size * 0.2}px rgba(27,21,48,.18), inset 0 0 0 ${Math.max(2, size * 0.045)}px rgba(255,255,255,.35)`,
        transform: `rotate(${rotate}deg)`,
        fontFamily: 'var(--font-display)',
        fontWeight: 400,
        fontSize: size * 0.2,
        lineHeight: 1.05,
        flexShrink: 0,
        padding: size * 0.1,
      }}
    >
      {children}
    </span>
  );
}

// Simple divider with a small diamond.
export function KnotRule({ style }: { style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--line-c2)', ...style }} aria-hidden>
      <span style={{ flex: 1, height: 1, background: 'currentColor' }} />
      <span style={{ width: 8, height: 8, transform: 'rotate(45deg)', background: 'var(--gold)', borderRadius: 2 }} />
      <span style={{ flex: 1, height: 1, background: 'currentColor' }} />
    </div>
  );
}

// Puffy cloud decoration.
export function CloudMotif({ size = 120, color = '#ffffff', opacity = 0.9, style }: { size?: number; color?: string; opacity?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size * 0.5} viewBox="0 0 200 100" style={{ opacity, ...style }} aria-hidden>
      <path d="M30 90 C8 90 4 64 26 60 C24 36 56 28 70 46 C76 18 122 14 130 44 C150 30 180 42 176 66 C196 70 194 92 172 90 Z" fill={color} />
    </svg>
  );
}

// Rounded framed container.
export function Frame({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <div className={className} style={{ position: 'relative', borderRadius: 'var(--r-xl)', border: '1px solid var(--line)', ...style }}>
      {children}
    </div>
  );
}
