import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/** Swap the page and restore its scroll inside a single visual transition. */
export function usePageNavigation<T extends string>(readPage: () => T, order: readonly T[]) {
  const [page, setPage] = useState(readPage);
  useEffect(() => {
    let current = readPage();
    let generation = 0;
    let transition: ViewTransition | undefined;
    let fade: Animation | undefined;
    let restoreOrigin: (() => void) | undefined;
    const scrolls = new Map<T, number>();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const navigate = async () => {
      const next = readPage();
      const ticket = ++generation;
      const paper = document.getElementById('menu-pages');
      transition?.skipTransition();
      const opacity = paper ? getComputedStyle(paper).opacity : '1';
      fade?.cancel();
      restoreOrigin?.();
      restoreOrigin = undefined;
      paper?.removeAttribute('aria-busy');
      if (next === current) return;
      const forward = order.indexOf(next) > order.indexOf(current);
      document.documentElement.dataset.pageDirection = forward ? 'forward' : 'backward';
      const swap = () => {
        if (ticket !== generation) return;
        scrolls.set(current, paper?.scrollTop || 0);
        current = next;
        flushSync(() => setPage(next));
        paper?.scrollTo({ top: scrolls.get(next) || 0, behavior: 'instant' });
        document.getElementById('main')?.focus({ preventScroll: true });
        window.dispatchEvent(new Event('menu-page-change'));
      };
      if (
        reduced.matches ||
        document.visibilityState !== 'visible' ||
        document.querySelector('[data-tour-overlay]')
      ) {
        swap();
      } else if (document.startViewTransition) {
        paper?.setAttribute('aria-busy', 'true');
        transition = document.startViewTransition(swap);
        // A rapid second navigation can deliberately skip a pending snapshot.
        void transition.ready.catch(() => {});
        const finish = () => {
          if (ticket === generation) paper?.removeAttribute('aria-busy');
        };
        void transition.finished.then(finish, finish);
      } else if (paper) {
        paper.setAttribute('aria-busy', 'true');
        const desktop = matchMedia('(min-width: 1100px)').matches;
        const direction = forward ? 1 : -1;
        const oldOrigin = paper.style.transformOrigin;
        restoreOrigin = () => {
          paper.style.transformOrigin = oldOrigin;
        };
        paper.style.transformOrigin = desktop
          ? 'center top'
          : forward
            ? 'left center'
            : 'right center';
        fade = paper.animate(
          [
            { opacity, transform: 'none' },
            {
              opacity: 0,
              transform: desktop
                ? `translateY(${direction * 8}px)`
                : `perspective(1600px) rotateY(${-direction * 6}deg) scaleX(.98)`,
            },
          ],
          {
            duration: 240,
            fill: 'forwards',
            easing: 'ease-out',
          },
        );
        try {
          await fade.finished;
          if (ticket !== generation) return;
          swap();
          fade.cancel();
          const entry: Keyframe = desktop
            ? { opacity: 0, transform: `translateY(${-direction * 10}px)` }
            : {
                opacity: 0,
                transform: `perspective(1600px) rotateY(${-direction * 12}deg) scaleX(.96)`,
              };
          fade = paper.animate(
            [entry, { opacity: 1, clipPath: 'inset(0 0 0 0)', transform: 'none' }],
            {
              duration: reduced.matches ? 1 : 520,
              easing: 'cubic-bezier(.4,0,.2,1)',
            },
          );
          await fade.finished;
        } catch {
          // Canceled by a more recent navigation or unmount.
        } finally {
          if (ticket === generation) {
            paper.removeAttribute('aria-busy');
            restoreOrigin?.();
            restoreOrigin = undefined;
          }
        }
      } else swap();
    };
    const stopMotion = () => {
      if (reduced.matches) {
        transition?.skipTransition();
        fade?.finish();
      }
    };
    // A captured page has the old dimensions. Finish before a resize or a
    // breakpoint change can stretch it or switch the binding axis mid-turn.
    const finishOnResize = () => {
      transition?.skipTransition();
      fade?.finish();
    };
    window.addEventListener('hashchange', navigate);
    window.addEventListener('resize', finishOnResize);
    reduced.addEventListener('change', stopMotion);
    return () => {
      generation++;
      transition?.skipTransition();
      fade?.cancel();
      restoreOrigin?.();
      document.getElementById('menu-pages')?.removeAttribute('aria-busy');
      delete document.documentElement.dataset.pageDirection;
      window.removeEventListener('hashchange', navigate);
      window.removeEventListener('resize', finishOnResize);
      reduced.removeEventListener('change', stopMotion);
    };
  }, [readPage, order]);
  return page;
}
