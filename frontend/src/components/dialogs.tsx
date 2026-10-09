import { useContext, useId, useState, type ReactNode, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Meal, Mode, Restaurant, Rating } from '@/lib/types';
import { MealFields } from './meal-fields';
import { costInput, parseCost } from '@/lib/money';
import { TutorialContext } from './onboarding';

export function FormModal({
  title,
  description,
  children,
  onClose,
  wide = false,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  footer?: ReactNode;
}) {
  const descriptionId = useId();
  const tutorial = useContext(TutorialContext);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={description ? descriptionId : undefined}
        className={`${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'} app-dialog w-[calc(100%-1.5rem)] rounded-2xl ${footer ? 'flex flex-col gap-0 overflow-hidden p-0' : 'dialog-scroll overflow-y-auto overscroll-contain p-5 sm:p-7'}`}
      >
        <DialogHeader
          className={
            footer
              ? 'dialog-heading shrink-0 border-b px-5 py-5 pr-14 text-left sm:px-7'
              : 'dialog-heading pr-10 text-left'
          }
        >
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription id={descriptionId}>{description}</DialogDescription>}
          {tutorial && (
            <p className="text-xs leading-6 text-primary">教程进行中 · 关闭此窗口后继续</p>
          )}
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
export function MealDialog({
  restaurants,
  mode,
  initial,
  onClose,
  onSave,
}: {
  restaurants: Restaurant[];
  mode: Mode;
  initial: Meal;
  onClose: () => void;
  onSave: (meal: Meal) => Promise<void>;
}) {
  const id = initial.id;
  const [restaurant, setRestaurant] = useState(initial.restaurant_id);
  const [date, setDate] = useState(initial.eaten_on);
  const [rating, setRating] = useState<Rating>(initial?.rating ?? null);
  const [cost, setCost] = useState(() => costInput(initial?.cost_cents));
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
        created_at: initial.created_at,
        rating,
        cost_cents: parseCost(cost),
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
      title={mode === 'shared' ? '修改聚餐记录' : '修改本地用餐记录'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="space-y-5" onSubmit={submit}>
        <MealFields
          restaurants={restaurants}
          restaurant={restaurant}
          date={date}
          cost={cost}
          onRestaurant={setRestaurant}
          onDate={setDate}
          onCost={setCost}
          disabled={busy}
          rating={rating}
          onRating={setRating}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
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
