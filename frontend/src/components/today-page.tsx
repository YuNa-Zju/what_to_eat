import { useEffect, useRef, useState } from 'react';
import { MealCost } from './meal-cost';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Pencil,
  Plus,
  Settings2,
  Share2,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { FormModal } from './dialogs';
import { BowlMark, DiceGlyph, MealIllustration } from './food-art';
import { pickWeighted, restaurantPreferences } from '@/lib/preferences';
import { candidates, orderedMeals, recentDistinct } from '@/lib/meals';
import { cn } from '@/lib/utils';
import type { Meal, Mode, Restaurant } from '@/lib/types';

export function TodayPage({
  restaurants,
  meals,
  mode,
  size,
  ready,
  onMode,
  onRecord,
  onEdit,
  onDelete,
  onShare,
  onViewPosts,
  onWindow,
}: {
  restaurants: Restaurant[];
  meals: Meal[];
  mode: Mode;
  size: number;
  ready: boolean;
  onMode: (mode: Mode) => void;
  onRecord: (id?: string) => void;
  onEdit: (meal: Meal) => void;
  onDelete: (meal: Meal) => void;
  onShare: (meal: Meal) => void;
  onViewPosts: (meal: Meal) => void;
  onWindow: (size: number) => Promise<void>;
}) {
  const pool = candidates(restaurants, meals, size);
  const recent = recentDistinct(meals, size);
  const name = (id: string) => restaurants.find((r) => r.id === id)?.name || '已不可用的饭店';
  const [chosen, setChosen] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyCount, setHistoryCount] = useState(10);
  const [rolling, setRolling] = useState(false);
  const [reel, setReel] = useState({ name: '', frame: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const availableIds = useRef(new Set<string>());
  availableIds.current = new Set(pool.map((r) => r.id));
  const preferences = restaurantPreferences(restaurants, meals, size);
  useEffect(() => {
    setChosen(null);
    setRolling(false);
    if (timer.current) clearTimeout(timer.current);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [mode]);
  useEffect(() => {
    if (chosen && !pool.some((r) => r.id === chosen)) setChosen(null);
  }, [chosen, pool]);
  function draw() {
    if (rolling) return;
    const result = pickWeighted(preferences);
    if (!result) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setChosen(result.id);
      return;
    }
    setRolling(true);
    let step = 0;
    const advance = () => {
      if (step === 13) {
        setRolling(false);
        setChosen(availableIds.current.has(result.id) ? result.id : null);
        timer.current = null;
        return;
      }
      setReel({ name: pool[Math.floor(Math.random() * pool.length)].name, frame: step++ });
      timer.current = setTimeout(advance, 55 + step * 9);
    };
    advance();
  }
  return (
    <div className="space-y-9">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow mb-3">A LITTLE LESS INDECISION</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            今天，也要好好吃饭。
          </h1>
        </div>
        <div
          className="flex self-start rounded-full border bg-surface p-1"
          role="group"
          data-tour="dining-mode"
          aria-label="用餐模式"
        >
          {(['shared', 'local'] as const).map((value) => (
            <Button
              key={value}
              variant={mode === value ? 'default' : 'ghost'}
              aria-pressed={mode === value}
              className="min-h-11 rounded-full px-5"
              onClick={() => onMode(value)}
            >
              {value === 'shared' ? '我们聚餐' : '我自己吃'}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card className="meal-hero relative overflow-hidden shadow-none">
          <MealIllustration className="pointer-events-none absolute -right-3 top-12 w-36 opacity-30 sm:right-2 sm:w-48 sm:opacity-45" />
          <CardContent className="relative flex min-h-80 flex-col items-start justify-between p-6 sm:p-9">
            <div className="flex w-full items-center justify-between">
              <Badge
                variant="outline"
                className="border-primary/15 bg-surface/60 px-3 py-1.5 font-normal text-primary"
              >
                <BowlMark className="mr-1.5 size-4" />
                下一顿，换点口味
              </Badge>
              <span className="text-xs text-muted-foreground">{pool.length} 家待选</span>
            </div>
            <div className="my-7 w-full min-w-0">
              <p className="mb-2 text-sm text-muted-foreground">
                {rolling ? '好吃的名字，正在路过…' : chosen ? '这次不妨去' : '把选择交给一点点运气'}
              </p>
              <div className="min-h-[3.2rem] overflow-hidden">
                <h2
                  key={rolling ? `roll-${reel.frame}` : chosen || 'empty'}
                  aria-hidden={rolling || undefined}
                  className={cn(
                    'break-words text-3xl font-semibold leading-snug tracking-tight sm:text-4xl',
                    rolling ? 'reel-name' : chosen && 'reel-settled',
                  )}
                >
                  {rolling ? reel.name : chosen ? name(chosen) : '今天吃什么？'}
                </h2>
              </div>
              <span className="sr-only" role="status">
                {rolling ? '正在抽选餐厅' : chosen ? `这次推荐：${name(chosen)}` : ''}
              </span>
            </div>
            <div className="flex w-full flex-wrap gap-3">
              <Button
                className="min-h-12 flex-1 px-5 sm:flex-none"
                data-tour="draw"
                onClick={draw}
                disabled={!ready || pool.length === 0 || rolling}
              >
                <DiceGlyph className="mr-2 size-5" rolling={rolling} />
                {rolling ? '正在挑选…' : chosen ? '再摇一次' : '帮我选一家'}
              </Button>
              {chosen ? (
                <Button
                  variant="outline"
                  className="min-h-12 flex-1 border-primary/20 bg-surface/70 px-5 sm:flex-none"
                  data-tour="record-meal"
                  onClick={() => onRecord(chosen)}
                  disabled={rolling}
                >
                  <Check className="mr-2 size-4" />
                  今天吃这家
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  className="min-h-12 flex-1 px-5 sm:flex-none"
                  disabled={!ready || rolling}
                  data-tour="record-meal"
                  onClick={() => onRecord()}
                >
                  我来选
                  <ArrowRight className="ml-2 size-4" />
                </Button>
              )}
            </div>
            {ready && pool.length === 0 && (
              <p role="status" className="mt-4 text-sm text-primary">
                暂无可选饭店
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="flex h-full flex-col p-6 sm:p-7">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">留一点期待</h2>
              </div>
              <span className="text-2xl font-light text-primary">
                {pool.length.toString().padStart(2, '0')}
              </span>
            </div>
            <div className="my-5 flex max-h-44 flex-wrap content-start gap-2 overflow-y-auto horizontal-scroll">
              {pool.map((r) => (
                <button
                  key={r.id}
                  title={`当前抽中概率 ${((preferences.find((row) => row.id === r.id)?.probability || 0) * 100).toFixed(1)}%`}
                  onClick={() => onRecord(r.id)}
                  className="min-h-11 rounded-full border bg-background px-4 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-accent"
                >
                  {r.name}
                </button>
              ))}
              {!ready && <p className="text-sm text-muted-foreground">正在载入饭店名单…</p>}
            </div>
          </CardContent>
        </Card>
      </div>
      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">最近吃过</h2>
            <p className="mt-1 text-xs text-muted-foreground">窗口：{size} 家</p>
          </div>
          <Button
            variant="ghost"
            className="touch-button shrink-0 text-muted-foreground"
            data-tour="window"
            onClick={() => setSettingsOpen(true)}
            disabled={!ready}
          >
            <Settings2 className="mr-1.5 size-4" />
            调整窗口
          </Button>
        </div>
        {recent.length ? (
          <div className="flex gap-3 overflow-x-auto pb-2 horizontal-scroll">
            {recent.map((meal, index) => (
              <div
                key={meal.id}
                className="min-w-40 max-w-56 shrink-0 rounded-xl border bg-surface p-4 sm:min-w-44"
              >
                <span className="text-xs text-muted-foreground">
                  {index === 0 ? '最近的一顿' : `之前第 ${index + 1} 家`}
                </span>
                <p className="my-3 break-words font-medium">{name(meal.restaurant_id)}</p>
                <p className="text-xs text-muted-foreground">{meal.eaten_on}</p>
                {meal.cost_cents != null && (
                  <div className="mt-2">
                    <MealCost cents={meal.cost_cents} />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed px-5 py-8 text-center text-sm text-muted-foreground">
            暂无用餐记录
          </div>
        )}
      </section>
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock3 className="size-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">一顿一顿的小记录</h2>
          </div>
          <Button
            variant="outline"
            className="touch-button"
            disabled={!ready}
            onClick={() => onRecord()}
          >
            <Plus className="mr-1.5 size-4" />
            记一顿
          </Button>
        </div>
        <a
          href="#history"
          className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm text-primary"
        >
          查看完整历史与喜好统计
          <ArrowRight className="size-4" />
        </a>
        <div className="overflow-hidden rounded-xl border bg-surface">
          {orderedMeals(meals)
            .slice(0, historyCount)
            .map((meal) => (
              <div
                key={meal.id}
                className="flex items-center justify-between gap-2 border-b px-4 py-3 last:border-b-0 sm:px-5"
              >
                <button
                  type="button"
                  onClick={() => onViewPosts(meal)}
                  className="min-w-0 flex-1 rounded-lg py-1 text-left hover:text-primary"
                  aria-label={`查看 ${meal.eaten_on} ${name(meal.restaurant_id)} 的关联分享`}
                >
                  <p className="break-words text-sm font-medium">{name(meal.restaurant_id)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{meal.eaten_on} · 查看分享</p>
                  {meal.cost_cents != null && (
                    <div className="mt-2">
                      <MealCost cents={meal.cost_cents} />
                    </div>
                  )}
                </button>
                <div className="flex shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="touch-button"
                    aria-label={`分享 ${name(meal.restaurant_id)} 这顿饭`}
                    onClick={() => onShare(meal)}
                  >
                    <Share2 className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="touch-button"
                    aria-label="修改用餐记录"
                    onClick={() => onEdit(meal)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="touch-button text-muted-foreground"
                    aria-label="删除用餐记录"
                    onClick={() => onDelete(meal)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          {!meals.length && (
            <p className="p-7 text-center text-sm text-muted-foreground">暂无用餐记录</p>
          )}
        </div>
        {meals.length > historyCount && (
          <Button
            variant="ghost"
            className="mt-3 w-full"
            onClick={() => setHistoryCount((n) => n + 20)}
          >
            再看一些记录
            <ChevronDown className="ml-2 size-4" />
          </Button>
        )}
      </section>
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
