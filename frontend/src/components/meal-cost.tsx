import { formatCost } from '@/lib/money';

export function MealCost({ cents }: { cents: number | null | undefined }) {
  if (cents == null) return null;
  return (
    <span className="inline-block rounded-full bg-muted px-2.5 py-1 text-xs tabular-nums text-muted-foreground">
      总花费 {formatCost(cents)}
    </span>
  );
}
