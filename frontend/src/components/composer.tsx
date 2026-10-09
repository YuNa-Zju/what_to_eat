import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ImagePlus, X, Send, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormModal } from './dialogs';
import { MealFields } from './meal-fields';
import { costInput, parseCost } from '@/lib/money';
import { MarkdownEditor } from './markdown-editor';
import { api } from '@/lib/api';
import { today } from '@/lib/meals';
import type { ComposeSeed, Meal, Post, Restaurant, Rating, Mode } from '@/lib/types';
import { Choice } from './ui/choice';
import { readLastNickname, rememberNickname } from '@/lib/storage';

const DRAFT = 'what-to-eat:draft:v1';
interface Draft {
  id: string;
  restaurant: string;
  date: string;
  nickname: string;
  body: string;
  record: string;
  cost: string;
  share: boolean;
  rating: Rating;
}
function readDraft(): Partial<Draft> {
  try {
    const stored = JSON.parse(localStorage.getItem(DRAFT) || '{}') as Record<string, unknown>;
    if (!stored || typeof stored !== 'object') return {};
    return Object.fromEntries(
      Object.entries(stored).filter(
        ([key, value]) =>
          (['id', 'restaurant', 'date', 'nickname', 'body', 'record', 'cost'].includes(key) &&
            typeof value === 'string') ||
          (key === 'share' && typeof value === 'boolean') ||
          (key === 'rating' && (value === null || value === -1 || value === 0 || value === 1)),
      ),
    ) as Partial<Draft>;
  } catch {
    return {};
  }
}
export function Composer({
  restaurants,
  seed,
  edit,
  onClose,
  onCreated,
  onEdited,
  onRecord,
}: {
  restaurants: Restaurant[];
  seed: ComposeSeed;
  edit?: Post;
  onClose: () => void;
  onCreated: (post: Post, record: string, rating: Rating, localMeal?: Meal) => Promise<void>;
  onEdited: () => Promise<void>;
  onRecord: (meal: Meal, mode: Mode) => Promise<void>;
}) {
  const formId = useId();
  const [draft] = useState<Partial<Draft>>(() => (edit || seed.meal ? {} : readDraft()));
  const [id] = useState(() => draft.id || crypto.randomUUID());
  const [restaurant, setRestaurant] = useState(
    edit?.restaurant_id || seed.meal?.restaurant_id || seed.selected || draft.restaurant || '',
  );
  const [date, setDate] = useState(edit?.eaten_on || seed.meal?.eaten_on || draft.date || today());
  const [nickname, setNickname] = useState(() =>
    edit ? (edit.nickname ?? '') : (draft.nickname ?? readLastNickname()),
  );
  const [body, setBody] = useState(edit?.body ?? draft.body ?? '');
  const [record, setRecord] = useState(
    ['shared', 'local', 'none'].includes(draft.record || '') &&
      (draft.share !== undefined || draft.body?.trim())
      ? draft.record!
      : seed.mode,
  );
  const [share, setShare] = useState(draft.share ?? seed.intent !== 'record');
  const [rating, setRating] = useState<Rating>(seed.meal?.rating ?? draft.rating ?? null);
  const [cost, setCost] = useState(() =>
    edit
      ? costInput(edit.cost_cents)
      : seed.meal
        ? costInput(seed.meal.cost_cents)
        : (draft.cost ?? ''),
  );
  const sharing = !!edit || !!seed.meal || record === 'none' || share;
  const [retainedPhotos, setRetainedPhotos] = useState(edit?.images || []);
  const linked = !!edit?.shared_meal_id || !!seed.meal;
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const photosRef = useRef(photos);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedPost, setSavedPost] = useState<Post | null>(null);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(
    () => () => {
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    },
    [],
  );
  useEffect(() => {
    if (edit || seed.meal || savedPost) return;
    try {
      localStorage.setItem(
        DRAFT,
        JSON.stringify({ id, restaurant, date, nickname, body, record, cost, share, rating }),
      );
    } catch {
      /* Saving a draft is optional; publishing still works. */
    }
  }, [
    id,
    restaurant,
    date,
    nickname,
    body,
    record,
    cost,
    share,
    rating,
    edit,
    seed.meal,
    savedPost,
  ]);
  function addPhotos(files: FileList | null) {
    if (!files) return;
    const selected = [...files];
    if (retainedPhotos.length + photos.length + selected.length > 6) {
      setError('一条分享最多放 6 张照片');
      return;
    }
    if (
      selected.some(
        (file) =>
          file.size > 10 * 1024 * 1024 ||
          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type),
      )
    ) {
      setError('请选择 10 MiB 以内的 JPEG、PNG 或 WebP 照片；HEIC 请先转为 JPEG');
      return;
    }
    setError('');
    setPhotos((current) => [
      ...current,
      ...selected.map((file) => ({ file, url: URL.createObjectURL(file) })),
    ]);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const costCents = parseCost(cost);
      if (edit) {
        const form = new FormData();
        form.append(
          'payload',
          JSON.stringify({
            nickname,
            body,
            restaurant_id: restaurant,
            eaten_on: date,
            keep_image_ids: retainedPhotos.map((photo) => photo.id),
            ...(!linked ? { cost_cents: costCents } : {}),
          }),
        );
        photos.forEach((photo) => form.append('photos', photo.file));
        await api(`/posts/${edit.id}`, { method: 'PUT', body: form });
        await onEdited();
      } else if (!sharing) {
        await onRecord(
          {
            id,
            restaurant_id: restaurant,
            eaten_on: date,
            created_at: Date.now(),
            rating,
            cost_cents: costCents,
          },
          record as Mode,
        );
      } else {
        const form = new FormData();
        form.append(
          'payload',
          JSON.stringify({
            id,
            restaurant_id: restaurant,
            eaten_on: date,
            nickname,
            body,
            record_meal: !seed.meal && record === 'shared',
            meal_rating: rating,
            cost_cents: costCents,
            existing_meal_id: seed.mode === 'shared' ? seed.meal?.id : null,
          }),
        );
        photos.forEach((photo) => form.append('photos', photo.file));
        const post = savedPost || (await api<Post>('/posts', { method: 'POST', body: form }));
        setSavedPost(post);
        rememberNickname(post.nickname ?? '');
        // If local storage fails after publishing, retry only this local step.
        await onCreated(
          post,
          !seed.meal ? record : 'none',
          rating,
          seed.mode === 'local' ? seed.meal : undefined,
        );
      }
      if (!edit && !seed.meal) {
        try {
          localStorage.removeItem(DRAFT);
        } catch {
          /* Optional draft cleanup. */
        }
      }
      onClose();
    } catch (e) {
      setError(
        `${savedPost ? '帖子已经发布，' : ''}${e instanceof Error ? e.message : '保存失败，请重试'}`,
      );
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || !!savedPost;
  return (
    <FormModal
      wide
      title={edit ? '编辑这条分享' : seed.meal ? '分享这顿饭' : '记下这顿饭'}
      description={
        edit
          ? '修改这条分享的信息、感受和照片。'
          : seed.meal
            ? '用餐已经记好，再分享一点感受。'
            : '饭店、日期和花费一起记，也可以顺手分享感受和照片。'
      }
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex composer-hint min-w-0 items-center gap-2 text-xs leading-5 text-muted-foreground">
            <CheckCircle2 className="size-3.5 shrink-0 text-primary/70" />
            {edit
              ? linked
                ? '已关联用餐，基础信息保持一致'
                : '独立分享，可修改饭店、日期和花费'
              : seed.meal
                ? '已关联本次用餐，不会重复记账'
                : sharing
                  ? record === 'none'
                    ? '仅发布分享，不新增用餐记录'
                    : '保存用餐，同时发布分享'
                  : '只保存用餐，稍后也能分享'}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 flex-1 px-5 sm:flex-none"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </Button>
            <Button
              type="submit"
              form={formId}
              className="min-h-11 flex-[2] gap-2 px-6 sm:flex-none"
              disabled={
                busy ||
                !restaurant ||
                (sharing && !body.trim() && photos.length === 0 && retainedPhotos.length === 0)
              }
            >
              {sharing ? <Send className="size-4" /> : <CheckCircle2 className="size-4" />}
              {busy
                ? sharing && photos.length
                  ? '压缩并保存中…'
                  : '保存中…'
                : savedPost
                  ? '重试本地保存'
                  : edit
                    ? '保存修改'
                    : !sharing
                      ? '保存这顿饭'
                      : seed.meal || record === 'none'
                        ? '发布分享'
                        : '保存并分享'}
            </Button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="min-w-0 space-y-5">
        <MealFields
          restaurants={restaurants}
          restaurant={restaurant}
          date={date}
          cost={cost}
          onRestaurant={setRestaurant}
          onDate={setDate}
          onCost={setCost}
          disabled={locked}
          linked={linked}
          rating={rating}
          onRating={!edit && !seed.meal && record !== 'none' ? setRating : undefined}
        />
        {!edit && !seed.meal && (
          <div className="space-y-4 rounded-xl border bg-muted/40 p-4">
            <div className="space-y-2">
              <Label htmlFor="record-mode">记录到哪里</Label>
              <Choice
                id="record-mode"
                label="记录到哪里"
                value={record}
                onChange={setRecord}
                disabled={locked}
                options={[
                  { value: 'shared', label: '大家的聚餐历史' },
                  { value: 'local', label: '我的本地用餐历史' },
                  { value: 'none', label: '仅分享，不记入历史' },
                ]}
              />
            </div>
            {record !== 'none' && (
              <button
                type="button"
                role="switch"
                aria-checked={sharing}
                disabled={locked}
                onClick={() => setShare(!share)}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left disabled:opacity-50"
              >
                <span>
                  <span className="block text-sm font-medium">同时分享到大家的动态</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {sharing
                      ? '本次花费、感受和照片会出现在公开动态中'
                      : '先记下这顿饭，之后也可以补写分享'}
                  </span>
                </span>
                <span
                  className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${sharing ? 'bg-primary' : 'bg-input'}`}
                >
                  <span
                    className={`size-5 rounded-full bg-surface shadow-sm transition-transform ${sharing ? 'translate-x-5' : ''}`}
                  />
                </span>
              </button>
            )}
          </div>
        )}
        {sharing && (
          <>
            <div className="space-y-2">
              <Label htmlFor="post-nickname">
                昵称 <span className="font-normal text-muted-foreground">· 不填就是匿名</span>
              </Label>
              <Input
                id="post-nickname"
                maxLength={40}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="今天想叫什么？"
                className="min-h-11 sm:max-w-xs"
                disabled={locked}
                autoComplete="nickname"
              />
            </div>
            <MarkdownEditor value={body} onChange={setBody} disabled={locked} />
            {
              <section className="space-y-2.5" aria-label="照片附件">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">
                    照片 <span className="font-normal text-muted-foreground">· 可选</span>
                  </p>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {retainedPhotos.length + photos.length} / 6
                  </span>
                </div>
                <div
                  className={
                    retainedPhotos.length + photos.length
                      ? 'grid grid-cols-3 gap-2 sm:grid-cols-6'
                      : ''
                  }
                >
                  {retainedPhotos.map((photo, index) => (
                    <div
                      key={photo.id}
                      className="relative aspect-square overflow-hidden rounded-xl border"
                    >
                      <img
                        src={photo.url}
                        alt={`已有照片 ${index + 1}`}
                        className="size-full object-cover"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        aria-label={`移除已有照片 ${index + 1}`}
                        disabled={locked}
                        className="absolute right-0 top-0 size-11 rounded-none rounded-bl-xl"
                        onClick={() =>
                          setRetainedPhotos((rows) => rows.filter((row) => row.id !== photo.id))
                        }
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}
                  {photos.map((photo, index) => (
                    <div
                      key={photo.url}
                      className="relative aspect-square overflow-hidden rounded-xl border"
                    >
                      <img
                        src={photo.url}
                        alt={`待上传照片 ${index + 1}`}
                        className="size-full object-cover"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        aria-label={`移除照片 ${index + 1}`}
                        className="absolute right-0 top-0 size-11 rounded-none rounded-bl-xl"
                        disabled={locked}
                        onClick={() => {
                          URL.revokeObjectURL(photo.url);
                          setPhotos((current) => current.filter((p) => p.url !== photo.url));
                        }}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}
                  {retainedPhotos.length + photos.length < 6 && (
                    <label
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-primary/25 bg-card text-sm transition-colors hover:border-primary/50 hover:bg-accent/40 has-[:focus-visible]:ring-2 ${retainedPhotos.length + photos.length ? 'aspect-square flex-col justify-center gap-2 p-2 text-muted-foreground' : 'min-h-20 px-4 py-3'} ${locked ? 'pointer-events-none opacity-50' : ''}`}
                    >
                      <span
                        className={
                          retainedPhotos.length + photos.length
                            ? ''
                            : 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary'
                        }
                      >
                        <ImagePlus className="size-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {retainedPhotos.length + photos.length ? '继续添加' : '添加照片'}
                        </span>
                        {!photos.length && !retainedPhotos.length && (
                          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                            相册可多选，上传后自动压缩
                          </span>
                        )}
                      </span>
                      <input
                        type="file"
                        className="sr-only"
                        multiple
                        accept="image/jpeg,image/png,image/webp"
                        disabled={locked}
                        onChange={(e) => {
                          addPhotos(e.target.files);
                          e.target.value = '';
                        }}
                        aria-label="从相册添加照片"
                      />
                    </label>
                  )}
                </div>
                {photos.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    每张最多 10 MiB，上传后自动压缩，保留透明背景。
                  </p>
                )}
              </section>
            }
          </>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {savedPost && (
          <p className="text-sm text-primary">帖子已在云端保存；重试只会补全本地保存和刷新。</p>
        )}
      </form>
    </FormModal>
  );
}
