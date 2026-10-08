import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  Search,
  X,
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
import { Choice } from './ui/choice';
import { DatePicker } from './ui/date-picker';
import { Input } from './ui/input';
import { localPostIds, sortPosts } from '@/lib/meal-posts';
import { PostPhotos } from './post-photos';
import { MasonryFeed } from './masonry-feed';
import { Markdown } from './markdown';
import { api, json } from '@/lib/api';
import type { FeedScope, Post, Restaurant } from '@/lib/types';
import { cn } from '@/lib/utils';

export function FeedPage({
  restaurants,
  scope,
  onClearScope,
  onBack,
  refreshKey,
  onCompose,
  onEdit,
  onDelete,
  onError,
}: {
  restaurants: Restaurant[];
  scope: FeedScope | null;
  onClearScope: () => void;
  onBack: () => void;
  refreshKey: number;
  onCompose: () => void;
  onEdit: (post: Post) => void;
  onDelete: (post: Post) => void;
  onError: (error: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [restaurant, setRestaurant] = useState('');
  const [author, setAuthor] = useState('all');
  const [sort, setSort] = useState('latest');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [authors, setAuthors] = useState<{ nickname: string; count: number }[]>([]);
  const invalidDates = !!start && !!end && start > end;
  const scopeKey = JSON.stringify(scope);
  const params = new URLSearchParams({ sort });
  if (query.trim()) params.set('q', query.trim());
  if (restaurant) params.set('restaurant_id', restaurant);
  if (author !== 'all') params.set('nickname', author.slice(5));
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  if (scope?.mode === 'shared') params.set('meal_id', scope.meal.id);
  const filters = params.toString();
  const filtered = !!query || !!restaurant || author !== 'all' || !!start || !!end;
  const clearFilters = () => {
    setSearch('');
    setQuery('');
    setRestaurant('');
    setAuthor('all');
    setStart('');
    setEnd('');
  };
  useEffect(() => {
    if (composing) return;
    const timer = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(timer);
  }, [search, composing]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [voting, setVoting] = useState<string[]>([]);
  const depth = useRef(1);
  const sequence = useRef(0);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const load = useCallback(async () => {
    const request = ++sequence.current;
    if (invalidDates) {
      setPosts([]);
      setLoading(false);
      setBusy(false);
      setHasMore(false);
      return;
    }
    setBusy(true);
    try {
      let all: Post[] = [];
      let more = false;
      const currentScope = JSON.parse(scopeKey) as FeedScope | null;
      if (currentScope?.mode === 'local') {
        const ids = localPostIds(currentScope.meal);
        // Keep local meal IDs private: only the linked public post IDs are queried.
        for (let batch = 0; batch < ids.length; batch += 100) {
          const subset = ids.slice(batch, batch + 100);
          for (let offset = 0; offset < subset.length; offset += 20) {
            const p = new URLSearchParams(filters);
            p.set('ids', subset.join(','));
            p.set('offset', String(offset));
            const page = await api<Post[]>(`/posts?${p}`);
            if (request !== sequence.current) return;
            all.push(...page);
            if (page.length < 20) break;
          }
        }
        all = sortPosts(all, sort);
        more = all.length > depth.current * 20;
        all = all.slice(0, depth.current * 20);
      } else {
        for (let i = 0; i < depth.current; i++) {
          const p = new URLSearchParams(filters);
          p.set('offset', String(i * 20));
          const page = await api<Post[]>(`/posts?${p}`);
          if (request !== sequence.current) return;
          all.push(...page);
          more = page.length === 20;
          if (!more) break;
        }
      }
      if (request === sequence.current) {
        setPosts([...new Map(all.map((post) => [post.id, post])).values()]);
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
  }, [filters, scopeKey, invalidDates, sort]);
  useEffect(() => {
    depth.current = 1;
    setPosts([]);
    setLoading(true);
    setHasMore(false);
  }, [filters, scopeKey]);
  useEffect(() => {
    void load();
    let alive = true;
    const loadAuthors = () => {
      void api<{ nickname: string; count: number }[]>('/posts/authors')
        .then((rows) => {
          if (alive) setAuthors(rows);
        })
        .catch(() => {});
    };
    loadAuthors();
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void load();
        loadAuthors();
      }
    };
    const interval = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      sequence.current++;
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [refreshKey, load]);
  async function vote(post: Post, value: number) {
    if (voting.includes(post.id)) return;
    setVoting((ids) => [...ids, post.id]);
    try {
      const updated = await api<Post>(
        `/posts/${post.id}/vote`,
        json('POST', { value: post.my_vote === value ? 0 : value }),
      );
      setPosts((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      if (sort === 'liked') void load();
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
      {scope && (
        <section
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-secondary/50 p-4"
          aria-label="关联用餐"
        >
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {scope.mode === 'shared' ? '这次聚餐的分享' : '这顿本地用餐的分享'}
            </p>
            <h2 className="mt-1 break-words font-medium">
              {restaurants.find((r) => r.id === scope.meal.restaurant_id)?.name || '用餐记录'} ·{' '}
              {scope.meal.eaten_on}
            </h2>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" className="touch-button" onClick={onBack}>
              <ArrowLeft className="mr-1.5 size-4" />
              返回历史
            </Button>
            <Button
              variant="outline"
              className="touch-button"
              onClick={() => {
                clearFilters();
                onClearScope();
              }}
            >
              查看全部分享
            </Button>
          </div>
        </section>
      )}
      <section
        className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5"
        aria-label="搜索与筛选分享"
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-muted-foreground" />
          <Input
            aria-label="搜索分享"
            placeholder="搜索感受、菜名、饭店或昵称…"
            value={search}
            maxLength={200}
            onChange={(e) => setSearch(e.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            className="min-h-11 bg-surface pl-10 pr-10"
          />
          {search && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 touch-button"
              aria-label="清空搜索"
              onClick={() => {
                setSearch('');
                setQuery('');
              }}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="min-w-0 space-y-1.5">
            <label htmlFor="feed-restaurant" className="text-xs text-muted-foreground">
              饭店
            </label>
            <Choice
              id="feed-restaurant"
              label="筛选饭店"
              value={restaurant}
              onChange={setRestaurant}
              searchable
              options={[
                { value: '', label: '所有饭店' },
                ...restaurants.map((r) => ({ value: r.id, label: r.name })),
              ]}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <label htmlFor="feed-author" className="text-xs text-muted-foreground">
              发布者
            </label>
            <Choice
              id="feed-author"
              label="发布者"
              value={author}
              onChange={setAuthor}
              searchable
              options={[
                { value: 'all', label: '所有饭友' },
                ...authors.map((a) => ({
                  value: `name:${a.nickname}`,
                  label: a.nickname || '匿名饭友',
                  detail: `${a.count} 条分享`,
                })),
              ]}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <label htmlFor="feed-sort" className="text-xs text-muted-foreground">
              排序
            </label>
            <Choice
              id="feed-sort"
              label="分享排序"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'latest', label: '最新发布' },
                { value: 'oldest', label: '最早发布' },
                { value: 'liked', label: '最多点赞' },
                { value: 'eaten', label: '最近用餐' },
              ]}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <label htmlFor="feed-start" className="text-xs text-muted-foreground">
              用餐开始日期
            </label>
            <DatePicker
              id="feed-start"
              label="用餐开始日期"
              value={start}
              onChange={setStart}
              clearable
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <label htmlFor="feed-end" className="text-xs text-muted-foreground">
              用餐结束日期
            </label>
            <DatePicker
              id="feed-end"
              label="用餐结束日期"
              value={end}
              onChange={setEnd}
              clearable
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>按昵称查找饭友，同名分享归在一起。</p>
          {filtered && (
            <Button variant="ghost" className="touch-button text-xs" onClick={clearFilters}>
              清除筛选
            </Button>
          )}
        </div>
        {invalidDates && (
          <p role="alert" className="text-sm text-destructive">
            开始日期不能晚于结束日期。
          </p>
        )}
      </section>
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
            {failed
              ? '暂时没有连上餐桌'
              : scope
                ? '这顿饭还没有匹配的分享'
                : filtered
                  ? '没有找到匹配的分享'
                  : '餐桌上，还缺你的第一条分享'}
          </h2>
          <p className="mt-2 px-4 text-sm text-muted-foreground">
            {failed
              ? '检查连接后，点击刷新再试一次。'
              : filtered
                ? '换个关键词或清除筛选试试。'
                : scope
                  ? '可以写下这顿饭的感受，或查看全部分享。'
                  : '今天吃得怎么样？一句话，也值得留下来。'}
          </p>
        </div>
      )}
      <MasonryFeed>
        {posts.map((post) => (
          <Card key={post.id} className="min-w-0 overflow-hidden shadow-none">
            <CardContent className="p-5 sm:p-6">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-medium text-primary">
                    {Array.from(post.nickname || '匿')[0]}
                  </span>
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="break-words text-left text-sm font-medium hover:text-primary"
                      aria-label={`查看 ${post.nickname || '匿名饭友'} 的分享`}
                      onClick={() => setAuthor(`name:${post.nickname}`)}
                    >
                      {post.nickname || '匿名饭友'}
                    </button>
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
                <button
                  type="button"
                  onClick={() => setRestaurant(post.restaurant_id)}
                  className="inline-block min-h-9 max-w-full break-words rounded-full bg-secondary px-3 py-1.5 text-xs text-primary hover:bg-accent"
                >
                  {restaurants.find((r) => r.id === post.restaurant_id)?.name || '饭店已不可用'}
                </button>
              </div>
              {post.body && <Markdown>{post.body}</Markdown>}
              <PostPhotos
                images={post.images}
                restaurant={restaurants.find((r) => r.id === post.restaurant_id)?.name || '用餐'}
              />
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
      </MasonryFeed>
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
    </div>
  );
}
