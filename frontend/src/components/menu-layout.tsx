import type { ReactNode } from 'react';
import type { Mode } from '@/lib/types';
export function ModeSwitch({
  mode,
  onChange,
  tour = false,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
  tour?: boolean;
}) {
  return (
    <div
      className="mode-switch"
      role="group"
      aria-label="用餐模式"
      data-tour={tour ? 'dining-mode' : undefined}
    >
      {(['shared', 'local'] as const).map((value) => (
        <button key={value} aria-pressed={mode === value} onClick={() => onChange(value)}>
          {value === 'shared' ? '我们聚餐' : '我自己吃'}
        </button>
      ))}
    </div>
  );
}
export function PageHeading({
  number,
  title,
  accessory,
}: {
  number: string;
  title: string;
  accessory?: ReactNode;
}) {
  return (
    <div className="menu-heading">
      <div className="flex items-baseline gap-3 sm:gap-5">
        <span className="chapter-number" aria-hidden="true">
          {number}
        </span>
        <h1>{title}</h1>
      </div>
      {accessory}
    </div>
  );
}
