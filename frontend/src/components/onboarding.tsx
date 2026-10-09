import { createContext, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { Button } from './ui/button';

const STORAGE_KEY = 'what-to-eat:onboarding:v1';
export const TutorialContext = createContext(false);

export function needsOnboarding() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'seen';
  } catch {
    return true;
  }
}

export function rememberOnboarding() {
  try {
    localStorage.setItem(STORAGE_KEY, 'seen');
  } catch {
    // A browser that disallows storage can still use and dismiss the guide.
  }
}

const steps = [
  {
    page: 'choose',
    target: 'dining-mode',
    title: '先选，这顿饭和谁吃',
    description: (
      <>
        点这两个按钮试试。<strong>我们聚餐</strong>的历史、评价和窗口在云端共用；
        <strong>我自己吃</strong>
        的记录只存当前浏览器，推荐会同时避开个人和聚餐窗口；换设备不会同步，清除网站数据会丢失。
      </>
    ),
  },
  {
    page: 'choose',
    target: 'draw',
    title: '试着摇一家饭店',
    description: (
      <>
        点击这里，看名字滚动。推荐以用餐评价为主、频率为辅；也能在下方开启「考虑距离」，近一些的饭店机会稍多。摇到结果不会自动记账。
      </>
    ),
  },
  {
    page: 'choose',
    target: 'window',
    title: '最近吃过的，先换一换',
    description: (
      <>
        这里能调整当前模式的窗口：默认避开最近 5 家不同饭店，可设为 1–100
        家。只影响推荐，完整历史一直保留。
      </>
    ),
  },
  {
    page: 'choose',
    target: 'record-meal',
    title: '选好了，就记下这顿饭',
    description: (
      <>
        打开表单，选饭店和日期，花费、评价可选。聚餐填整桌总额，自己吃填本次花费；开启「同时分享到大家的动态」就能顺手发帖。
      </>
    ),
  },
  {
    page: 'feed',
    target: 'share',
    title: '一顿饭，也可以从分享开始',
    description: (
      <>
        这里默认同时记一顿，也能选「仅分享」。昵称可留空，支持 Markdown 和最多 6 张照片。
        <strong>两种用餐模式发布的分享都会公开给大家。</strong>
      </>
    ),
  },
  {
    page: 'feed',
    target: 'feed-filters',
    title: '找找饭友们吃了什么',
    description: (
      <>
        搜索框可查感受、菜名、饭店或昵称。点右边的齿轮，按饭店、饭友、日期筛选或排序；已启用的条件会显示在页面上，点标签即可清除。
      </>
    ),
  },
  {
    page: 'history',
    target: 'history',
    title: '每一顿，都留在用餐历史里',
    description: (
      <>
        页顶切换聚餐或个人历史。点击一条记录可看关联分享，也能从记录补发，不会重复记账；修改聚餐记录会同步关联分享的饭店、日期和花费。
      </>
    ),
    interactive: false,
  },
  {
    page: 'places',
    target: 'manage',
    title: '发现好店，大家一起维护',
    description: (
      <>
        从这里添加饭店；点开条目可改名、上传封面、在地图选点，也可移出或恢复候选。两种模式共用这份名单，大家都能修改。移出候选只退出推荐，历史和分享仍保留。
      </>
    ),
  },
  {
    page: 'choose',
    target: 'help',
    title: '准备好，开始好好吃饭吧',
    description: (
      <>以后想再走一遍，点右上角「使用教程」。手机用底部导航、桌面用左侧目录，随时切换四个页面。</>
    ),
    interactive: false,
  },
];

type Rect = { x: number; y: number; width: number; height: number };
const focusable = 'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

export function Onboarding({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
    top: 0,
  });
  const [panelHeight, setPanelHeight] = useState(260);
  const panel = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLElement | null>(null);
  const openedDialog = useRef(false);
  const origin = useRef(location.hash || '#choose');
  const originalFocus = useRef(document.activeElement as HTMLElement | null);
  const current = steps[step];
  const canInteract = current.interactive !== false;
  const close = useRef(onClose);
  close.current = onClose;

  // A real form temporarily takes over. Closing it continues the tour, without
  // submitting or changing the user's data on their behalf.
  useEffect(() => {
    const checkDialogs = () => {
      const open = !!document.querySelector('[role="dialog"][data-state="open"]');
      setPaused(open);
      if (open) openedDialog.current = true;
      else if (openedDialog.current) {
        openedDialog.current = false;
        setStep((value) => Math.min(value + 1, steps.length - 1));
      }
    };
    const observer = new MutationObserver(checkDialogs);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state'],
    });
    checkDialogs();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!paused && location.hash !== `#${current.page}`) location.hash = current.page;
  }, [current.page, paused]);

  useEffect(() => {
    if (paused) return;
    let frame = 0;
    let located: HTMLElement | null = null;
    const resize = new ResizeObserver(() => schedule());
    const measure = () => {
      frame = 0;
      const view = window.visualViewport;
      const screen = {
        width: view?.width || window.innerWidth,
        height: view?.height || window.innerHeight,
        top: view?.offsetTop || 0,
      };
      setViewport((old) =>
        old.width === screen.width && old.height === screen.height && old.top === screen.top
          ? old
          : screen,
      );
      const candidate = document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`);
      const found = candidate?.getClientRects().length ? candidate : null;
      target.current = found;
      if (found !== located) {
        if (located) resize.unobserve(located);
        located = found;
        if (found) {
          resize.observe(found);
          found.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        }
      }
      if (panel.current) setPanelHeight(panel.current.getBoundingClientRect().height);
      if (!found) {
        setRect(null);
        return;
      }
      const bounds = found.getBoundingClientRect();
      const x = Math.max(8, bounds.left - 6);
      const y = Math.max(screen.top + 8, bounds.top - 6);
      const next = {
        x,
        y,
        width: Math.max(0, Math.min(screen.width - 8, bounds.right + 6) - x),
        height: Math.max(0, Math.min(screen.top + screen.height - 8, bounds.bottom + 6) - y),
      };
      setRect((old) =>
        old &&
        old.x === next.x &&
        old.y === next.y &&
        old.width === next.width &&
        old.height === next.height
          ? old
          : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    if (panel.current) resize.observe(panel.current);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('menu-page-change', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    schedule();
    panel.current?.focus({ preventScroll: true });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('menu-page-change', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [current.target, paused]);

  useEffect(() => {
    if (paused) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const controls = [
        ...(canInteract && target.current
          ? [target.current, ...target.current.querySelectorAll<HTMLElement>(focusable)]
          : []),
        ...Array.from(panel.current?.querySelectorAll<HTMLElement>(focusable) || []),
      ].filter(
        (element) => element.matches(focusable) && element.getBoundingClientRect().width > 0,
      );
      if (!controls.length) return;
      event.preventDefault();
      const index = controls.indexOf(document.activeElement as HTMLElement);
      controls[(index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length].focus({
        preventScroll: true,
      });
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [canInteract, paused]);

  useEffect(
    () => () => {
      if (location.hash !== origin.current) location.hash = origin.current;
      if (originalFocus.current?.isConnected) originalFocus.current.focus({ preventScroll: true });
    },
    [],
  );

  if (paused) return null;
  const width = Math.min(360, viewport.width - 24);
  const bottom = viewport.top + viewport.height;
  const left = rect
    ? clamp(rect.x + rect.width / 2 - width / 2, 12, viewport.width - width - 12)
    : (viewport.width - width) / 2;
  const belowSpace = rect ? bottom - rect.y - rect.height - 28 : 0;
  const aboveSpace = rect ? rect.y - viewport.top - 28 : 0;
  const below = rect && (belowSpace >= panelHeight || belowSpace >= aboveSpace);
  // Short viewports (including a phone keyboard) scroll the explanation instead
  // of covering the highlighted control.
  const maxHeight = Math.min(
    viewport.height - 24,
    rect ? Math.max(96, below ? belowSpace : aboveSpace) : viewport.height - 24,
  );
  const top = rect
    ? below
      ? rect.y + rect.height + 16
      : rect.y - 16 - Math.min(panelHeight, maxHeight)
    : viewport.top + Math.max(12, (viewport.height - panelHeight) / 2);
  const mask = (style: CSSProperties, key: string) => (
    <div
      key={key}
      className="absolute"
      style={style}
      onPointerDown={(event) => event.preventDefault()}
    />
  );
  const cutout = rect && rect.width > 0 && rect.height > 0 ? rect : null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[80]" data-tour-overlay>
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <mask id="tutorial-spotlight">
            <rect width="100%" height="100%" fill="white" />
            {cutout && (
              <rect
                x={cutout.x}
                y={cutout.y}
                width={cutout.width}
                height={cutout.height}
                rx="16"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgb(15 11 7 / 65%)"
          mask="url(#tutorial-spotlight)"
        />
      </svg>
      <div
        className="pointer-events-auto absolute inset-0"
        style={cutout && canInteract ? { pointerEvents: 'none' } : undefined}
        aria-hidden="true"
      >
        {cutout && canInteract && (
          <div className="pointer-events-auto">
            {mask({ left: 0, top: 0, right: 0, height: cutout.y }, 'top')}
            {mask({ left: 0, top: cutout.y + cutout.height, right: 0, bottom: 0 }, 'bottom')}
            {mask({ left: 0, top: cutout.y, width: cutout.x, height: cutout.height }, 'left')}
            {mask(
              { left: cutout.x + cutout.width, right: 0, top: cutout.y, height: cutout.height },
              'right',
            )}
          </div>
        )}
      </div>
      {cutout && (
        <div
          className="absolute rounded-2xl border-2 border-primary shadow-[0_0_0_4px_rgb(255_255_255_/_12%)]"
          style={{ left: cutout.x, top: cutout.y, width: cutout.width, height: cutout.height }}
        />
      )}
      <div
        ref={panel}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tutorial-title"
        aria-describedby="tutorial-description"
        tabIndex={-1}
        className="pointer-events-auto absolute overflow-y-auto rounded-2xl border bg-card p-5 text-card-foreground shadow-2xl outline-none"
        style={{
          left,
          top: Math.max(viewport.top + 12, top),
          width,
          maxHeight,
        }}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-xs font-medium tracking-wide text-primary">
            使用教程 · {step + 1} / {steps.length}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-2 -mt-2 size-11 shrink-0"
            aria-label="退出教程"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>
        <h2 id="tutorial-title" className="mb-2 text-lg font-semibold">
          {current.title}
        </h2>
        <p
          id="tutorial-description"
          className="text-sm leading-7 text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground"
        >
          {current.description}
        </p>
        <div className="mt-4 flex gap-1" aria-hidden="true">
          {steps.map((_, index) => (
            <span
              key={index}
              className={`h-1 flex-1 rounded-full ${index <= step ? 'bg-primary' : 'bg-muted'}`}
            />
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            className="min-h-11 gap-1.5 px-3"
            disabled={step === 0}
            onClick={() => setStep(step - 1)}
          >
            <ArrowLeft className="size-4" />
            上一步
          </Button>
          <Button
            className="min-h-11 gap-1.5 px-4"
            onClick={() => (step === steps.length - 1 ? onClose() : setStep(step + 1))}
          >
            {step === steps.length - 1 ? '开始使用' : '下一步'}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
