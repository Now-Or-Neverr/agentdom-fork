import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Pencil } from 'lucide-react';
import type { LedgerEntry } from '../../shared/types';
import { AppShell } from '../app/AppShell';
import { Seal } from '../components/Ink';
import { ago, api, fmt } from '../lib/api';
import { useApp } from '../lib/store';
import { BRAND } from '../config';

const KIND: Record<LedgerEntry['kind'], string> = {
  grant: 'Welcome grant from the Crown',
  vault_lock: 'Sealed in the Royal Vault for a decree',
  refund: 'Returned from the Royal Vault',
  banner_rent: 'Banner rent',
  agent_earning: 'Earned by your agent',
  festival_bonus: 'Festival bonus from the Crown',
};

export default function Vault() {
  const { user, refresh, toast } = useApp();
  const [rows, setRows] = useState<LedgerEntry[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    api.ledger().then(setRows).catch(() => setRows([]));
  }, [user?.crowns]);

  async function save() {
    try {
      await api.rename(name);
      await refresh();
      setEditing(false);
      toast('Your name has been recorded.');
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const spent = (rows ?? []).filter((r) => r.kind === 'vault_lock' || r.kind === 'banner_rent').reduce((s, r) => s - r.amount, 0);
  const back = (rows ?? []).filter((r) => r.kind === 'refund' || r.kind === 'agent_earning' || r.kind === 'festival_bonus').reduce((s, r) => s + r.amount, 0);

  return (
    <AppShell>
      <section className="band">
        <div className="wrap" style={{ display: 'flex', gap: 24, alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <span className="kicker">Your vault</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              {editing ? (
                <>
                  <input className="field" style={{ maxWidth: 240, height: 40, padding: '0 12px' }} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Your name" />
                  <button className="btn btn-gold btn-sm" onClick={save}>
                    Save
                  </button>
                </>
              ) : (
                <>
                  <span className="soft">{user?.name}</span>
                  <button
                    className="btn btn-quiet btn-icon btn-sm"
                    onClick={() => {
                      setName(user?.name ?? '');
                      setEditing(true);
                    }}
                    aria-label="Rename"
                  >
                    <Pencil size={14} />
                  </button>
                </>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 6 }}>
              <span className="display d-xxl" style={{ color: 'var(--purple)' }}>
                {user ? fmt(user.crowns) : '—'}
              </span>
              <span className="mono soft">{BRAND.currencyShort}</span>
            </div>
            <p className="soft" style={{ fontSize: 13, maxWidth: 520 }}>
              {BRAND.currency} are a simulated currency inside {BRAND.name}. They are not money and not crypto.
            </p>
          </div>
          <Seal size={110} rotate={-8}>
            Royal
            <br />
            Vault
          </Seal>
        </div>
      </section>

      <div className="page-paper">
        <div className="wrap" style={{ padding: '26px 16px 70px', maxWidth: 900 }}>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 26 }}>
            <div className="panel" style={{ padding: 16 }}>
              <div className="label">Sealed for decrees & banners</div>
              <div className="display d-md num">{fmt(spent)}</div>
            </div>
            <div className="panel" style={{ padding: 16 }}>
              <div className="label">Returned & earned</div>
              <div className="display d-md num">{fmt(back)}</div>
            </div>
          </div>

          <div className="section-title" style={{ marginTop: 0 }}>
            <h2>Ledger</h2>
          </div>
          <div className="panel" style={{ overflow: 'hidden' }}>
            {rows == null && <div className="skeleton" style={{ height: 140, borderRadius: 0 }} />}
            {rows?.length === 0 && <div className="empty" style={{ border: 0 }}>No entries yet.</div>}
            {rows?.map((r, i) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderTop: i ? '1px solid var(--line)' : 0 }}>
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    transform: 'rotate(45deg)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: r.amount > 0 ? 'rgba(63,165,140,.15)' : 'rgba(194,59,34,.12)',
                    color: r.amount > 0 ? 'var(--jade)' : 'var(--vermilion)',
                    flexShrink: 0,
                  }}
                >
                  <span style={{ transform: 'rotate(-45deg)', display: 'inline-flex' }}>{r.amount > 0 ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{KIND[r.kind]}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {ago(r.createdAt)}
                    {r.ref?.startsWith('dec_') && (
                      <>
                        {' · '}
                        <Link to={`/decrees/${r.ref}`} style={{ textDecoration: 'underline' }}>
                          view decree
                        </Link>
                      </>
                    )}
                    {r.ref?.startsWith('qst_') && (
                      <>
                        {' · '}
                        <Link to="/quests" style={{ textDecoration: 'underline' }}>
                          view quest
                        </Link>
                      </>
                    )}
                  </div>
                </div>
                <span className="num" style={{ fontWeight: 700, color: r.amount > 0 ? 'var(--jade)' : 'var(--ink)' }}>
                  {r.amount > 0 ? '+' : ''}
                  {fmt(r.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
