import { lazy, Suspense, useId, useRef, useState } from 'react';
import { ArrowUpRight, MapPin, Plus, Search, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { FormModal } from './dialogs';
import { PageHeading } from './menu-layout';
import { usePhotoUploads } from '@/hooks/use-photo-uploads';
import type { Restaurant, RestaurantInput, RestaurantLocation } from '@/lib/types';
import restaurantPlaceholder from '@/assets/restaurant-placeholder.svg?no-inline';
import './restaurant-photo-preview.css';
const RestaurantMap = lazy(() =>
  import('./restaurant-map').then((m) => ({ default: m.RestaurantMap })),
);
export function RestaurantsPage({
  restaurants,
  ready,
  visible = true,
  onSave,
}: {
  restaurants: Restaurant[];
  ready: boolean;
  visible?: boolean;
  onSave: (input: RestaurantInput, original?: Restaurant) => Promise<void>;
}) {
  const [search, setSearch] = useState(''),
    [view, setView] = useState<'directory' | 'map'>('directory');
  const [editing, setEditing] = useState<Restaurant | 'new' | null>(null);
  const [preview, setPreview] = useState<Restaurant | null>(null);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const filtered = restaurants.filter((r) =>
    [r.name, r.address].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="restaurant-directory" data-view={view}>
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
      </div>
      {view === 'map' ? (
        <Suspense fallback={<p className="py-10 text-muted-foreground">正在展开地图…</p>}>
          <RestaurantMap
            active={visible && !editing}
            restaurants={filtered}
            onSelect={(id) => setEditing(restaurants.find((r) => r.id === id) || null)}
          />
        </Suspense>
      ) : (
        <div className="menu-directory-list">
          {filtered.map((r, i) => (
            <div key={r.id} className="restaurant-entry">
              <span className="menu-index">{String(i + 1).padStart(2, '0')}</span>
              <button
                type="button"
                className="restaurant-cover-button"
                data-has-photo={!!r.cover}
                aria-label={r.cover ? `查看${r.name}的照片` : `为${r.name}添加照片`}
                onClick={(event) => {
                  if (!r.cover) {
                    setEditing(r);
                    return;
                  }
                  previewTrigger.current = event.currentTarget;
                  setPreview(r);
                }}
              >
                <img
                  src={r.cover?.url || restaurantPlaceholder}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="restaurant-thumb"
                />
              </button>
              <button
                type="button"
                className="restaurant-details-button"
                aria-label={`编辑${r.name}的资料`}
                onClick={() => setEditing(r)}
              >
                <span className="min-w-0 flex-1">
                  <strong className="restaurant-name">{r.name}</strong>
                  {r.address && <span className="restaurant-address">{r.address}</span>}
                </span>
                <ArrowUpRight className="size-4 shrink-0 text-primary" />
              </button>
            </div>
          ))}
        </div>
      )}
      {!filtered.length && (
        <p className="py-16 text-center text-muted-foreground">
          {ready ? '没有匹配的饭店' : '正在载入菜单…'}
        </p>
      )}
      {preview?.cover && (
        <FormModal
          wide
          className="restaurant-photo-dialog"
          title={preview.name}
          onClose={() => {
            setPreview(null);
            requestAnimationFrame(() => previewTrigger.current?.focus());
          }}
        >
          <div className="restaurant-photo-stage">
            <img
              src={preview.cover.url}
              alt={`${preview.name}的照片`}
              decoding="async"
              className="restaurant-photo-full"
            />
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
  const [position, setPosition] = useState<RestaurantLocation | null>(restaurant?.location || null);
  const formId = useId();
  const [removed, setRemoved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const uploads = usePhotoUploads(),
    photo = uploads.photos[0];
  const url = photo?.url || (!removed ? restaurant?.cover?.url : undefined);
  return (
    <FormModal
      wide
      className="restaurant-dialog"
      title={restaurant ? '饭店资料' : '添一家饭店'}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="submit" form={formId} disabled={busy || !name.trim()}>
            {busy ? '保存中…' : '保存饭店'}
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        className="restaurant-editor"
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
            <img
              src={url || restaurantPlaceholder}
              alt={url ? '封面预览' : '美食插画占位，尚未添加封面'}
            />
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
        <div className="flex items-center gap-3 text-sm">
          <MapPin className="size-4 text-primary" />
          <span>地图位置</span>
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
        <Suspense fallback={<p>正在展开地图…</p>}>
          <RestaurantMap
            selected={position}
            initialQuery={restaurant?.address?.trim() ? '' : restaurant?.name || ''}
            onPick={(point, addr) => {
              if (!busy) {
                setPosition(point);
                if (addr) setAddress(addr);
              }
            }}
          />
        </Suspense>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </FormModal>
  );
}
