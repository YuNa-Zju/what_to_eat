import { useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './dialog';
import { Button } from './button';
import { Input } from './input';
import { cn } from '@/lib/utils';
import { dayValue, parseDay } from '@/lib/search';

export function DatePicker({
  id,
  label,
  value,
  onChange,
  disabled = false,
  clearable = false,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => parseDay(value) || new Date());
  const [typed, setTyped] = useState(value);
  const [error, setError] = useState('');
  const calendar = useRef<HTMLDivElement>(null);
  const now = dayValue(new Date());
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const days = Array.from(
    { length: 42 },
    (_, i) => new Date(first.getFullYear(), first.getMonth(), i - offset + 1, 12),
  );
  function select(date: string) {
    onChange(date);
    setOpen(false);
  }
  function shift(delta: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1, 12));
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setMonth(parseDay(value) || new Date());
          setTyped(value);
          setError('');
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label={`${label}：${value || '不限日期'}`}
          className="choice-trigger"
        >
          <span className={cn('min-w-0 truncate tabular-nums', !value && 'text-muted-foreground')}>
            {value || '不限日期'}
          </span>
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className="app-dialog dialog-scroll w-[calc(100%-1.5rem)] overflow-y-auto overscroll-contain rounded-2xl p-5 sm:max-w-sm"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          calendar.current?.focus({ preventScroll: true });
        }}
      >
        <div className="pr-7">
          <DialogTitle>{label}</DialogTitle>
        </div>
        <div className="flex items-center justify-between gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="touch-button"
            aria-label="上一年"
            onClick={() => shift(-12)}
          >
            <ChevronsLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="touch-button"
            aria-label="上个月"
            onClick={() => shift(-1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <p className="flex-1 text-center text-sm font-medium" aria-live="polite">
            {month.getFullYear()} 年 {month.getMonth() + 1} 月
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="touch-button"
            aria-label="下个月"
            onClick={() => shift(1)}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="touch-button"
            aria-label="下一年"
            onClick={() => shift(12)}
          >
            <ChevronsRight className="size-4" />
          </Button>
        </div>
        <div ref={calendar} tabIndex={-1} aria-label="日历" className="min-w-0">
          <div className="mb-1 grid grid-cols-7 text-center text-xs text-muted-foreground">
            {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
              <span key={day} className="py-2">
                {day}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-1">
            {days.map((day, index) => {
              const date = dayValue(day);
              return (
                <button
                  key={date}
                  type="button"
                  aria-label={date}
                  aria-pressed={date === value}
                  aria-current={date === now ? 'date' : undefined}
                  className={cn(
                    'mx-auto flex min-h-10 w-full max-w-11 items-center justify-center rounded-xl text-sm tabular-nums hover:bg-secondary',
                    day.getMonth() !== month.getMonth() && 'text-muted-foreground/50',
                    date === now && 'border border-primary/35 text-primary',
                    date === value && 'bg-primary text-primary-foreground hover:bg-primary',
                  )}
                  onClick={() => select(date)}
                  onKeyDown={(e) => {
                    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[
                      e.key
                    ];
                    if (delta == null) return;
                    e.preventDefault();
                    const next = index + delta;
                    if (next >= 0 && next < days.length)
                      calendar.current
                        ?.querySelectorAll<HTMLButtonElement>('button')
                        [next]?.focus();
                  }}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex gap-2 border-t pt-4">
          <Input
            aria-label="输入日期"
            inputMode="numeric"
            placeholder="YYYY-MM-DD"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setError('');
            }}
            className="min-h-11 min-w-0 flex-1"
          />
          <Button
            type="button"
            className="touch-button"
            onClick={() => {
              const date = /^\d{8}$/.test(typed)
                ? `${typed.slice(0, 4)}-${typed.slice(4, 6)}-${typed.slice(6)}`
                : typed;
              if (parseDay(date)) select(date);
              else setError('请输入有效日期，例如 2026-10-09 或 20261009。');
            }}
          >
            确定
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-between">
          <Button
            type="button"
            variant="ghost"
            className="touch-button"
            onClick={() => select(now)}
          >
            今天
          </Button>
          {clearable && (
            <Button
              type="button"
              variant="ghost"
              className="touch-button"
              onClick={() => select('')}
            >
              清除日期
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
