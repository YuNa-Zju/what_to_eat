import { useId } from 'react';
import { cn } from '@/lib/utils';

export function BowlMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12h18c-.7 5-3.5 7.5-9 7.5S3.7 17 3 12Z" />
      <path d="M8 21h8M7.5 3C5 5.5 10 6 7.5 9M12 2c-2.5 2.5 2.5 3 0 6M16.5 3c-2.5 2.5 2.5 3 0 6" />
    </svg>
  );
}
export function DiceGlyph({
  rolling = false,
  className,
}: {
  rolling?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn(className, rolling && 'dice-rolling')}
      aria-hidden="true"
    >
      <rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.6" />
      <g fill="currentColor">
        <circle cx="8" cy="8" r="1.25" />
        <circle cx="16" cy="8" r="1.25" />
        <circle cx="12" cy="12" r="1.25" />
        <circle cx="8" cy="16" r="1.25" />
        <circle cx="16" cy="16" r="1.25" />
      </g>
    </svg>
  );
}
export function MealIllustration({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 240 200" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="68" y1="103" x2="169" y2="175" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--art-start)" />
          <stop offset="1" stopColor="var(--art-end)" />
        </linearGradient>
      </defs>
      <ellipse cx="122" cy="171" rx="80" ry="13" fill="var(--art-shadow)" opacity=".08" />
      <ellipse
        cx="120"
        cy="160"
        rx="69"
        ry="12"
        stroke="var(--art-plate)"
        strokeWidth="1.5"
        opacity=".4"
      />
      <path
        d="M59 104h122c-4 38-25 57-61 57s-57-19-61-57Z"
        fill={`url(#${id})`}
        stroke="var(--art-outline)"
        strokeWidth="1.5"
      />
      <ellipse
        cx="120"
        cy="105"
        rx="61"
        ry="15"
        fill="var(--art-surface)"
        stroke="var(--art-outline)"
        strokeWidth="1.5"
      />
      <path
        d="M75 105c12-14 24-10 34-1s21 9 32-1 20-9 25 0M84 109c11-6 18-4 28 1s22 6 36-2"
        stroke="var(--art-noodles)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M113 99c7-15 20-9 19 2-9 2-14 2-19-2Z" fill="var(--art-garnish)" opacity=".6" />
      <g stroke="var(--art-steam)" strokeWidth="2" strokeLinecap="round">
        <path className="food-steam" d="M97 82c-17-18 13-23 0-43" />
        <path className="food-steam" d="M120 77c-17-18 13-23 0-43" />
        <path className="food-steam" d="M142 82c-17-18 13-23 0-43" />
      </g>
      <path
        d="m152 92 58-61m-51 66 59-58"
        stroke="var(--art-chopsticks)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M74 122c3 8 9 14 17 17"
        stroke="var(--art-highlight)"
        strokeWidth="3"
        strokeLinecap="round"
        opacity=".8"
      />
      <path
        className="food-glimmer"
        d="m44 67 3-8 3 8 8 3-8 3-3 8-3-8-8-3Z"
        fill="var(--art-spark)"
      />
      <circle className="food-glimmer" cx="191" cy="129" r="3" fill="var(--art-spark)" />
    </svg>
  );
}
export function MealTrend({ counts }: { counts: { label: string; count: number }[] }) {
  const max = Math.max(1, ...counts.map((day) => day.count));
  return (
    <svg
      viewBox={`0 0 ${counts.length * 24} 70`}
      role="img"
      aria-label={`最近两周用餐：${counts.map((day) => `${day.label} ${day.count}顿`).join('，')}`}
      className="h-24 w-full overflow-visible"
    >
      <path d={`M0 62H${counts.length * 24}`} stroke="var(--border)" />
      {counts.map((day, i) => (
        <rect
          key={day.label}
          x={i * 24 + 4}
          y={62 - Math.max(3, (day.count / max) * 54)}
          width="14"
          height={Math.max(3, (day.count / max) * 54)}
          rx="4"
          fill={day.count ? 'var(--chart-bar)' : 'var(--chart-empty)'}
          className="history-bar"
          style={{ animationDelay: `${i * 25}ms` }}
        >
          <title>
            {day.label}：{day.count} 顿
          </title>
        </rect>
      ))}
    </svg>
  );
}
