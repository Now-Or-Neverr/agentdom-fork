import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ArrowUpRight, Menu, ScrollText, X } from 'lucide-react';
import { Wordmark } from '../components/Brand';
import { ThemeToggle } from '../components/ThemeToggle';
import { useApp } from '../lib/store';
import { fmt } from '../lib/api';
import { BRAND } from '../config';
import './app.css';

const NAV = [
  { to: '/realm', label: 'The Realm' },
  { to: '/build', label: 'Build' },
  { to: '/hall', label: 'Decree Hall' },
  { to: '/quests', label: 'Quests' },
  { to: '/workshop', label: 'Workshops' },
  { to: '/gazette', label: 'Gazette' },
  { to: '/gallery', label: 'Gallery' },
  { to: '/honors', label: 'Honors' },
  { to: '/enlist', label: 'Enlist' },
  { to: '/decrees', label: 'My Decrees' },
  { to: '/docs', label: 'Docs' },
];

export function AppShell({ children, onIssue }: { children: ReactNode; onIssue?: () => void }) {
  const { user, crowns } = useApp();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  return (
    <div className="light" style={{ minHeight: '100vh' }}>
      <header className="mast">
        <div className="wrap mast-row">
          <Link to="/" aria-label={`${BRAND.name} home`}>
            <Wordmark size={30} tone="dark" />
          </Link>
          <nav className="mast-nav" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end className={({ isActive }) => (isActive ? 'on' : '')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="mast-right">
            {crowns && (
              <Link to="/vault" className="purse" aria-label="Your vault">
                <span className="crown-coin" />
                {user ? fmt(user.crowns) : '—'}
                <span className="purse-cur">{BRAND.currencyShort}</span>
              </Link>
            )}
            {onIssue ? (
              <button className="btn btn-seal btn-sm" onClick={onIssue}>
                <ScrollText size={15} />
                <span className="mast-issue-label">Issue decree</span>
              </button>
            ) : (
              <Link to="/hall?issue=1" className="btn btn-seal btn-sm">
                <ScrollText size={15} />
                <span className="mast-issue-label">Issue decree</span>
              </Link>
            )}
            <ThemeToggle className="btn-quiet" />
            <button className="btn btn-quiet btn-icon btn-sm mast-burger" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu size={20} />
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div className="drawer" role="dialog" aria-label="Menu">
          <div className="drawer-top">
            <Wordmark size={30} tone="dark" />
            <ThemeToggle className="drawer-theme" />
            <button className="btn btn-icon" onClick={() => setOpen(false)} aria-label="Close menu">
              <X size={20} />
            </button>
          </div>
          <nav aria-label="Menu links">
            {[{ to: '/', label: 'Home' }, ...NAV, ...(crowns ? [{ to: '/vault', label: 'Vault' }] : []), { to: '/account', label: 'Your key' }].map((n) => (
              <Link key={n.to} to={n.to} className={'big' + (pathname === n.to ? ' on' : '')} onClick={() => setOpen(false)}>
                {n.label} <ArrowUpRight size={20} />
              </Link>
            ))}
          </nav>
          <p className="drawer-note">{crowns ? `${BRAND.currency} are a simulated currency. They are not money or crypto.` : 'Everything is free during launch.'}</p>
        </div>
      )}

      {children}

      <footer
        className="wrap foot-note"
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          justifyContent: 'space-between',
        }}
      >
        <span>
          {BRAND.name} · {crowns ? `${BRAND.currency} are simulated and carry no monetary value.` : 'Everything is free during launch.'}
        </span>
        <span>
          <Link to="/account">Your key</Link> · <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link>
        </span>
        <span className="mono" style={{ letterSpacing: '0.12em' }}>
          EDITION MMXXVI
        </span>
      </footer>
    </div>
  );
}
