import { useId, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './dialog';
import { Input } from './input';
import { matchScore } from '@/lib/search';
import { cn } from '@/lib/utils';

export interface ChoiceOption {
  value: string;
  label: string;
  detail?: string;
}
export function Choice({
  id,
  label,
  value,
  onChange,
  options,
  searchable = false,
  placeholder = '请选择',
  disabled = false,
  className,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ChoiceOption[];
  searchable?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const visible = options
    .map((option, index) => ({ ...option, score: matchScore(option.label, query), index }))
    .filter((option) => Number.isFinite(option.score))
    .sort((a, b) => a.score - b.score || a.index - b.index);
  const selected = options.find((option) => option.value === value);
  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  function move(index: number, focus: boolean) {
    if (!visible.length) return;
    const next = (index + visible.length) % visible.length;
    setActive(next);
    const item = list.current?.querySelectorAll<HTMLElement>('[role="option"]')[next];
    item?.scrollIntoView({ block: 'nearest' });
    if (focus) item?.focus({ preventScroll: true });
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery('');
          setActive(0);
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          id={id}
          type="button"
          aria-label={`${label}：${selected?.label || placeholder}`}
          disabled={disabled}
          className={cn('choice-trigger', !selected && 'text-muted-foreground', className)}
        >
          <span className="min-w-0 truncate">{selected?.label || placeholder}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className="app-dialog flex w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (searchable) input.current?.focus({ preventScroll: true });
          else list.current?.focus({ preventScroll: true });
        }}
      >
        <div className="shrink-0 border-b p-5 pr-14">
          <DialogTitle>{label}</DialogTitle>
        </div>
        {searchable && (
          <div className="relative mx-4 mt-4 shrink-0">
            <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
            <Input
              ref={input}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder={`搜索${label}`}
              aria-label={`搜索${label}`}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={visible[active] ? `${listId}-${active}` : undefined}
              className="min-h-11 pl-10"
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  move(active + (e.key === 'ArrowDown' ? 1 : -1), false);
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (visible[active]) choose(visible[active].value);
                }
              }}
            />
          </div>
        )}
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          className="min-h-0 overflow-y-auto overscroll-contain p-3 horizontal-scroll"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              move(active + (e.key === 'ArrowDown' ? 1 : -1), true);
            }
            if (e.key === 'Home' || e.key === 'End') {
              e.preventDefault();
              move(e.key === 'Home' ? 0 : visible.length - 1, true);
            }
          }}
        >
          {visible.map((option, index) => (
            <button
              key={option.value}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => choose(option.value)}
              onFocus={() => setActive(index)}
              className={cn(
                'flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors hover:bg-secondary',
                option.value === value ? 'bg-secondary text-primary' : 'text-foreground',
                query && active === index && 'ring-1 ring-inset ring-primary/30',
              )}
            >
              <span className="min-w-0 flex-1 break-words">
                {option.label}
                {option.detail && (
                  <span className="mt-1 block text-xs text-muted-foreground">{option.detail}</span>
                )}
              </span>
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border',
                  option.value === value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input',
                )}
              >
                {option.value === value && <Check className="size-3.5" />}
              </span>
            </button>
          ))}
          {!visible.length && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              没有找到，换几个字试试。
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
