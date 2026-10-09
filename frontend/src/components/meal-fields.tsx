import { useId } from 'react';
import { RestaurantSelect } from './restaurant-select';
import { DatePicker } from './ui/date-picker';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { MealRating } from './meal-rating';
import type { Restaurant, Rating } from '@/lib/types';

export function MealFields({
  restaurants,
  restaurant,
  date,
  cost,
  onRestaurant,
  onDate,
  onCost,
  disabled = false,
  linked = false,
  rating = null,
  onRating,
}: {
  restaurants: Restaurant[];
  restaurant: string;
  date: string;
  cost: string;
  onRestaurant: (value: string) => void;
  onDate: (value: string) => void;
  onCost: (value: string) => void;
  disabled?: boolean;
  linked?: boolean;
  rating?: Rating;
  onRating?: (value: Rating) => void;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-5">
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${id}-restaurant`}>吃了哪家</Label>
          <RestaurantSelect
            id={`${id}-restaurant`}
            restaurants={restaurants}
            value={restaurant}
            onChange={onRestaurant}
            disabled={disabled || linked}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${id}-date`}>用餐日期</Label>
          <DatePicker
            id={`${id}-date`}
            label="用餐日期"
            value={date}
            onChange={onDate}
            disabled={disabled || linked}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-cost`}>
          本次总花费 <span className="font-normal text-muted-foreground">· 可选</span>
        </Label>
        <div className="relative sm:max-w-xs">
          <span className="pointer-events-none absolute left-3 top-3 text-muted-foreground">¥</span>
          <Input
            id={`${id}-cost`}
            inputMode="decimal"
            value={cost}
            maxLength={12}
            placeholder="不填也可以"
            autoComplete="off"
            className="min-h-11 pl-8"
            disabled={disabled || linked}
            onChange={(event) => onCost(event.target.value)}
            aria-describedby={`${id}-cost-hint`}
          />
        </div>
        <p id={`${id}-cost-hint`} className="text-xs leading-5 text-muted-foreground">
          {linked
            ? '已关联用餐，饭店、日期和花费请在用餐历史中修改。'
            : '人民币总额，聚餐填整桌花费，自己吃填本次花费。'}
        </p>
      </div>
      {onRating && <MealRating value={rating} onChange={onRating} disabled={disabled} />}
    </div>
  );
}
