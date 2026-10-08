import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormModal } from './dialogs';
import { Markdown } from './markdown';
import { api, json } from '@/lib/api';
import type { Post, Restaurant } from '@/lib/types';
import { cn } from '@/lib/utils';

export function FeedPage({
  restaurants,
  refreshKey,
  onCompose,
  onEdit,
  onDelete,
  onError,
}: {
  restaurants: Restaurant[];
  refreshKey: number;
  onCompose: () => void;
  onEdit: (post: Post) => void;
  onDelete: (post: Post) => void;
  onError: (error: string) => void;
}) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [voting, setVoting] = useState<string[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const depth = useRef(1);
  const sequence = useRef(0);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  async function load() {
    const request = ++sequence.current;
    setBusy(true);
    try {
      const all: Post[] = [];
      let more = false;
      for (let i = 0; i < depth.current; i++) {
        const last = all.at(-1);
        const page = await api<Post[]>(
          `/posts${last ? `?before=${last.created_at}&before_id=${encodeURIComponent(last.id)}` : ''}`,
        );
        all.push(...page);
        more = page.length === 20;
        if (!more) break;
      }
      if (request === sequence.current) {
        setPosts(all);
        setHasMore(more);
        setFailed(false);
      }
    } catch (e) {
      if (request === sequence.current) {
        setFailed(true);
        errorRef.current(e instanceof Error ? e.message : '分享加载失败');
      }
    } finally {
      if (request === sequence.current) {
        setBusy(false);
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const interval = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      sequence.current++;
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [refreshKey]);
  async function vote(post: Post, value: number) {
    if (voting.includes(post.id)) return;
    setVoting((ids) => [...ids, post.id]);
    try {
      const updated = await api<Post>(
        `/posts/${post.id}/vote`,
        json('POST', { value: post.my_vote === value ? 0 : value }),
      );
      setPosts((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
    } catch (e) {
      onError(e instanceof Error ? e.message : '投票失败');
    } finally {
      setVoting((ids) => ids.filter((id) => id !== post.id));
    }
  }
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow mb-3">GOOD FOOD, SHARED</p>
          <h1 className="text-3xl font-semibold sm:text-4xl">看看大家，最近吃了什么。</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            一点口味，一些照片，把值得再去的理由分享出来。
          </p>
        </div>
        <Button className="min-h-12" onClick={onCompose} disabled={!restaurants.length}>
          <Plus className="mr-2 size-4" />
          写一条分享
        </Button>
      </div>
      <div className="flex items-center justify-between border-b pb-3">
        <p className="text-sm font-medium">餐桌上的新鲜事</p>
        <Button
          variant="ghost"
          className="touch-button text-muted-foreground"
          disabled={busy}
          onClick={() => void load()}
        >
          <RefreshCw className={cn('mr-1.5 size-4', busy && 'animate-spin')} />
          刷新
        </Button>
      </div>
      {loading && (
        <p className="p-12 text-center text-sm text-muted-foreground">正在把大家的分享端上桌…</p>
      )}
      {!loading && !posts.length && (
        <div className="flex flex-col items-center rounded-2xl border border-dashed py-16 text-center">
          <MessageCircle className="mb-4 size-8 text-primary/50" />
          <h2 className="font-medium">
            {failed ? '暂时没有连上餐桌' : '餐桌上，还缺你的第一条分享'}
          </h2>
          <p className="mt-2 px-4 text-sm text-muted-foreground">
            {failed ? '检查连接后，点击刷新再试一次。' : '今天吃得怎么样？一句话，也值得留下来。'}
          </p>
        </div>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {posts.map((post) => (
          <Card key={post.id} className="min-w-0 overflow-hidden shadow-none">
            <CardContent className="p-5 sm:p-6">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-medium text-primary">
                    {Array.from(post.nickname || '匿')[0]}
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">{post.nickname || '匿名饭友'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{post.eaten_on}</p>
                  </div>
                </div>
                <div className="flex shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="touch-button text-muted-foreground"
                    aria-label="编辑分享"
                    onClick={() => onEdit(post)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="touch-button text-muted-foreground"
                    aria-label="删除分享"
                    onClick={() => onDelete(post)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="mb-4">
                <span className="inline-block max-w-full break-words rounded-full bg-secondary px-3 py-1.5 text-xs text-primary">
                  {restaurants.find((r) => r.id === post.restaurant_id)?.name || '饭店已不可用'}
                </span>
              </div>
              {post.body && <Markdown>{post.body}</Markdown>}
              {post.images.length > 0 && (
                <div
                  className={cn(
                    'mt-5 grid gap-2',
                    post.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3',
                  )}
                >
                  {post.images.map((image, index) => (
                    <button
                      key={image.id}
                      onClick={() => setPhoto(image.url)}
                      className="overflow-hidden rounded-lg bg-muted"
                      aria-label={`查看第 ${index + 1} 张照片`}
                    >
                      <img
                        src={image.url}
                        alt={`${restaurants.find((r) => r.id === post.restaurant_id)?.name || '用餐'}照片 ${index + 1}`}
                        className={cn(
                          'w-full object-cover transition-transform hover:scale-[1.02]',
                          post.images.length === 1 ? 'max-h-80' : 'aspect-square',
                        )}
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-5 flex items-center gap-2 border-t pt-3">
                <Button
                  variant={post.my_vote === 1 ? 'secondary' : 'ghost'}
                  className="touch-button rounded-full"
                  aria-label="点赞"
                  aria-pressed={post.my_vote === 1}
                  disabled={voting.includes(post.id)}
                  onClick={() => void vote(post, 1)}
                >
                  <ThumbsUp className="mr-2 size-4" />
                  {post.likes}
                </Button>
                <Button
                  variant={post.my_vote === -1 ? 'secondary' : 'ghost'}
                  className="touch-button rounded-full"
                  aria-label="点踩"
                  aria-pressed={post.my_vote === -1}
                  disabled={voting.includes(post.id)}
                  onClick={() => void vote(post, -1)}
                >
                  <ThumbsDown className="mr-2 size-4" />
                  {post.dislikes}
                </Button>
                <span className="ml-auto text-xs text-muted-foreground">
                  {post.shared_meal_id ? '聚餐时刻' : '好好吃饭'}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {hasMore && (
        <Button
          variant="outline"
          className="min-h-12 w-full"
          disabled={busy}
          onClick={() => {
            depth.current++;
            void load();
          }}
        >
          <ArrowDown className="mr-2 size-4" />
          再看一些分享
        </Button>
      )}
      {photo && (
        <FormModal
          wide
          title="餐桌上的一刻"
          description="点击外侧或关闭按钮返回分享。"
          onClose={() => setPhoto(null)}
        >
          <img
            src={photo}
            alt="用餐照片大图"
            className="max-h-[72dvh] w-full rounded-lg object-contain"
          />
        </FormModal>
      )}
    </div>
  );
}
