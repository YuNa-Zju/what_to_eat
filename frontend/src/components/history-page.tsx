import { Fragment, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Heart, MapPin, Pencil, Plus, Share2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { MealIllustration, MealTrend } from './food-art';
import { ratingText } from './meal-rating';
import { orderedMeals } from '@/lib/meals';
import { preferenceLabel, restaurantPreferences } from '@/lib/preferences';
import type { Meal, Mode, Restaurant } from '@/lib/types';

export function HistoryPage({
  restaurants,
  meals,
  mode,
  size,
  onMode,
  onRecord,
  onEdit,
  onDelete,
  onShare,
}: {
  restaurants: Restaurant[];
  meals: Meal[];
  mode: Mode;
  size: number;
  onMode: (mode: Mode) => void;
  onRecord: () => void;
  onEdit: (meal: Meal) => void;
  onDelete: (meal: Meal) => void;
  onShare: (meal: Meal) => void;
}) {
  const [restaurant, setRestaurant] = useState('');
  const [rating, setRating] = useState('all');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [limit, setLimit] = useState(30);
  const stats = restaurantPreferences(restaurants, meals, size).sort(
    (a, b) => b.visits - a.visits || b.weight - a.weight || a.name.localeCompare(b.name, 'zh-CN'),
  );
  const filtered = orderedMeals(meals).filter(
    (meal) =>
      (!restaurant || meal.restaurant_id === restaurant) &&
      (!start || meal.eaten_on >= start) &&
      (!end || meal.eaten_on <= end) &&
      (rating === 'all' ||
        (rating === 'unrated' ? meal.rating == null : meal.rating === Number(rating))),
  );
  useEffect(() => setLimit(30), [restaurant, rating, start, end, mode]);
  const name = (id: string) => restaurants.find((r) => r.id === id)?.name || '已不可用的饭店';
  const timeline = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const day = new Date();
        day.setHours(12, 0, 0, 0);
        day.setDate(day.getDate() - 13 + i);
        const label = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        return { label, count: meals.filter((meal) => meal.eaten_on === label).length };
      }),
    [meals],
  );
  const mostVisited = stats.find((row) => row.visits > 0);
  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow mb-3">EVERY MEAL, A LITTLE MEMORY</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            一顿一顿，都是好时光。
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            完整记录每一顿，也慢慢了解我们喜欢的味道。
          </p>
        </div>
        <div
          className="flex self-start rounded-full border bg-white p-1"
          role="group"
          aria-label="历史记录范围"
        >
          {(['shared', 'local'] as const).map((value) => (
            <Button
              key={value}
              variant={mode === value ? 'default' : 'ghost'}
              className="min-h-11 rounded-full px-5"
              aria-pressed={mode === value}
              onClick={() => onMode(value)}
            >
              {value === 'shared' ? '我们聚餐' : '我自己吃'}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: '好好吃过', value: `${meals.length} 顿`, icon: CalendarDays },
          {
            label: '走过的饭店',
            value: `${new Set(meals.map((m) => m.restaurant_id)).size} 家`,
            icon: MapPin,
          },
          {
            label: '给过的喜欢',
            value: `${meals.filter((m) => m.rating === 1).length} 次`,
            icon: Heart,
          },
          { label: '最常去的地方', value: mostVisited?.name || '等待第一顿', icon: MapPin },
        ].map((item) => (
          <Card key={item.label} className="shadow-none">
            <CardContent className="p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
                <item.icon className="size-4 text-primary/70" />
                {item.label}
              </div>
              <p className="break-words text-lg font-semibold sm:text-xl">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section className="min-w-0 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">用餐时间线</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                全部历史一直保留，窗口只影响下一次推荐
              </p>
            </div>
            <Button className="touch-button" onClick={onRecord}>
              <Plus className="mr-1.5 size-4" />
              记一顿
            </Button>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-3 rounded-xl border bg-card p-4">
            <label className="space-y-1.5 text-xs text-muted-foreground">
              饭店
              <select
                className="field"
                value={restaurant}
                onChange={(e) => setRestaurant(e.target.value)}
              >
                <option value="">所有饭店</option>
                {restaurants.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-xs text-muted-foreground">
              用餐评价
              <select className="field" value={rating} onChange={(e) => setRating(e.target.value)}>
                <option value="all">全部评价</option>
                <option value="1">喜欢</option>
                <option value="0">一般</option>
                <option value="-1">不喜欢</option>
                <option value="unrated">未评价</option>
              </select>
            </label>
            <label className="min-w-0 space-y-1.5 text-xs text-muted-foreground">
              开始日期
              <Input
                className="min-h-11 min-w-0 bg-white"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="min-w-0 space-y-1.5 text-xs text-muted-foreground">
              结束日期
              <Input
                className="min-h-11 min-w-0 bg-white"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
            {(restaurant || start || end || rating !== 'all') && (
              <Button
                variant="ghost"
                className="col-span-2 text-muted-foreground"
                onClick={() => {
                  setRestaurant('');
                  setRating('all');
                  setStart('');
                  setEnd('');
                }}
              >
                清除筛选 · 当前 {filtered.length} 条
              </Button>
            )}
            {start && end && start > end && (
              <p role="alert" className="col-span-2 text-xs text-destructive">
                开始日期不能晚于结束日期。
              </p>
            )}
          </div>
          <div>
            {filtered.slice(0, limit).map((meal, index) => (
              <Fragment key={meal.id}>
                {(index === 0 ||
                  filtered[index - 1].eaten_on.slice(0, 7) !== meal.eaten_on.slice(0, 7)) && (
                  <h3 className="mb-3 mt-6 flex items-center gap-2 text-sm font-medium">
                    <span className="size-2 rounded-full bg-primary/50" />
                    {meal.eaten_on.slice(0, 7).replace('-', ' 年 ')} 月
                  </h3>
                )}
                <article className="ml-1 border-l border-primary/15 pb-3 pl-4">
                  <div className="rounded-xl border bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="mb-1 text-xs text-muted-foreground">{meal.eaten_on}</p>
                        <h4 className="break-words font-medium">{name(meal.restaurant_id)}</h4>
                      </div>
                      <Badge variant="secondary" className="shrink-0 font-normal">
                        {ratingText(meal.rating)}
                      </Badge>
                    </div>
                    <div className="mt-3 flex items-center justify-end border-t pt-2">
                      <Button
                        variant="ghost"
                        className="touch-button mr-auto gap-1.5 text-xs text-muted-foreground"
                        onClick={() => onEdit(meal)}
                      >
                        <Pencil className="size-3.5" />
                        {meal.rating == null ? '补个评价' : '修改记录'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="touch-button"
                        aria-label="分享这顿饭"
                        onClick={() => onShare(meal)}
                      >
                        <Share2 className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="touch-button text-muted-foreground"
                        aria-label="删除这条用餐记录"
                        onClick={() => onDelete(meal)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </article>
              </Fragment>
            ))}
          </div>
          {!filtered.length && (
            <div className="flex flex-col items-center rounded-2xl border border-dashed py-8">
              <MealIllustration className="h-36 w-44 opacity-80" />
              <p className="text-sm text-muted-foreground">
                {meals.length ? '这个范围里还没有记录，换个筛选试试。' : '第一顿，从今天开始记。'}
              </p>
            </div>
          )}
          {filtered.length > limit && (
            <Button
              variant="outline"
              className="min-h-12 w-full"
              onClick={() => setLimit((value) => value + 30)}
            >
              再看 30 条 · 共 {filtered.length} 条
            </Button>
          )}
        </section>
        <aside className="min-w-0 space-y-5">
          <Card className="shadow-none">
            <CardContent className="p-5">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="font-semibold">最近两周</h2>
                <span className="text-xs text-muted-foreground">
                  {timeline.reduce((sum, day) => sum + day.count, 0)} 顿饭的日常
                </span>
              </div>
              <MealTrend counts={timeline} />
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>{timeline[0].label.slice(5)}</span>
                <span>今天</span>
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-none">
            <CardContent className="p-5">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold">慢慢懂你的口味</h2>
                <Heart className="size-4 text-primary/70" />
              </div>
              <p className="text-xs leading-6 text-muted-foreground">
                评价影响最大，常去的店获得少量加成。新店也一直有机会。
              </p>
              <div className="mt-4 max-h-[34rem] space-y-4 overflow-y-auto pr-1 horizontal-scroll">
                {stats
                  .filter((row) => row.active || row.visits > 0)
                  .map((row) => (
                    <div key={row.id} className="border-t pt-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium">{row.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {row.visits} 顿 · {preferenceLabel(row)}
                          </p>
                        </div>
                        <span className="shrink-0 text-right text-sm font-medium tabular-nums text-primary">
                          {row.eligible
                            ? `${(row.probability * 100).toFixed(1)}%`
                            : row.active
                              ? '最近吃过'
                              : '已停用'}
                        </span>
                      </div>
                      <div className="my-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#eac174] to-[#b96b2d] transition-[width] duration-500"
                          style={{
                            width: `${row.eligible ? Math.max(2, row.probability * 100) : 0}%`,
                          }}
                        />
                      </div>
                      <p className="text-[11px] leading-5 text-muted-foreground">
                        喜欢 {row.likes} · 一般 {row.neutral} · 不喜欢 {row.dislikes}{' '}
                        <span className="float-right">权重 ×{row.weight.toFixed(2)}</span>
                      </p>
                    </div>
                  ))}
              </div>
              <details className="mt-5 border-t pt-3 text-xs leading-6 text-muted-foreground">
                <summary className="cursor-pointer py-1 text-primary">推荐概率怎么算？</summary>
                <p className="pt-2">
                  先排除最近 {size}{' '}
                  家，再根据全部历史中的评价与到访次数温和调整权重。喜欢越多，机会略高；不喜欢越多，机会略低。没有评价按基础权重开始，不会因为早期数据少就被永久排除。这里显示当前候选池的下一次抽中概率，分享的赞踩不参与计算。
                </p>
              </details>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
