// Watches the user's decrees and builds that are still working while any tab is open, and
// says so when one finishes: an in-app toast, plus a browser notification when the user
// allowed them. No service worker: it only runs while a tab of the site is open.
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { accountApi, type WorkFeed } from './accountApi';
import { getUid } from './api';
import { useApp } from './store';

/** Fire this after starting a decree or build (or enabling notifications) to check right away. */
export const WORK_EVENT = 'agentdom:work';
export const pokeWorkWatcher = () => {
  try {
    window.dispatchEvent(new Event(WORK_EVENT));
  } catch {
    /* ignore */
  }
};

export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const notifyPermission = (): NotificationPermission | 'unsupported' => {
  try {
    return notifySupported() ? Notification.permission : 'unsupported';
  } catch {
    return 'unsupported';
  }
};

const BUSY_DECREE = new Set(['queued', 'working']);
const FAST = 20_000; // while something is working
const SLOW = 60_000; // just looking for new work

// One notification per finish across tabs.
function claim(key: string) {
  try {
    const list: string[] = JSON.parse(localStorage.getItem('agentdom.notified') || '[]');
    if (list.includes(key)) return false;
    localStorage.setItem('agentdom.notified', JSON.stringify([...list.slice(-49), key]));
  } catch {
    /* storage blocked: still notify */
  }
  return true;
}

type Decree = WorkFeed['decrees'][number];
type Build = WorkFeed['builds'][number];

export function WorkWatcher() {
  const { toast } = useApp();
  const navigate = useNavigate();
  const loc = useLocation();
  const here = useRef(loc);
  here.current = loc;
  const nav = useRef(navigate);
  nav.current = navigate;
  const say = useRef(toast);
  say.current = toast;

  useEffect(() => {
    const decrees = new Map<string, Decree>();
    const builds = new Map<string, Build>();
    let owner: string | null = null;
    let timer = 0;
    let busy = false;
    let alive = true;

    const finish = (path: string, title: string, body: string, key: string, onPage: boolean) => {
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (!onPage && !hidden) say.current(`${title}: ${body}`);
      if (notifyPermission() !== 'granted' || (onPage && !hidden) || !claim(key)) return;
      try {
        const n = new Notification(title, { body, tag: key, icon: '/logo.png' });
        n.onclick = () => {
          try {
            window.focus();
          } catch {
            /* ignore */
          }
          nav.current(path);
          n.close();
        };
      } catch {
        /* some mobile browsers only allow notifications from a service worker; the toast covers it */
      }
    };

    const poll = async () => {
      if (busy || !alive) return;
      const uid = getUid();
      if (!uid) return schedule();
      if (uid !== owner) {
        owner = uid;
        decrees.clear();
        builds.clear();
      }
      busy = true;
      try {
        const feed = await accountApi.work([...decrees.keys()], [...builds.keys()]);
        if (getUid() !== owner) return;
        const { pathname, search } = here.current;
        const seenD = new Set<string>();
        for (const d of feed.decrees) {
          seenD.add(d.id);
          if (BUSY_DECREE.has(d.status)) {
            decrees.set(d.id, d);
            continue;
          }
          if (!decrees.has(d.id)) continue;
          decrees.delete(d.id);
          if (d.status === 'cancelled') continue;
          const path = `/decrees/${d.id}`;
          const ok = d.status !== 'failed';
          finish(path, ok ? 'Your decree is ready' : 'Your decree did not finish', d.title, `d:${d.id}:${d.status}`, pathname === path);
        }
        for (const id of [...decrees.keys()]) if (!seenD.has(id)) decrees.delete(id);

        const seenB = new Set<string>();
        for (const b of feed.builds) {
          seenB.add(b.id);
          if (b.status === 'building') {
            builds.set(b.id, b);
            continue;
          }
          const prev = builds.get(b.id);
          if (!prev) continue;
          builds.delete(b.id);
          if (b.status === 'removed') continue;
          const path = `/build?b=${encodeURIComponent(b.id)}`;
          const onPage = pathname === '/build' && new URLSearchParams(search).get('b') === b.id;
          const title =
            b.status === 'failed' ? 'Your build failed' : b.failed ? 'Your build update did not work' : prev.version > 0 ? 'Your build is updated' : 'Your build is live';
          finish(path, title, b.title, `b:${b.id}:${b.status}:${b.version}`, onPage);
        }
        for (const id of [...builds.keys()]) if (!seenB.has(id)) builds.delete(id);
      } catch {
        /* offline or server restarting: try again later */
      } finally {
        busy = false;
        schedule();
      }
    };

    function schedule() {
      if (!alive) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(poll, decrees.size || builds.size ? FAST : SLOW);
    }
    const now = () => {
      window.clearTimeout(timer);
      // let the request that started the work land first
      timer = window.setTimeout(poll, 1200);
    };
    const onVis = () => {
      if (!document.hidden) now();
    };

    poll();
    window.addEventListener(WORK_EVENT, now);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener(WORK_EVENT, now);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // A new page (e.g. right after issuing a decree or starting a build) is a good moment to look.
  useEffect(() => {
    pokeWorkWatcher();
  }, [loc.pathname, loc.search]);

  return null;
}
