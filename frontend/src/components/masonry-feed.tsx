import { Children, useLayoutEffect, useRef, type ReactNode } from 'react';

function MasonryItem({ children }: { children: ReactNode }) {
  const item = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // One-pixel rows allow each new card to fill the shorter column.
        item.current?.style.setProperty(
          '--card-span',
          String(Math.ceil(element.getBoundingClientRect().height) + 20),
        );
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return (
    <div ref={item} className="min-w-0 lg:[grid-row-end:span_var(--card-span,1)]">
      <div ref={content}>{children}</div>
    </div>
  );
}

export function MasonryFeed({ children }: { children: ReactNode }) {
  return (
    <div
      aria-label="用餐分享信息流"
      className="space-y-5 lg:grid lg:auto-rows-[1px] lg:grid-flow-row-dense lg:grid-cols-2 lg:gap-x-5 lg:space-y-0"
    >
      {Children.map(children, (child) => (
        <MasonryItem>{child}</MasonryItem>
      ))}
    </div>
  );
}
