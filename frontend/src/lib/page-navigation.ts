import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/** Swap the page and restore its scroll inside a single visual transition. */
export function usePageNavigation<T extends string>(readPage: () => T) {
  const [page, setPage] = useState(readPage);
  useEffect(() => {
    let current = readPage();
    let generation = 0;
    let transition: ViewTransition | undefined;
    let fade: Animation | undefined;
    const scrolls = new Map<T, number>();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const navigate = async () => {
      const next = readPage();
      const ticket = ++generation;
      const paper = document.getElementById('main');
      transition?.skipTransition();
      const opacity = paper ? getComputedStyle(paper).opacity : '1';
      fade?.cancel();
      if (next === current) return;
      const swap = () => {
        if (ticket !== generation) return;
        scrolls.set(current, window.scrollY);
        current = next;
        flushSync(() => setPage(next));
        window.scrollTo({ top: scrolls.get(next) || 0, behavior: 'instant' });
        paper?.focus({ preventScroll: true });
      };
      if (reduced.matches || document.visibilityState !== 'visible') {
        swap();
      } else if (document.startViewTransition) {
        transition = document.startViewTransition(swap);
        // A rapid second navigation can deliberately skip a pending snapshot.
        void transition.ready.catch(() => {});
      } else if (paper) {
        fade = paper.animate([{ opacity }, { opacity: 0 }], {
          duration: 90,
          fill: 'forwards',
          easing: 'ease-out',
        });
        try {
          await fade.finished;
          if (ticket !== generation) return;
          swap();
          fade.cancel();
          fade = paper.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 220,
            easing: 'ease-out',
          });
          await fade.finished;
        } catch {
          // Canceled by a more recent navigation or unmount.
        }
      } else swap();
    };
    const stopMotion = () => {
      if (reduced.matches) {
        transition?.skipTransition();
        fade?.finish();
      }
    };
    window.addEventListener('hashchange', navigate);
    reduced.addEventListener('change', stopMotion);
    return () => {
      generation++;
      transition?.skipTransition();
      fade?.cancel();
      window.removeEventListener('hashchange', navigate);
      reduced.removeEventListener('change', stopMotion);
    };
  }, [readPage]);
  return page;
}
