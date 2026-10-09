import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ListFilter, Plus, Search, Settings2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { FormModal } from './dialogs';
import { DiceGlyph } from './food-art';
import { MenuDoodle } from './menu-doodle';
import { ModeSwitch, PageHeading } from './menu-layout';
import { candidates, excludedRestaurants, type MealWindow } from '@/lib/meals';
import { pickWeighted, restaurantPreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import type { Meal, Mode, Restaurant } from '@/lib/types';

export function TodayPage({
  restaurants,
  meals,
  mode,
  size,
  additional = [],
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
  const pool = candidates(restaurants, meals, size, additional);
  const excluded = excludedRestaurants(meals, size, additional);
  const preferences = restaurantPreferences(restaurants, meals, size, additional);
  const [chosen, setChosen] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false);
  const [run, setRun] = useState<{ names: string[]; result: string } | null>(null);
  const [panel, setPanel] = useState<'available' | 'excluded' | null>(null);
  const [search, setSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const availableKey = pool.map((r) => r.id).join(',');
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
    const previous = restaurants.find((r) => r.id === chosen)?.name || '今天吃什么';
    const names = [
      previous,
      ...Array.from({ length: 14 }, () => pool[Math.floor(Math.random() * pool.length)].name),
      result.name,
    ];
    setRolling(true);
    setRun({ names, result: result.id });
  }
  const selected = restaurants.find((r) => r.id === chosen);
  const rows = (panel === 'excluded' ? restaurants.filter((r) => excluded.has(r.id)) : pool).filter(
    (r) => r.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <div className="choose-menu">
      <PageHeading
        number="01"
        title="今天吃什么"
        accessory={<ModeSwitch mode={mode} onChange={onMode} tour />}
      />
      <section className="daily-special" aria-label="今日推荐">
        <MenuDoodle />
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
            <span className="menu-stamp">{chosen ? '就吃这家' : '好好吃饭'}</span>
            {selected?.address && (
              <span className="truncate text-sm text-muted-foreground">{selected.address}</span>
            )}
            <span className="special-rule" />
          </div>
          <div className="special-actions">
            <Button
              className="draw-button"
              data-tour="draw"
              disabled={!ready || !pool.length || rolling}
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
            <Button
              variant="ghost"
              className="min-h-12 gap-2"
              disabled={!ready || rolling}
              onClick={() => {
                setSearch('');
                setPanel('available');
              }}
            >
              自己选
              <ArrowRight className="size-4" />
            </Button>
          </div>
          {ready && !pool.length && (
            <div role="status" className="empty-candidates">
              暂时没有可抽选的饭店。<button onClick={() => setSettingsOpen(true)}>调整窗口</button>
              <a href="#places">管理饭店</a>
            </div>
          )}
        </div>
      </section>
      <div className="menu-footnotes">
        <button
          onClick={() => {
            setSearch('');
            setPanel('available');
          }}
          disabled={!ready}
        >
          <ListFilter className="size-4" />
          候选名单<span>{pool.length}</span>
        </button>
        <button
          onClick={() => {
            setSearch('');
            setPanel('excluded');
          }}
          disabled={!ready}
        >
          近期先不选<span>{excluded.size}</span>
        </button>
        <button data-tour="window" onClick={() => setSettingsOpen(true)} disabled={!ready}>
          <Settings2 className="size-4" />
          窗口设置<span>{mode === 'local' ? `${size} + ${additional[0]?.size || 0}` : size}</span>
        </button>
      </div>
      {panel && (
        <FormModal
          title={panel === 'available' ? '今天的候选菜单' : '近期先换换口味'}
          onClose={() => setPanel(null)}
        >
          <div className="relative my-4">
            <Search className="absolute left-3 top-3.5 size-4 text-muted-foreground" />
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
            {rows.map((r, i) => (
              <button
                key={r.id}
                className="candidate-row"
                onClick={() => {
                  setPanel(null);
                  onRecord(r.id);
                }}
              >
                <span className="menu-index">{String(i + 1).padStart(2, '0')}</span>
                <span>{r.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {panel === 'available'
                    ? `${((preferences.find((p) => p.id === r.id)?.probability || 0) * 100).toFixed(1)}%`
                    : '记一顿'}
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
