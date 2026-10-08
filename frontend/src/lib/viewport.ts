import { useEffect } from 'react';

export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    let fullHeight = window.innerHeight;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Do not counteract intentional pinch zoom.
        if (viewport && Math.abs(viewport.scale - 1) > 0.05) return;
        fullHeight = Math.max(fullHeight, window.innerHeight);
        const height = viewport?.height || window.innerHeight;
        const root = document.documentElement;
        root.style.setProperty('--visual-viewport-height', `${height}px`);
        root.style.setProperty('--visual-viewport-top', `${viewport?.offsetTop || 0}px`);
        const active = document.activeElement as HTMLElement | null;
        const editing = active?.matches('input, textarea, [contenteditable="true"]');
        root.classList.toggle('keyboard-open', !!editing && fullHeight - height > 120);
        if (editing && active) {
          const scroller = active.closest<HTMLElement>('.dialog-scroll');
          if (scroller) {
            const box = active.getBoundingClientRect();
            const area = scroller.getBoundingClientRect();
            if (box.top < area.top + 8) scroller.scrollTop += box.top - area.top - 8;
            else if (box.top + Math.min(box.height, 44) > area.bottom - 8)
              scroller.scrollTop += box.top + Math.min(box.height, 44) - area.bottom + 8;
          }
        }
      });
    };
    const rotate = () => {
      fullHeight = window.innerHeight;
      update();
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', rotate);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', rotate);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      document.documentElement.classList.remove('keyboard-open');
    };
  }, []);
}

let locks = 0;
let restore: (() => void) | undefined;
export function lockDialogPage() {
  if (locks++ === 0) {
    const body = document.body;
    const y = window.scrollY;
    const properties = ['position', 'top', 'width'];
    const old = properties.map((name) => ({
      name,
      value: body.style.getPropertyValue(name),
      priority: body.style.getPropertyPriority(name),
    }));
    // Radix's scroll lock sets position: relative !important. Override it so
    // iOS cannot pan the background behind the focused field.
    body.style.setProperty('position', 'fixed', 'important');
    body.style.setProperty('top', `-${y}px`, 'important');
    body.style.setProperty('width', '100%', 'important');
    restore = () => {
      old.forEach(({ name, value, priority }) => body.style.setProperty(name, value, priority));
      window.scrollTo({ top: y, behavior: 'instant' });
    };
  }
  return () => {
    if (--locks === 0) {
      restore?.();
      restore = undefined;
    }
  };
}
