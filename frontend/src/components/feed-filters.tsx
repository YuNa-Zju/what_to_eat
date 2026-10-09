import { useState } from 'react';
import { FormModal } from './dialogs';
import { Choice } from './ui/choice';
import { DatePicker } from './ui/date-picker';
import { Button } from './ui/button';
import type { Restaurant } from '@/lib/types';

export interface FeedFilterValues {
  restaurant: string;
  author: string;
  sort: string;
  start: string;
  end: string;
}
export const defaultFeedFilters: FeedFilterValues = {
  restaurant: '',
  author: 'all',
  sort: 'latest',
  start: '',
  end: '',
};
export const feedSortOptions = [
  { value: 'latest', label: '最新发布' },
  { value: 'oldest', label: '最早发布' },
  { value: 'liked', label: '最多点赞' },
  { value: 'eaten', label: '最近用餐' },
];

export function FeedFilters({
  value,
  restaurants,
  authors,
  onApply,
  onClose,
}: {
  value: FeedFilterValues;
  restaurants: Restaurant[];
  authors: { nickname: string; count: number }[];
  onApply: (value: FeedFilterValues) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const invalidDates = !!draft.start && !!draft.end && draft.start > draft.end;
  const update = (key: keyof FeedFilterValues, next: string) =>
    setDraft((current) => ({ ...current, [key]: next }));
  return (
    <FormModal
      title="筛选与排序"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            className="min-h-11 px-3 text-muted-foreground"
            onClick={() => setDraft({ ...defaultFeedFilters })}
          >
            重置
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" className="min-h-11" onClick={onClose}>
              取消
            </Button>
            <Button
              className="min-h-11 px-6"
              onClick={() => onApply(draft)}
              disabled={invalidDates}
            >
              应用
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid min-w-0 grid-cols-2 gap-5">
        <div className="col-span-2 min-w-0 space-y-2">
          <label htmlFor="feed-restaurant" className="text-sm font-medium">
            饭店
          </label>
          <Choice
            id="feed-restaurant"
            label="筛选饭店"
            value={draft.restaurant}
            onChange={(next) => update('restaurant', next)}
            searchable
            options={[
              { value: '', label: '所有饭店' },
              ...restaurants.map((restaurant) => ({
                value: restaurant.id,
                label: restaurant.name,
              })),
            ]}
          />
        </div>
        <div className="col-span-2 min-w-0 space-y-2">
          <label htmlFor="feed-author" className="text-sm font-medium">
            发布者
          </label>
          <Choice
            id="feed-author"
            label="发布者"
            value={draft.author}
            onChange={(next) => update('author', next)}
            searchable
            options={[
              { value: 'all', label: '所有饭友' },
              ...authors.map((author) => ({
                value: `name:${author.nickname}`,
                label: author.nickname || '匿名饭友',
                detail: `${author.count} 条分享`,
              })),
            ]}
          />
        </div>
        <div className="col-span-2 min-w-0 space-y-2">
          <label htmlFor="feed-sort" className="text-sm font-medium">
            排序
          </label>
          <Choice
            id="feed-sort"
            label="分享排序"
            value={draft.sort}
            onChange={(next) => update('sort', next)}
            options={feedSortOptions}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <label htmlFor="feed-start" className="text-sm font-medium">
            开始日期
          </label>
          <DatePicker
            id="feed-start"
            label="用餐开始日期"
            value={draft.start}
            onChange={(next) => update('start', next)}
            clearable
          />
        </div>
        <div className="min-w-0 space-y-2">
          <label htmlFor="feed-end" className="text-sm font-medium">
            结束日期
          </label>
          <DatePicker
            id="feed-end"
            label="用餐结束日期"
            value={draft.end}
            onChange={(next) => update('end', next)}
            clearable
          />
        </div>
        {invalidDates && (
          <p role="alert" className="col-span-2 text-sm text-destructive">
            开始日期不能晚于结束日期。
          </p>
        )}
      </div>
    </FormModal>
  );
}
