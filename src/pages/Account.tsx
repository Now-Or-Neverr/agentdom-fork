// "Your key": no account needed. A secret key moves your decrees and builds to another device.
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Download, KeyRound, Loader2, LogIn } from 'lucide-react';
import { AppShell } from '../app/AppShell';
import { useApp } from '../lib/store';
import { accountApi } from '../lib/accountApi';
import { pokeWorkWatcher } from '../lib/workWatch';
import { NotifyButton } from '../components/NotifyButton';
import { HolderPerks } from '../components/HolderPerks';
import './account.css';

export default function Account() {
  const { user, refresh, toast } = useApp();
  const [info, setInfo] = useState<{ hasKey: boolean; createdAt: string | null } | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [input, setInput] = useState('');
  const [using, setUsing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    accountApi
      .keyInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [user?.id]);

  const make = async () => {
    if (info?.hasKey && !key && !window.confirm('This replaces your old key. The old key stops working. Continue?')) return;
    setMaking(true);
    try {
      const r = await accountApi.newKey();
      setKey(r.key);
      setInfo({ hasKey: true, createdAt: r.createdAt });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setMaking(false);
    }
  };

  const copy = async () => {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      toast('Key copied.');
    } catch {
      toast('Could not copy. Select the key and copy it by hand.');
    }
  };

  const download = () => {
    if (!key) return;
    const body = `Agentdom key\n\n${key}\n\nOpen ${location.origin}/account on another device and choose "Use a key" to open your decrees and builds there.\nKeep it private: anyone with this key can open your work.\n`;
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agentdom-key.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const use = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setUsing(true);
    setErr(null);
    try {
      const u = await accountApi.restore(input.trim());
      setInput('');
      setKey(null);
      await refresh();
      pokeWorkWatcher();
      toast(`Welcome back, ${u.name}.`);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setUsing(false);
    }
  };

  return (
    <AppShell>
      <section className="band">
        <div className="wrap">
          <span className="kicker">Your key</span>
          <h1 className="display d-lg" style={{ margin: '14px 0 0' }}>
            Your work, <em>on any device</em>
          </h1>
          <p className="lede acct-lede">No account needed. Save this key to open your decrees and builds on another device.</p>
        </div>
      </section>
      <div className="page-paper">
        <div className="wrap acct-main">
          <div className="card acct-card">
            <div className="acct-head">
              <KeyRound size={18} aria-hidden />
              <h2>Your key</h2>
            </div>
            <p className="muted">
              {user ? `You are ${user.name} on this device.` : 'Loading…'}{' '}
              {info?.hasKey && !key ? 'You already made a key. For safety we cannot show it again, but you can make a new one.' : ''}
            </p>
            {key ? (
              <>
                <code className="acct-key" aria-label="Your key">
                  {key}
                </code>
                <p className="acct-warn">Save it now. We only show it once. Anyone with this key can open your work.</p>
                <div className="acct-row">
                  <button className="btn btn-primary btn-sm" onClick={copy}>
                    <Copy size={15} aria-hidden /> Copy
                  </button>
                  <button className="btn btn-quiet btn-sm" onClick={download}>
                    <Download size={15} aria-hidden /> Download .txt
                  </button>
                </div>
              </>
            ) : (
              <div className="acct-row">
                <button className="btn btn-primary btn-sm" onClick={make} disabled={!user || making}>
                  {making ? <Loader2 size={15} className="spin" aria-hidden /> : <KeyRound size={15} aria-hidden />} {info?.hasKey ? 'Show a new key' : 'Create my key'}
                </button>
              </div>
            )}
          </div>

          <form className="card acct-card" onSubmit={use}>
            <div className="acct-head">
              <LogIn size={18} aria-hidden />
              <h2>Use a key</h2>
            </div>
            <p className="muted">Made a key on another device? Paste it here to open that work on this one. This device then switches to that key.</p>
            <label className="acct-label" htmlFor="acct-input">
              Key
            </label>
            <div className="acct-row acct-use">
              <input
                id="acct-input"
                className="field mono"
                placeholder="AGNT-XXXX-XXXX-XXXX-XXXX"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={input}
                maxLength={60}
                onChange={(e) => setInput(e.target.value)}
              />
              <button className="btn btn-primary btn-sm" disabled={using || !input.trim()}>
                {using ? <Loader2 size={15} className="spin" aria-hidden /> : null} Use key
              </button>
            </div>
            {err && (
              <p className="acct-err" role="alert">
                {err}
              </p>
            )}
            <p className="muted acct-small">Work you made here as the current guest stays with the current guest. Make a key for it first if you want to keep it.</p>
          </form>

          <HolderPerks />

          <div className="card acct-card">
            <div className="acct-head">
              <h2>When work finishes</h2>
            </div>
            <p className="muted">Get a browser notification when a decree is ready or a build is live, while a tab of this site is open.</p>
            <div className="acct-row">
              <NotifyButton />
            </div>
            <p className="muted acct-small">
              See your work in <Link to="/decrees">My decrees</Link> and <Link to="/build">Build</Link>.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
