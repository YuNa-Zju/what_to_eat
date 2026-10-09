import { Fragment, useEffect, useState } from 'react';
import { ChevronDown, Pencil, Plus, Settings, Share2, Trash2, X } from 'lucide-react';
import { Button } from './ui/button';
import { Choice } from './ui/choice';
import { DatePicker } from './ui/date-picker';
import { FormModal } from './dialogs';
import { ModeSwitch, PageHeading } from './menu-layout';
import { ratingText } from './meal-rating';
import { MealCost } from './meal-cost';
import { MealTrend } from './food-art';
import { orderedMeals } from '@/lib/meals';
import type { Meal, Mode, Restaurant } from '@/lib/types';
const emptyFilters = { restaurant: '', rating: 'all', start: '', end: '' };
export function HistoryPage({
  restaurants,
  meals,
  mode,
  onMode,
  onRecord,
  onEdit,
  onDelete,
  onShare,
  onViewPosts,
}: {
  restaurants: Restaurant[];
  meals: Meal[];
  mode: Mode;
  onMode: (mode: Mode) => void;
  onRecord: () => void;
  onEdit: (meal: Meal) => void;
  onDelete: (meal: Meal) => void;
  onShare: (meal: Meal) => void;
  onViewPosts: (meal: Meal) => void;
}) {
  const [filters, setFilters] = useState(emptyFilters),
    [draft, setDraft] = useState(emptyFilters),
    [open, setOpen] = useState(false),
    [limit, setLimit] = useState(30);
  const { restaurant, rating, start, end } = filters;
  const name = (id: string) => restaurants.find((r) => r.id === id)?.name || '已不可用的饭店';
  const filtered = orderedMeals(meals).filter(
    (m) =>
      (!restaurant || m.restaurant_id === restaurant) &&
      (!start || m.eaten_on >= start) &&
      (!end || m.eaten_on <= end) &&
      (rating === 'all' || (rating === 'unrated' ? m.rating == null : m.rating === Number(rating))),
  );
  useEffect(() => setLimit(30), [restaurant, rating, start, end, mode]);
  const timeline = Array.from({ length: 14 }, (_, i) => {
    const day = new Date();
    day.setHours(12, 0, 0, 0);
    day.setDate(day.getDate() - 13 + i);
    const label = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    return { label, count: meals.filter((m) => m.eaten_on === label).length };
  });
  const chips = [
    restaurant && { key: 'restaurant', text: name(restaurant) },
    rating !== 'all' && {
      key: 'rating',
      text: rating === 'unrated' ? '未评价' : ratingText(Number(rating) as -1 | 0 | 1),
    },
    start && { key: 'start', text: `从 ${start}` },
    end && { key: 'end', text: `至 ${end}` },
  ].filter(Boolean) as { key: keyof typeof filters; text: string }[];
  return (
    <div className="meal-ledger">
      <PageHeading
        number="03"
        title="用餐账本"
        accessory={<ModeSwitch mode={mode} onChange={onMode} />}
      />
      <div className="ledger-toolbar" data-tour="history">
        <span className="text-sm text-muted-foreground">
          共 {meals.length} 顿 · {new Set(meals.map((m) => m.restaurant_id)).size} 家饭店
        </span>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            aria-label="筛选用餐记录"
            onClick={() => {
              setDraft(filters);
              setOpen(true);
            }}
          >
            <Settings className="mr-2 size-4" />
            筛选{chips.length ? ` · ${chips.length}` : ''}
          </Button>
          <Button onClick={onRecord} className="gap-2 min-h-11">
            <Plus className="size-4" />
            记一顿
          </Button>
        </div>
      </div>
      {!!chips.length && (
        <div className="mb-5 flex flex-wrap gap-2">
          {chips.map((c) => (
            <button
              key={c.key}
              className="filter-chip"
              onClick={() => setFilters((f) => ({ ...f, [c.key]: emptyFilters[c.key] }))}
            >
              {c.text}
              <X className="size-3" />
            </button>
          ))}
          <button
            className="px-3 text-xs text-muted-foreground"
            onClick={() => setFilters(emptyFilters)}
          >
            清空全部
          </button>
        </div>
      )}
      <div className="ledger-rows">
        {filtered.slice(0, limit).map((meal, i) => (
          <Fragment key={meal.id}>
            {(i === 0 || filtered[i - 1].eaten_on !== meal.eaten_on) && (
              <h2 className="ledger-date">
                <span>{meal.eaten_on.slice(5).replace('-', ' / ')}</span>
                <span>{meal.eaten_on.slice(0, 4)}</span>
              </h2>
            )}
            <article className="ledger-row">
              <button
                className="ledger-meal"
                onClick={() => onViewPosts(meal)}
                aria-label={`查看 ${meal.eaten_on} ${name(meal.restaurant_id)} 的关联分享`}
              >
                <strong>{name(meal.restaurant_id)}</strong>
                <span className="ledger-rating">{ratingText(meal.rating)}</span>
              </button>
              <div className="ledger-amount">
                {meal.cost_cents != null ? (
                  <MealCost cents={meal.cost_cents} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div className="ledger-actions">
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
                  className="touch-button"
                  aria-label="分享这顿饭"
                  onClick={() => onShare(meal)}
                >
                  <Share2 className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="touch-button"
                  aria-label="删除这条用餐记录"
                  onClick={() => onDelete(meal)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </article>
          </Fragment>
        ))}
      </div>
      {!filtered.length && (
        <div className="menu-empty">
          <span className="font-menu text-5xl text-primary/30">· · ·</span>
          <p>{meals.length ? '没有匹配的记录' : '账本还没有写下第一顿'}</p>
          {!meals.length && (
            <Button variant="outline" onClick={onRecord}>
              记下第一顿
            </Button>
          )}
        </div>
      )}
      {filtered.length > limit && (
        <Button variant="ghost" className="my-5 w-full" onClick={() => setLimit((n) => n + 30)}>
          再看 30 条 · 共 {filtered.length} 条
        </Button>
      )}
      {!!meals.length && (
        <details key={mode} className="ledger-statistics group">
          <summary>
            <span>用餐统计</span>
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="stats-spread">
            <section>
              <h3 className="mb-5 font-medium">最近两周</h3>
              <MealTrend counts={timeline} />
              <div className="mt-3 flex justify-between text-xs text-muted-foreground">
                <span>{timeline[0].label.slice(5)}</span>
                <span>今天</span>
              </div>
            </section>
          </div>
        </details>
      )}
      {open && (
        <FormModal title="筛选用餐记录" onClose={() => setOpen(false)}>
          <div className="my-6 grid grid-cols-2 gap-4">
            <label className="col-span-2 space-y-2 text-sm">
              <span>饭店</span>
              <Choice
                label="筛选饭店"
                value={draft.restaurant}
                onChange={(v) => setDraft((f) => ({ ...f, restaurant: v }))}
                searchable
                options={[
                  { value: '', label: '所有饭店' },
                  ...restaurants.map((r) => ({ value: r.id, label: r.name })),
                ]}
              />
            </label>
            <label className="col-span-2 space-y-2 text-sm">
              <span>评价</span>
              <Choice
                label="用餐评价"
                value={draft.rating}
                onChange={(v) => setDraft((f) => ({ ...f, rating: v }))}
                options={[
                  { value: 'all', label: '全部评价' },
                  { value: '1', label: '喜欢' },
                  { value: '0', label: '一般' },
                  { value: '-1', label: '不喜欢' },
                  { value: 'unrated', label: '未评价' },
                ]}
              />
            </label>
            <label className="min-w-0 space-y-2 text-sm">
              <span>开始日期</span>
              <DatePicker
                label="开始日期"
                value={draft.start}
                onChange={(v) => setDraft((f) => ({ ...f, start: v }))}
                clearable
              />
            </label>
            <label className="min-w-0 space-y-2 text-sm">
              <span>结束日期</span>
              <DatePicker
                label="结束日期"
                value={draft.end}
                onChange={(v) => setDraft((f) => ({ ...f, end: v }))}
                clearable
              />
            </label>
          </div>
          {draft.start && draft.end && draft.start > draft.end && (
            <p role="alert" className="mb-4 text-sm text-destructive">
              开始日期不能晚于结束日期
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDraft(emptyFilters)}>
              清除条件
            </Button>
            <Button
              disabled={!!draft.start && !!draft.end && draft.start > draft.end}
              onClick={() => {
                setFilters(draft);
                setOpen(false);
              }}
            >
              应用筛选
            </Button>
          </div>
        </FormModal>
      )}
    </div>
  );
}
