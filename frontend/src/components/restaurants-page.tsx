import { lazy, Suspense, useState } from 'react';
import { ArrowUpRight, ImagePlus, MapPin, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { FormModal } from './dialogs';
import { PageHeading } from './menu-layout';
import { usePhotoUploads } from '@/hooks/use-photo-uploads';
import type { Restaurant, RestaurantInput, RestaurantLocation } from '@/lib/types';
const RestaurantMap = lazy(() =>
  import('./restaurant-map').then((m) => ({ default: m.RestaurantMap })),
);
export function RestaurantsPage({
  restaurants,
  ready,
  visible = true,
  onSave,
  onToggle,
}: {
  restaurants: Restaurant[];
  ready: boolean;
  visible?: boolean;
  onSave: (input: RestaurantInput, original?: Restaurant) => Promise<void>;
  onToggle: (restaurant: Restaurant) => void;
}) {
  const [search, setSearch] = useState(''),
    [view, setView] = useState<'directory' | 'map'>('directory');
  const [editing, setEditing] = useState<Restaurant | 'new' | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [more, setMore] = useState(false);
  const [showAll, setShowAll] = useState(false),
    [detailMenu, setDetailMenu] = useState(false);
  const filtered = restaurants.filter(
    (r) =>
      (showAll || r.active) &&
      [r.name, r.address].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const detail = restaurants.find((r) => r.id === selected);
  return (
    <div className="restaurant-directory">
      <PageHeading
        number="04"
        title="饭店目录"
        accessory={
          <Button
            data-tour="manage"
            disabled={!ready}
            onClick={() => setEditing('new')}
            className="gap-2 min-h-11"
          >
            <Plus className="size-4" />
            添一家
          </Button>
        }
      />
      <div className="directory-toolbar">
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="menu-search pl-7"
            placeholder="找一家饭店"
            aria-label="搜索饭店"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="mode-switch" aria-label="饭店显示方式">
          {(['directory', 'map'] as const).map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'directory' ? '目录' : '地图'}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="名单选项"
          aria-expanded={more}
          onClick={() => setMore(!more)}
        >
          <MoreHorizontal className="size-5" />
        </Button>
      </div>
      {more && (
        <div className="mb-5 flex items-center justify-end gap-4 text-sm">
          <button
            className="min-h-11 text-primary underline underline-offset-4"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? '只看候选饭店' : '包括已移出的饭店'}
          </button>
          <span className="text-muted-foreground">{filtered.length} 家</span>
        </div>
      )}
      {view === 'map' ? (
        <Suspense fallback={<p className="py-10 text-muted-foreground">正在展开地图…</p>}>
          <RestaurantMap active={visible} restaurants={filtered} onSelect={setSelected} />
        </Suspense>
      ) : (
        <div className="menu-directory-list">
          {filtered.map((r, i) => (
            <button
              key={r.id}
              className={`restaurant-entry ${r.active ? '' : 'restaurant-retired'}`}
              onClick={() => {
                setDetailMenu(false);
                setSelected(r.id);
              }}
            >
              <span className="menu-index">{String(i + 1).padStart(2, '0')}</span>
              {r.cover && (
                <img src={r.cover.url} alt="" loading="lazy" className="restaurant-thumb" />
              )}
              <span className="min-w-0 flex-1">
                <strong className="restaurant-name">{r.name}</strong>
                {r.address && <span className="restaurant-address">{r.address}</span>}
                {!r.active && <span className="text-xs text-muted-foreground">已移出候选</span>}
              </span>
              <ArrowUpRight className="size-4 shrink-0 text-primary" />
            </button>
          ))}
        </div>
      )}
      {!filtered.length && (
        <p className="py-16 text-center text-muted-foreground">
          {ready ? '没有匹配的饭店' : '正在载入菜单…'}
        </p>
      )}
      {detail && (
        <FormModal title={detail.name} onClose={() => setSelected(null)} wide>
          <div className="restaurant-detail">
            {detail.cover && (
              <img className="detail-cover" src={detail.cover.url} alt={`${detail.name}封面`} />
            )}
            <div className="space-y-5">
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                {detail.address || '尚未填写地址'}
              </p>
              {detail.location && (
                <Suspense fallback={<p>正在展开地图…</p>}>
                  <RestaurantMap active={visible} selected={detail.location} />
                </Suspense>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    setEditing(detail);
                    setSelected(null);
                  }}
                >
                  编辑资料
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="饭店更多操作"
                  aria-expanded={detailMenu}
                  onClick={() => setDetailMenu(!detailMenu)}
                >
                  <MoreHorizontal className="size-5" />
                </Button>
                {detailMenu && (
                  <Button variant="ghost" onClick={() => onToggle(detail)}>
                    {detail.active ? '移出候选' : '恢复到候选'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </FormModal>
      )}
      {editing && (
        <RestaurantEditor
          restaurant={editing === 'new' ? undefined : editing}
          onSave={onSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
function RestaurantEditor({
  restaurant,
  onSave,
  onClose,
}: {
  restaurant?: Restaurant;
  onSave: (input: RestaurantInput, original?: Restaurant) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(restaurant?.name || ''),
    [address, setAddress] = useState(restaurant?.address || '');
  const [position, setPosition] = useState<RestaurantLocation | null>(restaurant?.location || null),
    [mapOpen, setMapOpen] = useState(false);
  const [removed, setRemoved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const uploads = usePhotoUploads(),
    photo = uploads.photos[0];
  const url = photo?.url || (!removed ? restaurant?.cover?.url : undefined);
  return (
    <FormModal
      wide
      title={restaurant ? '编辑饭店' : '添一家饭店'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="mt-6 space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            const ids = await uploads.readyIds();
            await onSave(
              {
                name: name.trim(),
                active: restaurant?.active ?? true,
                address: address.trim() || null,
                location: position,
                ...(ids.length
                  ? { cover_upload_id: ids[0] }
                  : removed
                    ? { cover_upload_id: null }
                    : {}),
              },
              restaurant,
            );
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : '保存失败');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="restaurant-editor-top">
          <div className="cover-picker">
            {url ? (
              <img src={url} alt="封面预览" />
            ) : (
              <ImagePlus className="size-9 text-primary/60" />
            )}
            <label className="cover-pick-label">
              {url ? '更换封面' : '添加封面'}
              <input
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  if (
                    file.size > 10 * 1024 * 1024 ||
                    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
                  ) {
                    setError('请选择 10 MiB 以内的 JPEG、PNG 或 WebP 照片');
                    return;
                  }
                  uploads.photos.forEach((p) => uploads.remove(p.id));
                  uploads.add([file]);
                  setRemoved(false);
                }}
              />
            </label>
            {url && (
              <button
                type="button"
                className="cover-remove"
                aria-label="移除封面"
                disabled={busy}
                onClick={() => {
                  uploads.photos.forEach((p) => uploads.remove(p.id));
                  setRemoved(true);
                }}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="flex-1 space-y-5">
            <label className="block space-y-2 text-sm">
              <span>饭店名称</span>
              <Input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="block space-y-2 text-sm">
              <span>地址</span>
              <Input
                maxLength={300}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={busy}
                placeholder="可选"
              />
            </label>
          </div>
        </div>
        {photo && (
          <p role="status" className="text-sm text-muted-foreground">
            {photo.status === 'ready'
              ? '封面已上传'
              : photo.status === 'error'
                ? photo.error
                : '正在压缩并上传封面…'}
            {photo.status === 'error' && (
              <button
                type="button"
                className="ml-3 text-primary"
                onClick={() => uploads.retry(photo.id)}
              >
                重试
              </button>
            )}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setMapOpen(!mapOpen)}
          >
            <MapPin className="mr-2 size-4" />
            {mapOpen ? '收起地图' : position ? '修改位置' : '在地图选点'}
          </Button>
          {position && (
            <>
              <span className="text-xs text-muted-foreground">已标记位置</span>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setPosition(null)}
              >
                清除
              </Button>
            </>
          )}
        </div>
        {mapOpen && (
          <Suspense fallback={<p>正在展开地图…</p>}>
            <RestaurantMap
              selected={position}
              onPick={(point, addr) => {
                if (!busy) {
                  setPosition(point);
                  if (addr) setAddress(addr);
                }
              }}
            />
          </Suspense>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t pt-5">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button disabled={busy || !name.trim()}>{busy ? '保存中…' : '保存饭店'}</Button>
        </div>
      </form>
    </FormModal>
  );
}
