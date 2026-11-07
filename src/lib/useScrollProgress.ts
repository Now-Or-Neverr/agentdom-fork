import { useEffect, useState, type RefObject } from 'react';

// Scroll progress 0..1 of a tall section that contains a sticky child.
// 0 = section top hits viewport top, 1 = section bottom hits viewport bottom.
export function useScrollProgress(ref: RefObject<HTMLElement>) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const calc = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      const v = span <= 0 ? 0 : Math.min(1, Math.max(0, -r.top / span));
      setP((old) => (Math.abs(old - v) < 0.001 ? old : v));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(calc);
    };
    calc();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);
  return p;
}

// Scrolls the page so the section reaches a given progress.
export function scrollToProgress(el: HTMLElement | null, p: number) {
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY;
  const span = el.offsetHeight - window.innerHeight;
  window.scrollTo({ top: top + span * p, behavior: 'smooth' });
}
