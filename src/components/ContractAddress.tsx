// The token's contract address: ticker, address, a copy button and (when set) a link to Pons.
// Optional meta: launch countdown + scam alert (official mint and dev wallet only).
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Check, Copy, ShieldAlert } from 'lucide-react';
import { BRAND } from '../config';
import './ca.css';

function copyText(text: string) {
  return navigator.clipboard.writeText(text).catch(() => {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  });
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function useCountdown(iso: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return null;
  const end = Date.parse(iso);
  if (Number.isNaN(end)) return null;
  const left = end - now;
  if (left <= 0) return { live: true as const, left: 0 };
  const s = Math.floor(left / 1000);
  return {
    live: false as const,
    left,
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

function CopyChip({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const go = async () => {
    await copyText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button type="button" className="ca-chip" onClick={go} title={`Copy ${label}`}>
      <span className="ca-chip-label">{label}</span>
      <span className={'ca-chip-val' + (mono ? ' ca-chip-mono' : '')}>{value}</span>
      <span className="ca-chip-icon">{copied ? <Check size={13} /> : <Copy size={13} />}</span>
    </button>
  );
}

function LaunchCountdown() {
  const cd = useCountdown(BRAND.launchAt);
  if (!cd) return null;
  if (cd.live) {
    return (
      <p className="ca-countdown ca-countdown-live">
        <ShieldAlert size={15} aria-hidden /> $AGENTDOM is live on {BRAND.chain}. Use only the official mint below.
      </p>
    );
  }
  return (
    <div className="ca-countdown" role="timer" aria-live="polite">
      <span className="ca-countdown-kicker">Official launch on this mint</span>
      <div className="ca-countdown-grid">
        <div>
          <b>{cd.days}</b>
          <small>days</small>
        </div>
        <div>
          <b>{pad(cd.hours)}</b>
          <small>hrs</small>
        </div>
        <div>
          <b>{pad(cd.minutes)}</b>
          <small>min</small>
        </div>
        <div>
          <b>{pad(cd.seconds)}</b>
          <small>sec</small>
        </div>
      </div>
    </div>
  );
}

function ScamAlert() {
  if (!BRAND.ca) return null;
  const dev = BRAND.devWallet;
  const mintUrl = `${BRAND.explorer}/token/${BRAND.ca}`;
  const devUrl = dev ? `${BRAND.explorer}/account/${dev}` : null;
  return (
    <div className="ca-scam" role="note">
      <div className="ca-scam-head">
        <AlertTriangle size={16} aria-hidden />
        <strong>Scam alert</strong>
      </div>
      <p>
        Copycats may fork the name or branding. Trust <b>only</b> this official mint and the dev wallet below — not DMs, not “early”
        addresses, not lookalike tickers.
      </p>
      <div className="ca-scam-chips">
        <CopyChip label="Official mint" value={BRAND.ca} mono />
        {dev && <CopyChip label="Dev wallet" value={dev} mono />}
      </div>
      <p className="ca-scam-links">
        <a href={mintUrl} target="_blank" rel="noopener noreferrer">
          Verify mint on Solscan <ArrowUpRight size={12} />
        </a>
        {devUrl && (
          <>
            <span className="ca-scam-dot" aria-hidden>
              ·
            </span>
            <a href={devUrl} target="_blank" rel="noopener noreferrer">
              Dev wallet <ArrowUpRight size={12} />
            </a>
          </>
        )}
      </p>
    </div>
  );
}

export function ContractAddress({ className = '' }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!BRAND.ca) return null;
  const copy = async () => {
    await copyText(BRAND.ca);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className={`ca ${className}`}>
      <span className="ca-tick">
        ${BRAND.ticker}
        <span className="ca-chain">on {BRAND.chain}</span>
      </span>
      <button type="button" className="ca-copy" onClick={copy} title="Copy contract address" aria-label={`Copy contract address ${BRAND.ca}`}>
        <span className="ca-addr">{BRAND.ca}</span>
        <span className="ca-icon">{copied ? <Check size={14} /> : <Copy size={14} />}</span>
        <span className="ca-done" aria-live="polite">
          {copied ? 'Copied' : ''}
        </span>
      </button>
      {BRAND.pons && (
        <a className="ca-pons" href={BRAND.pons} target="_blank" rel="noopener noreferrer">
          Pons <ArrowUpRight size={13} />
        </a>
      )}
    </div>
  );
}

/** CA pill plus launch countdown and scam warning (hero, docs token section). */
export function ContractAddressBlock({ className = '' }: { className?: string }) {
  if (!BRAND.ca) return null;
  return (
    <div className={'ca-stack ' + className}>
      <ContractAddress />
      <LaunchCountdown />
      <ScamAlert />
    </div>
  );
}
