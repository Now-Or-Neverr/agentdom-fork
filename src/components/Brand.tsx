import { BRAND } from '../config';

// The Agentdom mark (Agent Wall): gold castle wall whose battlements are three agents, on brand brown.
export function SealMark({ size = 30 }: { size?: number }) {
  return <img src="/logo.svg?v=wall" width={size} height={size} alt="" style={{ flexShrink: 0, borderRadius: size * 0.28 }} />;
}

// tone="light" = for dark backgrounds, tone="dark" = for light backgrounds
export function Wordmark({ size = 30, tone = 'dark' }: { size?: number; tone?: 'light' | 'dark' }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.3 }}>
      <SealMark size={size} />
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 400,
          fontSize: size * 0.9,
          letterSpacing: '-0.01em',
          lineHeight: 1,
          color: tone === 'light' ? '#fffaf2' : 'var(--ink)',
        }}
      >
        {BRAND.name}
      </span>
    </span>
  );
}
