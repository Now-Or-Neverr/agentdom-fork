import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { Wordmark } from './Brand';
import { ThemeToggle } from './ThemeToggle';
import { useApp } from '../lib/store';
import { fmt } from '../lib/api';
import { BRAND } from '../config';
import './site.css';

const NAV = [
  { to: '/realm', label: 'The Realm' },
  { to: '/build', label: 'Build' },
  { to: '/hall', label: 'Decree Hall' },
  { to: '/quests', label: 'Quests' },
  { to: '/workshop', label: 'Workshops' },
  { to: '/gazette', label: 'Gazette' },
  { to: '/honors', label: 'Honors' },
  { to: '/enlist', label: 'Enlist' },
  { to: '/docs', label: 'Docs' },
];

// Full-width cream bar. Gains a hairline and shadow once the page scrolls.
export function SiteHeader() {
  const { user, crowns } = useApp();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <>
      <header className={'sh' + (scrolled ? ' sh-scrolled' : '')}>
        <div className="wrap sh-row">
          <Link to="/" aria-label={`${BRAND.name} home`}>
            <Wordmark size={30} />
          </Link>
          <nav className="sh-nav" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="sh-right">
            {crowns && (
              <Link to="/vault" className="sh-purse" aria-label="Your vault">
                <span className="sh-coin" />
                <span className="num">{user ? fmt(user.crowns) : '—'}</span>
                <span className="sh-cur">{BRAND.currencyShort}</span>
              </Link>
            )}
            <ThemeToggle className="sh-theme" />
            <Link to="/realm" className="btn btn-primary btn-sm sh-enter">
              Enter the Realm
            </Link>
            <button className="btn btn-sm btn-icon sh-burger" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu size={19} />
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div className="sh-drawer" role="dialog" aria-label="Menu">
          <div className="sh-drawer-top">
            <Wordmark size={28} />
            <ThemeToggle className="sh-drawer-theme" />
            <button className="btn btn-icon btn-sm" onClick={() => setOpen(false)} aria-label="Close menu">
              <X size={19} />
            </button>
          </div>
          <nav>
            {[...NAV, ...(crowns ? [{ to: '/vault', label: 'Vault' }] : []), { to: '/decrees', label: 'My decrees' }, { to: '/account', label: 'Your key' }].map((n) => (
              <Link key={n.to} to={n.to} onClick={() => setOpen(false)}>
                {n.label}
                <ArrowUpRight size={20} />
              </Link>
            ))}
          </nav>
          <Link to="/realm" className="btn btn-primary btn-lg btn-block" onClick={() => setOpen(false)}>
            Enter the Realm
          </Link>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>
            {user ? (crowns ? `${user.name} · ${fmt(user.crowns)} ${BRAND.currency}` : user.name) : ''}
          </p>
        </div>
      )}
    </>
  );
}
