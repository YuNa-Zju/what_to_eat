import { useState, type ReactNode, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Choice } from './ui/choice';
import { DatePicker } from './ui/date-picker';
import { today } from '@/lib/meals';
import type { Meal, Mode, Restaurant, Rating } from '@/lib/types';
import { MealRating } from './meal-rating';

export function FormModal({
  title,
  description,
  children,
  onClose,
  wide = false,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  footer?: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className={`${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'} app-dialog w-[calc(100%-1.5rem)] rounded-2xl ${footer ? 'flex flex-col gap-0 overflow-hidden p-0' : 'dialog-scroll overflow-y-auto overscroll-contain p-5 sm:p-7'}`}
      >
        <DialogHeader
          className={
            footer
              ? 'dialog-heading shrink-0 border-b px-5 py-5 pr-14 text-left sm:px-7'
              : undefined
          }
        >
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {footer ? (
          <div className="dialog-scroll min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7">
            {children}
          </div>
        ) : (
          children
        )}
        {footer && (
          <div className="dialog-actions shrink-0 border-t bg-background px-5 py-4 sm:px-7 safe-bottom">
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function RestaurantSelect({
  value,
  onChange,
  restaurants,
  includeInactive = false,
  disabled = false,
  id = 'restaurant',
}: {
  value: string;
  onChange: (v: string) => void;
  restaurants: Restaurant[];
  includeInactive?: boolean;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <Choice
      id={id}
      label="饭店"
      value={value}
      onChange={onChange}
      disabled={disabled}
      searchable
      placeholder="搜索或选择饭店"
      options={restaurants
        .filter((r) => r.active || includeInactive || r.id === value)
        .map((r) => ({ value: r.id, label: r.name, detail: r.active ? undefined : '已停用' }))}
    />
  );
}
export function MealDialog({
  restaurants,
  mode,
  initial,
  selected,
  onClose,
  onSave,
}: {
  restaurants: Restaurant[];
  mode: Mode;
  initial?: Meal;
  selected?: string;
  onClose: () => void;
  onSave: (meal: Meal) => Promise<void>;
}) {
  const [id] = useState(() => initial?.id || crypto.randomUUID());
  const [restaurant, setRestaurant] = useState(initial?.restaurant_id || selected || '');
  const [date, setDate] = useState(initial?.eaten_on || today());
  const [rating, setRating] = useState<Rating>(initial?.rating ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave({
        ...initial,
        id,
        restaurant_id: restaurant,
        eaten_on: date,
        created_at: initial?.created_at || Date.now(),
        rating,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormModal
      title={initial ? '修改这顿饭' : '好好记一顿'}
      description={
        mode === 'shared'
          ? '记入大家的聚餐历史，更新共同的最近用餐窗口。'
          : '只保存在当前浏览器，不影响大家的聚餐。'
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="space-y-5" onSubmit={submit}>
        <div className="space-y-2">
          <Label htmlFor="meal-restaurant">吃了哪一家</Label>
          <RestaurantSelect
            id="meal-restaurant"
            restaurants={restaurants}
            value={restaurant}
            onChange={setRestaurant}
            disabled={busy}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="meal-date">用餐日期</Label>
          <DatePicker
            id="meal-date"
            label="用餐日期"
            value={date}
            onChange={setDate}
            disabled={busy}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <MealRating value={rating} onChange={setRating} disabled={busy} />
        <Button type="submit" className="min-h-12 w-full" disabled={busy || !restaurant}>
          {busy ? '正在保存…' : '保存这顿饭'}
        </Button>
      </form>
    </FormModal>
  );
}
export function ConfirmDialog({
  title,
  description,
  action,
  onClose,
}: {
  title: string;
  description: string;
  action: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <FormModal
      title={title}
      description={description}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" className="touch-button" disabled={busy} onClick={onClose}>
          取消
        </Button>
        <Button
          variant="destructive"
          className="touch-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await action();
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : '操作失败');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '正在处理…' : '确认'}
        </Button>
      </div>
    </FormModal>
  );
}
