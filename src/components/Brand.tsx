import { BRAND } from '../config';

// Purple squircle with a gold crown, used as the logo mark.
export function SealMark({ size = 30 }: { size?: number }) {
  return <img src="/logo.svg" width={size} height={size} alt="" style={{ flexShrink: 0 }} />;
}

// tone="light" = for dark backgrounds, tone="dark" = for light backgrounds
export function Wordmark({ size = 30, tone = 'dark' }: { size?: number; tone?: 'light' | 'dark' }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.3 }}>
      <SealMark size={size} />
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 900,
          fontSize: size * 0.72,
          letterSpacing: '-0.02em',
          lineHeight: 1,
          color: tone === 'light' ? '#fff' : 'var(--ink)',
        }}
      >
        {BRAND.name}
      </span>
    </span>
  );
}
