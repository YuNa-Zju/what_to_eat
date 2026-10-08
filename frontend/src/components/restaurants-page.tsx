import { useState } from 'react';
import { MapPin, Pencil, Plus, Search, Pause, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { FormModal } from './dialogs';
import type { Restaurant } from '@/lib/types';

export function RestaurantsPage({
  restaurants,
  ready,
  onSave,
  onToggle,
}: {
  restaurants: Restaurant[];
  ready: boolean;
  onSave: (name: string, original?: Restaurant) => Promise<void>;
  onToggle: (restaurant: Restaurant) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [editing, setEditing] = useState<Restaurant | 'new' | null>(null);
  const filtered = restaurants.filter(
    (r) => (filter === 'all' || r.active) && r.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow mb-3">OUR LITTLE FOOD MAP</p>
          <h1 className="text-3xl font-semibold sm:text-4xl">把好吃的地方留下来。</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            这是大家一起维护的名单，下次聚餐就从这里出发。
          </p>
        </div>
        <Button className="min-h-12" disabled={!ready} onClick={() => setEditing('new')}>
          <Plus className="mr-2 size-4" />
          添加新饭店
        </Button>
      </div>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="relative sm:w-80">
          <Search className="absolute left-3 top-3.5 size-4 text-muted-foreground" />
          <Input
            aria-label="搜索饭店"
            placeholder="找一家熟悉的店…"
            className="min-h-11 bg-surface pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={filter === 'active' ? 'secondary' : 'ghost'}
            className="touch-button"
            aria-pressed={filter === 'active'}
            onClick={() => setFilter('active')}
          >
            正在营业 · {restaurants.filter((r) => r.active).length}
          </Button>
          <Button
            variant={filter === 'all' ? 'secondary' : 'ghost'}
            className="touch-button"
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            全部 · {restaurants.length}
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((r) => (
          <article
            key={r.id}
            className={`flex min-w-0 flex-col rounded-xl border bg-surface p-5 ${!r.active ? 'opacity-65' : ''}`}
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                <MapPin className="size-4" />
              </span>
              {!r.active && <Badge variant="secondary">已停用</Badge>}
            </div>
            <h2 className="mb-5 break-words font-medium">{r.name}</h2>
            <div className="mt-auto flex items-center justify-between border-t pt-2">
              <span className="text-xs text-muted-foreground">
                {r.active ? '在下一顿的可能里' : '历史记录仍然保留'}
              </span>
              <div className="flex">
                <Button
                  variant="ghost"
                  size="icon"
                  className="touch-button"
                  aria-label={`重命名 ${r.name}`}
                  onClick={() => setEditing(r)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="touch-button"
                  aria-label={`${r.active ? '停用' : '恢复'} ${r.name}`}
                  onClick={() => onToggle(r)}
                >
                  {r.active ? <Pause className="size-4" /> : <RotateCcw className="size-4" />}
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {ready ? '没有找到这家店，不如把它添加进来。' : '饭店名单正在载入…'}
        </p>
      )}
      {editing && (
        <RestaurantEditor
          restaurant={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={onSave}
        />
      )}
    </div>
  );
}
function RestaurantEditor({
  restaurant,
  onClose,
  onSave,
}: {
  restaurant?: Restaurant;
  onClose: () => void;
  onSave: (name: string, original?: Restaurant) => Promise<void>;
}) {
  const [name, setName] = useState(restaurant?.name || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <FormModal
      title={restaurant ? '改个店名' : '发现一家好吃的'}
      description="保存后，所有人都能在共享名单中看到。"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(name.trim(), restaurant);
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : '保存失败');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="restaurant-name">饭店名称</Label>
          <Input
            id="restaurant-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            placeholder="比如，一食堂"
            className="min-h-12"
            disabled={busy}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button className="min-h-12 w-full" disabled={busy || !name.trim()}>
          {busy ? '保存中…' : '保存饭店'}
        </Button>
      </form>
    </FormModal>
  );
}
