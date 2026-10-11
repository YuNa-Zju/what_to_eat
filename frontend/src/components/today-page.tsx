import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ListFilter,
  LocateFixed,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { FormModal } from './dialogs';
import { DiceGlyph } from './food-art';
import { MenuDoodle } from './menu-doodle';
import { ModeSwitch, PageHeading } from './menu-layout';
import type { MealWindow } from '@/lib/meals';
import { pickWeighted, restaurantPreferences } from '@/lib/preferences';
import { formatDistance, validLocation } from '@/lib/distance';
import { cn } from '@/lib/utils';
import type { Meal, Mode, Restaurant, RestaurantLocation } from '@/lib/types';

const noAdditionalWindows: MealWindow[] = [];

export function TodayPage({
  restaurants,
  meals,
  mode,
  size,
  additional = noAdditionalWindows,
  ready,
  visible = true,
  onMode,
  onRecord,
  onWindow,
}: {
  restaurants: Restaurant[];
  meals: Meal[];
  mode: Mode;
  size: number;
  additional?: MealWindow[];
  ready: boolean;
  visible?: boolean;
  onMode: (mode: Mode) => void;
  onRecord: (id?: string) => void;
  onWindow: (size: number) => Promise<void>;
}) {
  const [origin, setOrigin] = useState<RestaurantLocation | null>(null);
  const [distanceOpen, setDistanceOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const locationRequest = useRef(0);
  const locationAbort = useRef<AbortController | null>(null);
  const preferences = useMemo(
    () => restaurantPreferences(restaurants, meals, size, additional, origin),
    [restaurants, meals, size, additional, origin],
  );
  const { pool, excluded, byId, locatedCount, availableKey } = useMemo(() => {
    const pool = preferences.filter((row) => row.eligible);
    return {
      pool,
      excluded: preferences.filter((row) => !row.eligible),
      byId: new Map(preferences.map((row) => [row.id, row])),
      locatedCount: pool.filter((row) => validLocation(row.location)).length,
      availableKey: pool.map((row) => row.id).join(','),
    };
  }, [preferences]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false);
  const [run, setRun] = useState<{ names: string[]; result: string } | null>(null);
  const [panel, setPanel] = useState<'available' | 'excluded' | null>(null);
  const [search, setSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  useEffect(() => {
    if (!visible) closeDistance();
    return () => {
      locationRequest.current++;
      locationAbort.current?.abort();
    };
  }, [visible]);
  useEffect(() => {
    if (!origin) return;
    // Do not keep using a departure point after the user has had time to move.
    const timer = setTimeout(() => setOrigin(null), 15 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [origin]);
  function closeDistance() {
    locationRequest.current++;
    locationAbort.current?.abort();
    setLocating(false);
    setDistanceOpen(false);
    setLocationError('');
  }
  async function locate() {
    if (locating) return;
    const request = ++locationRequest.current;
    locationAbort.current?.abort();
    const controller = new AbortController();
    locationAbort.current = controller;
    setLocating(true);
    setLocationError('');
    try {
      const { locateForRecommendation } = await import('@/lib/amap');
      if (request !== locationRequest.current) return;
      const point = await locateForRecommendation(controller.signal);
      if (request !== locationRequest.current) return;
      setOrigin(point);
      closeDistance();
    } catch (error) {
      if (request === locationRequest.current)
        setLocationError(error instanceof Error ? error.message : '定位失败，请重试');
    } finally {
      if (request === locationRequest.current) setLocating(false);
    }
  }
  useEffect(() => {
    animation.current?.cancel();
    setRolling(false);
    setRun(null);
    setChosen(null);
  }, [mode, availableKey]);
  useEffect(() => {
    if (!visible && rolling) {
      animation.current?.cancel();
      setRolling(false);
      setRun(null);
      setChosen(null);
    }
  }, [visible]);
  useLayoutEffect(() => {
    if (!run || !strip.current || !viewport.current) return;
    const node = strip.current;
    const end = () =>
      `translateY(-${(run.names.length - 1) * (viewport.current?.clientHeight || 0)}px)`;
    node.style.transform = 'translateY(0)';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const motion = node.animate([{ transform: 'translateY(0)' }, { transform: end() }], {
      duration: reduced ? 1 : 1600,
      easing: 'cubic-bezier(.12,.72,.12,1)',
      fill: 'forwards',
    });
    animation.current = motion;
    motion.onfinish = () => {
      node.style.transform = end();
      motion.cancel();
      setChosen(run.result);
      setRolling(false);
    };
    let height = viewport.current.clientHeight;
    const observer = new ResizeObserver(() => {
      const next = viewport.current?.clientHeight;
      if (next && next !== height) {
        height = next;
        if (motion.playState === 'running') motion.finish();
        else node.style.transform = end();
      }
    });
    observer.observe(viewport.current);
    return () => {
      observer.disconnect();
      motion.cancel();
    };
  }, [run]);
  function draw() {
    if (rolling) return;
    const result = pickWeighted(preferences);
    if (!result) return;
    const previous = byId.get(chosen ?? '')?.name || '今天吃什么';
    const names = [
      previous,
      ...Array.from({ length: 14 }, () => pool[Math.floor(Math.random() * pool.length)].name),
      result.name,
    ];
    setRolling(true);
    setRun({ names, result: result.id });
  }
  const selected = byId.get(chosen ?? '');
  const selectedDistance = selected?.distanceKm;
  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return (panel === 'excluded' ? excluded : pool).filter((row) =>
      row.name.toLocaleLowerCase().includes(term),
    );
  }, [panel, excluded, pool, search]);
  return (
    <div className="choose-menu">
      <PageHeading
        number="01"
        title="今天吃什么"
        accessory={<ModeSwitch mode={mode} onChange={onMode} tour />}
      />
      <section className="daily-special" aria-label="今日推荐">
        <MenuDoodle active={visible} />
        <div className="special-margin">
          <span className="menu-kicker">今日推荐</span>
          <span className="menu-edition">
            {new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(
              new Date(),
            )}
          </span>
        </div>
        <div className="special-main">
          <div className="special-topline">
            <span>{mode === 'shared' ? '我们的聚餐菜单' : '我的今日菜单'}</span>
            <span>{String(pool.length).padStart(2, '0')} 家待选</span>
          </div>
          <div className="reel-window" ref={viewport} aria-hidden="true">
            {run ? (
              <div ref={strip} className="menu-reel">
                {run.names.map((name, i) => (
                  <div key={i} className="reel-row">
                    <span>{name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="reel-row">
                <span>
                  把下一顿，
                  <br />
                  交给一点运气。
                </span>
              </div>
            )}
          </div>
          <div role="status" className="sr-only">
            {rolling ? '正在抽选饭店' : selected ? `推荐：${selected.name}` : ''}
          </div>
          <div className="special-bottomline">
            {chosen && <span className="menu-stamp">就吃这家</span>}
            {selected?.address && (
              <span className="truncate text-sm text-muted-foreground">{selected.address}</span>
            )}
            {!rolling && selectedDistance != null && (
              <span className="shrink-0 text-xs text-muted-foreground">
                直线{formatDistance(selectedDistance)}
              </span>
            )}
          </div>
          <div className="special-actions">
            <Button
              className="draw-button"
              data-tour="draw"
              disabled={!ready || !pool.length || rolling || locating}
              onClick={draw}
            >
              <DiceGlyph rolling={rolling} className="size-6" />
              {rolling ? '正在挑选' : chosen ? '再摇一次' : '帮我选一家'}
            </Button>
            {chosen ? (
              <Button
                variant="outline"
                data-tour="record-meal"
                className="min-h-12 gap-2"
                disabled={rolling}
                onClick={() => onRecord(chosen)}
              >
                <Check className="size-4" />
                今天吃这家
              </Button>
            ) : (
              <Button
                variant="ghost"
                data-tour="record-meal"
                className="min-h-12 gap-2"
                disabled={!ready || rolling}
                onClick={() => onRecord()}
              >
                <Plus className="size-4" />
                记一顿
              </Button>
            )}
          </div>
          {ready && !pool.length && (
            <div role="status" className="empty-candidates">
              暂时没有可抽选的饭店。<button onClick={() => setSettingsOpen(true)}>调整窗口</button>
              <a href="#places">管理饭店</a>
            </div>
          )}
        </div>
      </section>
      <div className="choose-quiet-tools">
        <button
          onClick={() => {
            setSearch('');
            setPanel('available');
          }}
          disabled={!ready || rolling}
        >
          自己选一家 <ArrowRight className="size-4" />
        </button>
        <button
          data-tour="window"
          onClick={() => setOptionsOpen(true)}
          disabled={!ready || rolling}
        >
          <Settings2 className="size-4" />
          选餐偏好
          {origin && <span className="preference-dot" aria-label="已考虑距离" />}
        </button>
      </div>
      {optionsOpen && (
        <FormModal title="这一顿，怎么选" onClose={() => setOptionsOpen(false)}>
          <div className="choose-options">
            <button
              onClick={() => {
                setOptionsOpen(false);
                setSearch('');
                setPanel('available');
              }}
            >
              <ListFilter className="size-5" />
              <span>候选饭店</span>
              <small>{pool.length} 家</small>
              <ArrowRight className="size-4" />
            </button>
            <button
              onClick={() => {
                setOptionsOpen(false);
                setSearch('');
                setPanel('excluded');
              }}
            >
              <span className="size-5 text-center" aria-hidden="true">
                ↺
              </span>
              <span>近期先换换口味</span>
              <small>{excluded.length} 家</small>
              <ArrowRight className="size-4" />
            </button>
            <button
              onClick={() => {
                setOptionsOpen(false);
                setSettingsOpen(true);
              }}
            >
              <Settings2 className="size-5" />
              <span>{mode === 'local' ? '个人窗口' : '聚餐窗口'}</span>
              <small>{size} 家</small>
              <ArrowRight className="size-4" />
            </button>
            <button
              onClick={() => {
                setOptionsOpen(false);
                setDistanceOpen(true);
              }}
            >
              <LocateFixed className="size-5" />
              <span>考虑距离</span>
              <small>{origin ? '已开启' : '未开启'}</small>
              <ArrowRight className="size-4" />
            </button>
          </div>
        </FormModal>
      )}
      {distanceOpen && (
        <FormModal title="把距离也考虑进去" onClose={closeDistance}>
          <div className="space-y-5 py-2">
            <p className="text-sm leading-7 text-muted-foreground">
              近一些的饭店，机会稍多一点。仍以你的用餐喜好为主，最近吃过的继续避开。
            </p>
            <p className="text-xs leading-6 text-muted-foreground">
              按直线距离估算；未标位置的饭店保持原权重。当前位置仅留在本次页面，15 分钟后失效。
            </p>
            {locatedCount ? (
              <p className="text-sm">{locatedCount} 家候选饭店已标位置</p>
            ) : (
              <p className="text-sm">
                候选饭店还没有位置，先去
                <a
                  href="#places"
                  onClick={closeDistance}
                  className="ml-1 text-primary underline underline-offset-4"
                >
                  标记饭店
                </a>
                。
              </p>
            )}
            {locationError && (
              <p role="alert" className="text-sm text-destructive">
                {locationError}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => void locate()}
                disabled={locating || !locatedCount}
                className="min-h-12 flex-1 gap-2"
              >
                {locating ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <LocateFixed className="size-4" />
                )}
                {locating ? '正在定位…' : origin ? '更新当前位置' : '使用当前位置'}
              </Button>
              {origin && (
                <Button
                  variant="outline"
                  className="min-h-12"
                  onClick={() => {
                    setOrigin(null);
                    closeDistance();
                  }}
                >
                  不考虑距离
                </Button>
              )}
            </div>
          </div>
        </FormModal>
      )}
      {panel && (
        <FormModal
          title={panel === 'available' ? '今天的候选菜单' : '近期先换换口味'}
          onClose={() => setPanel(null)}
        >
          <div className="relative my-4">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              autoFocus
              placeholder="搜索饭店"
              aria-label="搜索候选饭店"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="max-h-[50dvh] overflow-auto">
            {rows.map((row, i) => (
              <button
                key={row.id}
                className="candidate-row"
                onClick={() => {
                  setPanel(null);
                  onRecord(row.id);
                }}
              >
                <span className="menu-index">{String(i + 1).padStart(2, '0')}</span>
                <span>{row.name}</span>
                <span className="ml-auto flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
                  {row.distanceKm != null && <span>{formatDistance(row.distanceKm)}</span>}
                  <span>
                    {panel === 'available' ? `${(row.probability * 100).toFixed(1)}%` : '记一顿'}
                  </span>
                </span>
              </button>
            ))}
            {!rows.length && (
              <p className="py-10 text-center text-sm text-muted-foreground">没有匹配的饭店</p>
            )}
          </div>
        </FormModal>
      )}
      {settingsOpen && (
        <WindowDialog
          size={size}
          mode={mode}
          onClose={() => setSettingsOpen(false)}
          onSave={onWindow}
        />
      )}
    </div>
  );
}
function WindowDialog({
  size,
  mode,
  onClose,
  onSave,
}: {
  size: number;
  mode: Mode;
  onClose: () => void;
  onSave: (size: number) => Promise<void>;
}) {
  const [value, setValue] = useState(String(size));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <FormModal
      title={mode === 'shared' ? '聚餐窗口' : '个人窗口'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const n = Number(value);
            if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error('请输入 1–100 的整数');
            await onSave(n);
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : '保存失败');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block space-y-2 text-sm">
          避开最近几家饭店
          <Input
            type="number"
            min={1}
            max={100}
            step={1}
            required
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-2 min-h-12"
          />
        </label>
        <div className="flex gap-2">
          {[3, 5, 7, 10].map((n) => (
            <Button
              key={n}
              type="button"
              variant={Number(value) === n ? 'default' : 'outline'}
              className={cn('touch-button flex-1')}
              onClick={() => setValue(String(n))}
            >
              {n} 家
            </Button>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button className="min-h-12 w-full" disabled={busy}>
          {busy ? '保存中…' : '保存设置'}
        </Button>
      </form>
    </FormModal>
  );
}
