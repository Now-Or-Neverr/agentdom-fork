// "Notify me when it's done": asks for browser notification permission only after a click.
// Drop it next to anything that is still working. The global WorkWatcher (src/lib/workWatch.tsx)
// sends the notification; without permission or support the user still gets an in-app message.
import { useState } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { notifyPermission, pokeWorkWatcher } from '../lib/workWatch';
import { useApp } from '../lib/store';

/** `owner`: the user id the work belongs to; the button hides for anyone else. */
export function NotifyButton({ className = '', owner }: { className?: string; owner?: string }) {
  const { user } = useApp();
  const [perm, setPerm] = useState(notifyPermission);
  const [asking, setAsking] = useState(false);

  const ask = async () => {
    setAsking(true);
    try {
      // Older Safari only supports the callback form; this covers both.
      const p = await new Promise<NotificationPermission>((resolve) => {
        const r = Notification.requestPermission(resolve);
        if (r && typeof r.then === 'function') r.then(resolve, () => resolve(Notification.permission));
      });
      setPerm(p);
    } catch {
      setPerm(notifyPermission());
    } finally {
      setAsking(false);
      pokeWorkWatcher();
    }
  };

  if (owner !== undefined && user?.id !== owner) return null;
  const style = { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, lineHeight: 1.4 } as const;
  if (perm === 'granted')
    return (
      <span className={'muted ' + className} style={style} role="status">
        <BellRing size={15} aria-hidden /> We will notify you when it is done.
      </span>
    );
  if (perm === 'denied' || perm === 'unsupported')
    return (
      <span className={'muted ' + className} style={style}>
        <BellOff size={15} aria-hidden /> Keep a tab of this site open and we will show a message when it is done.
      </span>
    );
  return (
    <button type="button" className={'btn btn-quiet btn-sm ' + className} onClick={ask} disabled={asking}>
      <Bell size={15} aria-hidden /> Notify me when it’s done
    </button>
  );
}
