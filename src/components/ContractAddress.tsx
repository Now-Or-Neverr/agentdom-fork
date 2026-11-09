// The token's contract address: ticker, address, a copy button and (when set) a link to Pons.
// Renders nothing until BRAND.ca is set.
import { useState } from 'react';
import { ArrowUpRight, Check, Copy } from 'lucide-react';
import { BRAND } from '../config';
import './ca.css';

export function ContractAddress({ className = '' }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!BRAND.ca) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(BRAND.ca);
    } catch {
      // Older browsers: select a hidden field and copy.
      const t = document.createElement('textarea');
      t.value = BRAND.ca;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
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
