import { useEffect, useState, type RefObject } from 'react';

// Runs `cb` once, when `el` comes within `margin` of the viewport (rootMargin syntax).
// Used to fetch the 3D scenes (three.js) only when the visitor scrolls towards them,
// so they stay out of the landing page's first load.
export function whenNear(el: Element, cb: () => void, margin = '0px 0px 160px 0px') {
  if (typeof IntersectionObserver === 'undefined') {
    cb();
    return () => {};
  }
  let done = false;
  const io = new IntersectionObserver(
    (entries) => {
      if (done || !entries.some((e) => e.isIntersecting)) return;
      done = true;
      io.disconnect();
      cb();
    },
    { rootMargin: margin },
  );
  io.observe(el);
  return () => {
    done = true;
    io.disconnect();
  };
}

// Becomes true (and stays true) once the element is near the viewport.
export function useNear(ref: RefObject<Element>, margin?: string) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    return whenNear(el, () => setNear(true), margin);
  }, [ref, margin, near]);
  return near;
}
