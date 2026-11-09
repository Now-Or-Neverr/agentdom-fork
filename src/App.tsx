import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

// Each page is its own chunk so three.js only loads where it is used.
// The landing page is the usual entry, so it ships with the main bundle (one round trip less).
import Landing from './pages/Landing';
import { WorkWatcher } from './lib/workWatch';
const Realm = lazy(() => import('./pages/Realm'));
const Hall = lazy(() => import('./pages/Hall'));
const AgentPage = lazy(() => import('./pages/AgentPage'));
const DecreePage = lazy(() => import('./pages/DecreePage'));
const MyDecrees = lazy(() => import('./pages/MyDecrees'));
const Enlist = lazy(() => import('./pages/Enlist'));
const Vault = lazy(() => import('./pages/Vault'));
const Honors = lazy(() => import('./pages/Honors'));
const Guild = lazy(() => import('./pages/Guild'));
const Workshop = lazy(() => import('./pages/Workshop'));
const Integrations = lazy(() => import('./pages/Integrations'));
const Gazette = lazy(() => import('./pages/Gazette'));
const HeraldQueue = lazy(() => import('./pages/HeraldQueue'));
const Schedules = lazy(() => import('./pages/Schedules'));
const Gallery = lazy(() => import('./pages/Gallery'));
const Quests = lazy(() => import('./pages/Quests'));
const Build = lazy(() => import('./pages/Build'));
const BuilderAdmin = lazy(() => import('./pages/BuilderAdmin'));
const Terms = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Terms })));
const Privacy = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Privacy })));
const Account = lazy(() => import('./pages/Account'));
const Docs = lazy(() => import('./pages/Docs'));
const GuildIndex = lazy(() => import('./pages/Guild').then((m) => ({ default: m.GuildIndex })));

export function App() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <>
      <WorkWatcher />
      <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--paper, #f6eee2)' }} />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/realm" element={<Realm />} />
          <Route path="/hall" element={<Hall />} />
          <Route path="/agents/:id" element={<AgentPage />} />
          <Route path="/decrees" element={<MyDecrees />} />
          <Route path="/decrees/:id" element={<DecreePage />} />
          <Route path="/enlist" element={<Enlist />} />
          <Route path="/vault" element={<Vault />} />
          <Route path="/honors" element={<Honors />} />
          <Route path="/guilds" element={<GuildIndex />} />
          <Route path="/guilds/:id" element={<Guild />} />
          <Route path="/workshop" element={<Workshop />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/gazette" element={<Gazette />} />
          <Route path="/admin/herald" element={<HeraldQueue />} />
          <Route path="/schedules" element={<Schedules />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/quests" element={<Quests />} />
          <Route path="/build" element={<Build />} />
          <Route path="/admin/builder" element={<BuilderAdmin />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/account" element={<Account />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
