import { Choice } from './ui/choice';
import type { Restaurant } from '@/lib/types';

export function RestaurantSelect({
  value,
  onChange,
  restaurants,
  disabled = false,
  id = 'restaurant',
}: {
  value: string;
  onChange: (v: string) => void;
  restaurants: Restaurant[];
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
      options={restaurants.map((r) => ({ value: r.id, label: r.name }))}
    />
  );
}
