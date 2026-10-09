import { Choice } from './ui/choice';
import type { Restaurant } from '@/lib/types';

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
