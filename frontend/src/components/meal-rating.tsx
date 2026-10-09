import { Smile, Meh, Frown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Rating } from '@/lib/types';

export const ratingText = (rating: Rating) =>
  rating === 1 ? '喜欢' : rating === -1 ? '不喜欢' : rating === 0 ? '一般' : '未评价';
export function MealRating({
  value,
  onChange,
  disabled = false,
}: {
  value: Rating;
  onChange: (value: Rating) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">
        用餐评价 <span className="font-normal text-muted-foreground">· 可选</span>
      </legend>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            { value: 1, label: '喜欢', icon: Smile },
            { value: 0, label: '一般', icon: Meh },
            { value: -1, label: '不喜欢', icon: Frown },
          ] as const
        ).map((item) => (
          <Button
            key={item.value}
            type="button"
            variant={value === item.value ? 'default' : 'outline'}
            aria-pressed={value === item.value}
            className="min-h-12 gap-2"
            onClick={() => onChange(value === item.value ? null : item.value)}
          >
            <item.icon className="size-4" />
            {item.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
