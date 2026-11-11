// Holder perks: link a Solana wallet by signing a free message (no transaction).
import { useEffect, useState } from 'react';
import { Coins, Loader2, Unlink } from 'lucide-react';
import bs58 from 'bs58';
import { BRAND } from '../config';
import { getUid } from '../lib/api';
import { useApp } from '../lib/store';

interface Status {
  min: number;
  bonus: number;
  base: number;
  wallet: { address: string; balance: string; checkedAt: string } | null;
  holder: boolean;
  limit: number;
  token: string;
}

type SolWallet = {
  publicKey: { toBase58: () => string };
  connect: () => Promise<{ publicKey: { toBase58: () => string } }>;
  signMessage: (message: Uint8Array, display?: string) => Promise<{ signature: Uint8Array }>;
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const uid = getUid();
  if (uid) headers['x-user'] = uid;
  const res = await fetch('/api' + path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (HTTP ${res.status})`);
  return data as T;
}
const fmt = (n: number | string) => Number(n).toLocaleString('en', { maximumFractionDigits: 2 });
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

function solWallet(): SolWallet | undefined {
  const w = window as unknown as { phantom?: { solana?: SolWallet }; solana?: SolWallet };
  return w.phantom?.solana ?? w.solana;
}

export function HolderPerks() {
  const { user, toast } = useApp();
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wallet = solWallet();

  useEffect(() => {
    if (!user) return;
    api<Status>('/me/holder')
      .then(setS)
      .catch(() => setS(null));
  }, [user?.id]);

  const link = async () => {
    if (!wallet) return;
    setBusy(true);
    setErr(null);
    try {
      const conn = await wallet.connect();
      const address = conn.publicKey.toBase58();
      const { message } = await api<{ message: string }>('/me/holder/challenge', { method: 'POST', body: JSON.stringify({ address }) });
      const encoded = new TextEncoder().encode(message);
      const signed = await wallet.signMessage(encoded, 'utf8');
      const signature = bs58.encode(signed.signature);
      const next = await api<Status>('/me/holder', { method: 'POST', body: JSON.stringify({ signature }) });
      setS(next);
      toast(next.holder ? `Holder perks on: ${next.limit} decrees a day.` : 'Wallet linked.');
    } catch (e) {
      const m = (e as { message?: string }).message ?? 'Linking failed.';
      setErr(/reject|denied|cancel/i.test(m) ? 'You cancelled the signature.' : m);
    } finally {
      setBusy(false);
    }
  };
  const unlink = async () => {
    setBusy(true);
    try {
      setS(await api<Status>('/me/holder', { method: 'DELETE' }));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card acct-card">
      <div className="acct-head">
        <Coins size={18} aria-hidden />
        <h2>$AGENTDOM holder perks</h2>
      </div>
      <p className="muted">
        Hold at least {s ? fmt(s.min) : '…'} $AGENTDOM on {BRAND.chain} and get {s ? s.bonus : '…'} extra decrees per day ({s ? s.base + s.bonus : '…'} instead of {s ? s.base : '…'}). Link your
        wallet by signing a message: it is free, sends no transaction and gives no access to your funds.
      </p>
      {s?.wallet ? (
        <>
          <p>
            Linked wallet <b>{short(s.wallet.address)}</b> holds <b>{fmt(s.wallet.balance)}</b> $AGENTDOM.{' '}
            {s.holder ? <span className="tag">Perks on · {s.limit} decrees a day</span> : <span className="tag">Below {fmt(s.min)}: no perks yet</span>}
          </p>
          <div className="acct-row">
            <button className="btn btn-sm" onClick={link} disabled={busy || !wallet}>
              {busy ? <Loader2 size={15} className="spin" aria-hidden /> : null} Link another wallet
            </button>
            <button className="btn btn-quiet btn-sm" onClick={unlink} disabled={busy}>
              <Unlink size={15} aria-hidden /> Unlink
            </button>
          </div>
        </>
      ) : (
        <div className="acct-row">
          <button className="btn btn-primary btn-sm" onClick={link} disabled={busy || !wallet || !user}>
            {busy ? <Loader2 size={15} className="spin" aria-hidden /> : null} Link wallet
          </button>
        </div>
      )}
      {!wallet && <p className="muted acct-small">Open this page in a browser with a Solana wallet (for example Phantom or Solflare) to link a wallet.</p>}
      {err && (
        <p className="acct-err" role="alert">
          {err}
        </p>
      )}
      <p className="muted acct-small">The balance is re-read from the chain at least every 30 minutes. Linking is per device, like your guest key.</p>
    </div>
  );
}
