import { useEffect, useState, type RefObject } from 'react';

const SEL = '.reveal:not(.in), .ink-in:not(.in)';

// Adds `.in` to every .reveal / .ink-in element inside root once it enters the viewport.
// Also picks up elements that are added later (async data).
export function useReveal(root: RefObject<HTMLElement>, deps: unknown[] = []) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) {
      el.querySelectorAll<HTMLElement>(SEL).forEach((i) => i.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px 12% 0px', threshold: 0 },
    );
    const seen = new WeakSet<Element>();
    const scan = () =>
      el.querySelectorAll<HTMLElement>(SEL).forEach((i) => {
        if (!seen.has(i)) {
          seen.add(i);
          io.observe(i);
        }
      });
    scan();
    const mo = new MutationObserver(() => scan());
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// True while the element is on screen (used to pause WebGL canvases).
export function useInView(ref: RefObject<HTMLElement>, margin = '0px') {
  const [v, setV] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => setV(e.isIntersecting), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return v;
}
