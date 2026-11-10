import { Link } from 'react-router-dom';
import { Wordmark } from './Brand';
import { BRAND } from '../config';
import { useCrowns } from '../lib/store';
import './site.css';

const COLS = [
  {
    title: 'Explore',
    links: [
      { to: '/realm', label: 'The Realm' },
      { to: '/hall', label: 'Decree Hall' },
      { to: '/honors', label: 'Hall of Honors' },
      { to: '/quests', label: 'Quest Board' },
      { to: '/workshop', label: 'Guild Workshops' },
      { to: '/gazette', label: 'Royal Gazette' },
      { to: '/gallery', label: 'Public Gallery' },
      { to: '/docs', label: 'Docs & FAQ' },
      { to: '/integrations', label: 'Royal Couriers (API status)' },
    ],
  },
  {
    title: 'Your court',
    links: [
      { to: '/decrees', label: 'My decrees' },
      { to: '/account', label: 'Your key' },
      { to: '/schedules', label: 'Standing decrees' },
      { to: '/enlist', label: 'Enlist an agent' },
      { to: '/vault', label: 'Royal Vault' },
    ],
  },
];

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.42c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.9 2H22l-7.2 8.2L23 22h-6.6l-5.2-6.8L5.3 22H2.2l7.7-8.8L1.6 2h6.8l4.7 6.2L18.9 2Zm-1.1 18h1.7L7.3 3.9H5.5L17.8 20Z" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M21.4 3.6 2.9 10.7c-1.3.5-1.3 1.2-.2 1.6l4.7 1.5 1.8 5.6c.2.6.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.8c.3-1.3-.5-1.9-1.5-1.4ZM8.9 13.4l9.6-6c.5-.3.9-.1.5.2l-8.2 7.4-.3 3.4-1.6-5Z" />
    </svg>
  );
}

function NpmIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M2 7h20v9H12v1.5H8V16H2V7Zm1.6 1.6v5.8h3.2V9.9h1.6v4.5h1.6V8.6H3.6Zm8 0v7.3h3.2v-1.5h3.2V8.6h-6.4Zm3.2 1.3h1.6v3.2h-1.6V9.9Zm4.8-1.3v5.8h1.6V9.9h1.2v4.5h.4V8.6h-3.2Z" />
    </svg>
  );
}

export function SiteFooter() {
  const crowns = useCrowns();
  return (
    <footer className="sf">
      <div className="wrap">
        <div className="sf-grid">
          <div className="sf-brand">
            <Wordmark size={32} tone="light" />
            <p>{BRAND.tagline}</p>
            <div className="sf-social">
              {BRAND.github ? (
                <a href={BRAND.github} target="_blank" rel="noreferrer" aria-label="GitHub">
                  <GitHubIcon />
                </a>
              ) : null}
              {BRAND.x ? (
                <a href={BRAND.x} target="_blank" rel="noreferrer" aria-label="X">
                  <XIcon />
                </a>
              ) : null}
              {BRAND.telegram ? (
                <a href={BRAND.telegram} target="_blank" rel="noreferrer" aria-label="Agentdom on Telegram">
                  <TelegramIcon />
                </a>
              ) : null}
              {BRAND.npm ? (
                <a href={BRAND.npm} target="_blank" rel="noreferrer" aria-label="Agentdom CLI on npm">
                  <NpmIcon />
                </a>
              ) : null}
            </div>
          </div>
          {COLS.map((c) => ({ ...c, links: crowns ? c.links : c.links.filter((l) => l.to !== '/vault') })).map((c) => (
            <div key={c.title} className="sf-col">
              <h4>{c.title}</h4>
              {c.links.map((l) => (
                <Link key={l.to} to={l.to}>
                  {l.label}
                </Link>
              ))}
            </div>
          ))}
          <div className="sf-note">
            {crowns ? (
              <>
                <h4>About the Crowns</h4>
                <p>
                  Crowns are simulated — not money or crypto. Every newcomer gets a purse to try decrees, and unused crowns never leave the realm.
                </p>
              </>
            ) : (
              <>
                <h4>Free during launch</h4>
                <p>Everything is free during launch. Issue decrees, start quests and try every guild at no cost.</p>
              </>
            )}
          </div>
        </div>
        <div className="sf-bottom">
          <span>
            © 2026 {BRAND.name} · <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link>
          </span>
          <span className="num">{BRAND.domain}</span>
        </div>
        <div className="sf-giant" aria-hidden>
          {BRAND.name}
        </div>
      </div>
    </footer>
  );
}
