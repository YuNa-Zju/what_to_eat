import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFeedQuery } from '@/hooks/use-feed-query';
import { useVoteIdentity } from '@/hooks/use-vote-identity';
import { voteIdentity } from '@/lib/vote-identity';
import {
  ArrowDown,
  ArrowLeft,
  Search,
  Settings,
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
import { PageHeading } from './menu-layout';
import { dataStore, useServerData, votePatch } from '@/lib/data-store';
import { FeedFilters, feedSortOptions } from './feed-filters';
import { Input } from './ui/input';
import { PostPhotos } from './post-photos';
import { MasonryFeed } from './masonry-feed';
import { Markdown } from './markdown';
import { MealCost } from './meal-cost';
import { api, json } from '@/lib/api';
import type { FeedScope, Post, Restaurant } from '@/lib/types';
import { cn } from '@/lib/utils';

export function FeedPage({
  restaurants,
  scope,
  onClearScope,
  onBack,
  visible,
  onCompose,
  onEdit,
  onDelete,
  onError,
}: {
  restaurants: Restaurant[];
  scope: FeedScope | null;
  onClearScope: () => void;
  onBack: () => void;
  visible: boolean;
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
  const [filterOpen, setFilterOpen] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  const closeFilters = () => {
    setFilterOpen(false);
    requestAnimationFrame(() => filterButton.current?.focus({ preventScroll: true }));
  };
  const authorsQuery = useQuery({
    queryKey: ['feed', 'authors'],
    queryFn: ({ signal }) =>
      api<{ nickname: string; count: number }[]>('/posts/authors', { signal }),
    enabled: visible,
    refetchInterval: visible ? 30_000 : false,
  });
  const authors = authorsQuery.data || [];
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
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (query.trim())
    chips.push({
      key: 'query',
      label: `搜索：${query.trim()}`,
      clear: () => {
        setSearch('');
        setQuery('');
      },
    });
  if (restaurant)
    chips.push({
      key: 'restaurant',
      label: `饭店：${restaurants.find((row) => row.id === restaurant)?.name || '已不可用的饭店'}`,
      clear: () => setRestaurant(''),
    });
  if (author !== 'all')
    chips.push({
      key: 'author',
      label: `发布者：${author.slice(5) || '匿名饭友'}`,
      clear: () => setAuthor('all'),
    });
  if (start) chips.push({ key: 'start', label: `从 ${start}`, clear: () => setStart('') });
  if (end) chips.push({ key: 'end', label: `至 ${end}`, clear: () => setEnd('') });
  if (sort !== 'latest')
    chips.push({
      key: 'sort',
      label: `排序：${feedSortOptions.find((option) => option.value === sort)?.label}`,
      clear: () => setSort('latest'),
    });
  const filtered = chips.length > 0;
  const advancedCount = chips.filter((chip) => chip.key !== 'query').length;
  const clearFilters = () => {
    setSearch('');
    setQuery('');
    setRestaurant('');
    setAuthor('all');
    setStart('');
    setEnd('');
    setSort('latest');
  };
  useEffect(() => {
    if (composing) return;
    const timer = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(timer);
  }, [search, composing]);
  const identity = useVoteIdentity();
  const result = useFeedQuery(filters, scope, sort, visible && !invalidDates, identity);
  const storedPosts = useServerData('posts');
  const [localLimit, setLocalLimit] = useState(20);
  useEffect(() => setLocalLimit(20), [filters, scopeKey]);
  const postIds = invalidDates ? [] : result.local ? result.ids.slice(0, localLimit) : result.ids;
  const posts = postIds.map((id) => storedPosts[id]).filter((p): p is Post => !!p);
  const busy = result.busy;
  const loading = result.loading;
  const failed = !!result.error || identity.status === 'error';
  const hasMore = !invalidDates && (result.local ? result.ids.length > localLimit : result.hasMore);
  const [retryVote, setRetryVote] = useState<(() => void) | null>(null);
  const [voting, setVoting] = useState<string[]>([]);
  useEffect(() => setRetryVote(null), [identity.key]);
  const voteKey = (id: string) => `vote:${identity.key}:${id}`;
  const voteDisabled = (id: string) =>
    identity.status !== 'ready' ||
    voting.includes(voteKey(id)) ||
    dataStore.busy(voteKey(id)) ||
    dataStore.busy(`post:${id}`);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  useEffect(() => {
    if (result.error)
      errorRef.current(result.error instanceof Error ? result.error.message : '分享加载失败');
  }, [result.error]);
  const load = () => result.refresh();
  async function vote(post: Post, value: number) {
    const currentIdentity = voteIdentity.getSnapshot();
    if (
      currentIdentity.key !== identity.key ||
      currentIdentity.status !== 'ready' ||
      voteDisabled(post.id)
    )
      return;
    const request = voteIdentity.request();
    const key = voteKey(post.id);
    const target = post.my_vote === value ? 0 : value;
    setVoting((ids) => [...ids, key]);
    setRetryVote(null);
    try {
      await dataStore.mutate(
        key,
        (state) => (request.isCurrent() ? votePatch(post.id, target)(state) : state),
        () =>
          voteIdentity.write(request, (signal) =>
            api<Post>(`/posts/${post.id}/vote`, {
              ...json('POST', { value: target }),
              headers: request.headers,
              signal,
            }),
          ),
        (state, updated) =>
          request.isCurrent()
            ? { ...state, posts: { ...state.posts, [updated.id]: updated } }
            : state,
      );
      if (request.isCurrent() && sort === 'liked') void load();
    } catch (e) {
      if (!request.isCurrent()) return;
      onError(e instanceof Error ? e.message : '投票失败，已恢复');
      setRetryVote(() => () => {
        if (request.isCurrent()) void vote(post, value);
      });
    } finally {
      setVoting((ids) => ids.filter((id) => id !== key));
    }
  }

  return (
    <div className="food-journal space-y-7">
      <PageHeading
        number="02"
        title="饭友食记"
        accessory={
          <Button
            data-tour="share"
            className="min-h-11 gap-2"
            onClick={onCompose}
            disabled={!restaurants.length}
          >
            <Plus className="size-4" />
            写分享
          </Button>
        }
      />
      {identity.status === 'error' && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 border-b py-3 text-sm text-destructive"
        >
          <span>{identity.error}</span>
          <Button variant="ghost" onClick={() => void voteIdentity.retry()}>
            重试同步点赞
          </Button>
        </div>
      )}
      {retryVote && (
        <div
          role="status"
          className="flex items-center justify-between border-b py-3 text-sm text-destructive"
        >
          <span>投票未保存，已恢复</span>
          <Button variant="ghost" onClick={retryVote}>
            重试
          </Button>
        </div>
      )}
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
      <section className="space-y-3" aria-label="搜索与筛选分享">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="搜索分享"
            placeholder="搜索分享"
            value={search}
            maxLength={200}
            onChange={(e) => setSearch(e.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            className="menu-search min-h-12 pl-10 pr-24"
          />
          {search && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-12 top-0.5 size-11"
              aria-label="清空搜索"
              onClick={() => {
                setSearch('');
                setQuery('');
              }}
            >
              <X className="size-4" />
            </Button>
          )}
          <Button
            data-tour="feed-filters"
            ref={filterButton}
            variant="ghost"
            size="icon"
            className={cn(
              'absolute right-0.5 top-0.5 size-11 rounded-lg',
              advancedCount ? 'text-primary' : 'text-muted-foreground',
            )}
            aria-label={`筛选与排序${advancedCount ? `，已启用 ${advancedCount} 项` : ''}`}
            aria-haspopup="dialog"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen(true)}
          >
            <Settings className="size-5" />
            {advancedCount > 0 && (
              <span
                aria-hidden="true"
                className="absolute right-2 top-2 size-2 rounded-full bg-primary ring-2 ring-card"
              />
            )}
          </Button>
        </div>
        {filtered && (
          <div className="flex flex-wrap items-center gap-2" aria-label="已启用的筛选条件">
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.clear}
                aria-label={`清除${chip.label}`}
                className="flex min-h-10 max-w-full items-center gap-2 rounded-full border border-primary/15 bg-secondary/70 px-3 text-xs text-primary transition-colors hover:bg-secondary"
              >
                <span className="min-w-0 truncate">{chip.label}</span>
                <X className="size-3.5 shrink-0" />
              </button>
            ))}
            <Button
              variant="ghost"
              className="min-h-10 px-3 text-xs text-muted-foreground"
              onClick={clearFilters}
            >
              清空全部
            </Button>
          </div>
        )}
      </section>
      {filterOpen && (
        <FeedFilters
          value={{ restaurant, author, sort, start, end }}
          restaurants={restaurants}
          authors={authors}
          onClose={closeFilters}
          onApply={(next) => {
            setRestaurant(next.restaurant);
            setAuthor(next.author);
            setSort(next.sort);
            setStart(next.start);
            setEnd(next.end);
            closeFilters();
          }}
        />
      )}
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
                  : '暂无分享'}
          </h2>
        </div>
      )}
      <MasonryFeed>
        {posts.map((post) => (
          <article key={post.id} className="feed-entry">
            <div className="feed-entry-content">
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
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRestaurant(post.restaurant_id)}
                  className="inline-block min-h-9 max-w-full break-words rounded-full bg-secondary px-3 py-1.5 text-xs text-primary hover:bg-accent"
                >
                  {restaurants.find((r) => r.id === post.restaurant_id)?.name || '饭店已不可用'}
                </button>
                <MealCost cents={post.cost_cents} />
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
                  disabled={voteDisabled(post.id)}
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
                  disabled={voteDisabled(post.id)}
                  onClick={() => void vote(post, -1)}
                >
                  <ThumbsDown className="mr-2 size-4" />
                  {post.dislikes}
                </Button>
                <span className="ml-auto text-xs text-muted-foreground">
                  {post.shared_meal_id ? '聚餐时刻' : '好好吃饭'}
                </span>
              </div>
            </div>
          </article>
        ))}
      </MasonryFeed>
      {hasMore && (
        <Button
          variant="outline"
          className="min-h-12 w-full"
          disabled={busy}
          onClick={() => {
            if (result.local) setLocalLimit((n) => n + 20);
            else void result.next();
          }}
        >
          <ArrowDown className="mr-2 size-4" />
          再看一些分享
        </Button>
      )}
    </div>
  );
}
