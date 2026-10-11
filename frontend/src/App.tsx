import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import {
  BookOpen,
  CheckCircle2,
  CloudOff,
  CalendarDays,
  MapPin,
  MessageCircle,
  RefreshCw,
  Utensils,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
const Composer = lazy(() => import('@/components/composer').then((m) => ({ default: m.Composer })));
import { ConfirmDialog, FormModal, MealDialog } from '@/components/dialogs';
import { LazyBoundary } from '@/components/lazy-boundary';
import { FeedPage } from '@/components/feed-page';
import { RestaurantsPage } from '@/components/restaurants-page';
import { TodayPage } from '@/components/today-page';
import { HistoryPage } from '@/components/history-page';
import { PersonalSyncButton } from '@/components/personal-sync-button';
import { useServerResources } from '@/hooks/use-server-resources';
import { refreshFeed } from '@/hooks/use-feed-query';
import { BowlMark } from '@/components/food-art';
import {
  needsOnboarding,
  Onboarding,
  rememberOnboarding,
  TutorialContext,
} from '@/components/onboarding';
import { api, json } from '@/lib/api';
import {
  addLocalMeal,
  updateLocal,
  subscribeLocal,
  getLocalSnapshot,
  getLocalError,
} from '@/lib/storage';
import { useVisualViewport } from '@/lib/viewport';
import { usePageNavigation } from '@/lib/page-navigation';
import { linkLocalPost, localPostIds } from '@/lib/meal-posts';
import { dataStore, useServerData, type ServerData } from '@/lib/data-store';
import { cn } from '@/lib/utils';
import type {
  ComposeSeed,
  Meal,
  Mode,
  Post,
  Restaurant,
  RestaurantInput,
  Settings,
  Rating,
  FeedScope,
} from '@/lib/types';

const tabs = [
  { id: 'choose', label: '今天吃什么', icon: Utensils },
  { id: 'feed', label: '大家吃了什么', icon: MessageCircle },
  { id: 'history', label: '用餐历史', icon: CalendarDays },
  { id: 'places', label: '饭店管理', icon: MapPin },
] as const;
type Tab = (typeof tabs)[number]['id'];
const pageOrder = tabs.map((tab) => tab.id);
function activeTab(): Tab {
  const value = location.hash.slice(1);
  return tabs.some((tab) => tab.id === value) ? (value as Tab) : 'choose';
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后再试';
}

export default function App() {
  const [guideOpen, setGuideOpen] = useState(needsOnboarding);
  const tab = usePageNavigation(activeTab, pageOrder);
  const [mode, setMode] = useState<Mode>('shared');
  const restaurants = useServerData('restaurants');
  const sharedMeals = useServerData('meals');
  const settings = useServerData('settings');
  const local = useSyncExternalStore(subscribeLocal, getLocalSnapshot);
  const localError = useSyncExternalStore(subscribeLocal, getLocalError);
  const { ready, connectionError, refresh } = useServerResources();
  const additional = useMemo(
    () => (mode === 'local' ? [{ meals: sharedMeals, size: settings.window_size }] : []),
    [mode, sharedMeals, settings.window_size],
  );
  const [notice, setNotice] = useState<{ text: string; error: boolean; retry?: () => void } | null>(
    null,
  );
  const [mealDialog, setMealDialog] = useState<{ initial: Meal } | null>(null);
  const [compose, setCompose] = useState<{ seed: ComposeSeed; edit?: Post } | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    action: () => Promise<void>;
  } | null>(null);
  const [feedReset, setFeedReset] = useState(0);
  const [feedScope, setFeedScope] = useState<FeedScope | null>(null);
  const notify = useCallback(
    (text: string, error = false, retry?: () => void) => setNotice({ text, error, retry }),
    [],
  );
  const report = useCallback((text: string) => notify(text, true), [notify]);
  useEffect(() => {
    if (localError) report(localError);
    setFeedScope((scope) => {
      if (scope?.mode !== 'local') return scope;
      const meal = local.meals.find((row) => row.id === scope.meal.id);
      if (!meal) return null;
      return JSON.stringify(meal) === JSON.stringify(scope.meal) ? scope : { ...scope, meal };
    });
  }, [local, localError, report]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useVisualViewport();

  function mealPatch(state: ServerData, meal: Meal): ServerData {
    return {
      ...state,
      meals: [...state.meals.filter((r) => r.id !== meal.id), meal],
      posts: Object.fromEntries(
        Object.entries(state.posts).map(([id, p]) => [
          id,
          p.shared_meal_id === meal.id
            ? {
                ...p,
                restaurant_id: meal.restaurant_id,
                eaten_on: meal.eaten_on,
                cost_cents: meal.cost_cents,
              }
            : p,
        ]),
      ),
    };
  }
  async function saveMeal(meal: Meal, targetMode: Mode = mode, editing = false) {
    if (targetMode === 'local') {
      if (editing)
        await updateLocal((data) => ({
          ...data,
          meals: data.meals.map((row) => (row.id === meal.id ? meal : row)),
        }));
      else await addLocalMeal(meal);
    } else {
      await dataStore.mutate(
        `meal:${meal.id}`,
        (state) => mealPatch(state, meal),
        async () => {
          if (editing) {
            await api(`/meals/${meal.id}`, json('PUT', meal));
            return meal;
          }
          return api<Meal>('/meals', json('POST', meal));
        },
        (state, saved) => mealPatch(state, saved),
      );
      void refresh();
    }
    setFeedScope((current) =>
      current?.mode === targetMode && current.meal.id === meal.id ? { ...current, meal } : current,
    );
    if (targetMode === 'shared') void refreshFeed();
    setMode(targetMode);
    notify('这顿饭，记下了。');
  }
  function deleteMeal(meal: Meal) {
    const targetMode = mode;
    setConfirm({
      title: '删除这顿饭的记录？',
      description: '用餐窗口会重新计算，已有分享保留。',
      action: async () => {
        if (targetMode === 'local')
          await updateLocal((data) => ({
            ...data,
            meals: data.meals.filter((r) => r.id !== meal.id),
          }));
        else {
          await dataStore.mutate(
            `meal:${meal.id}`,
            (state) => ({
              ...state,
              meals: state.meals.filter((r) => r.id !== meal.id),
              posts: Object.fromEntries(
                Object.entries(state.posts).map(([id, p]) => [
                  id,
                  p.shared_meal_id === meal.id ? { ...p, shared_meal_id: null } : p,
                ]),
              ),
            }),
            () => api(`/meals/${meal.id}`, { method: 'DELETE' }),
          );
          void refresh();
        }
        if (targetMode === 'shared') void refreshFeed();
        notify('已删除用餐记录');
      },
    });
  }
  async function saveWindow(window_size: number) {
    if (mode === 'local') await updateLocal((data) => ({ ...data, window_size }));
    else
      await dataStore.mutate(
        'settings',
        (state) => ({ ...state, settings: { window_size } }),
        () => api<Settings>('/settings', json('PUT', { window_size })),
        (state, saved) => ({ ...state, settings: saved }),
      );
    notify('最近用餐窗口已更新');
  }
  async function saveRestaurant(input: RestaurantInput, original?: Restaurant) {
    if (original) {
      await dataStore.mutate(
        `restaurant:${original.id}`,
        (state) => ({
          ...state,
          restaurants: state.restaurants.map((r) =>
            r.id === original.id
              ? {
                  ...r,
                  name: input.name,
                  ...(input.address !== undefined ? { address: input.address } : {}),
                  ...(input.location !== undefined ? { location: input.location } : {}),
                }
              : r,
          ),
        }),
        () => api(`/restaurants/${original.id}`, json('PUT', input)),
      );
    } else {
      const added = await api<Restaurant>('/restaurants', json('POST', input));
      dataStore.update((state) => ({ ...state, restaurants: [...state.restaurants, added] }));
    }
    await refresh();
    notify('饭店目录已更新');
  }
  function deletePost(post: Post) {
    setConfirm({
      title: '删除这条分享？',
      description: '用餐记录会保留，仍被其他分享或饭店封面使用的图片不会删除。',
      action: async () => {
        await dataStore.mutate(
          `post:${post.id}`,
          (state) => {
            const posts = { ...state.posts };
            delete posts[post.id];
            return { ...state, posts };
          },
          () => api(`/posts/${post.id}`, { method: 'DELETE' }),
        );
        void refreshFeed();
        notify('分享已删除');
      },
    });
  }
  async function created(post: Post, record: string, rating: Rating, localMeal?: Meal) {
    dataStore.update((state) => ({ ...state, posts: { ...state.posts, [post.id]: post } }));
    if (record === 'local')
      await addLocalMeal({
        id: post.id,
        restaurant_id: post.restaurant_id,
        eaten_on: post.eaten_on,
        created_at: post.created_at,
        rating,
        cost_cents: post.cost_cents ?? null,
        post_ids: [post.id],
      });
    if (localMeal) await updateLocal((data) => linkLocalPost(data, localMeal.id, post.id));
    await refreshFeed();
    if (record === 'local' || record === 'shared') setMode(record);
    setFeedScope(null);
    void refresh();
    setFeedReset((value) => value + 1);
    location.hash = 'feed';
    notify('分享已发布，让大家也尝尝这份好心情。');
  }
  function viewMealPosts(meal: Meal) {
    setFeedScope({ meal, mode });
    location.hash = 'feed';
  }
  const navigation = (mobile: boolean) => (
    <nav
      aria-label={mobile ? '手机主导航' : '主导航'}
      className={mobile ? 'menu-mobile-nav grid grid-cols-4' : 'menu-desktop-nav'}
      style={{ '--nav-index': tabs.findIndex((item) => item.id === tab) } as CSSProperties}
    >
      <span className="menu-nav-indicator" aria-hidden="true" />
      {tabs.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          aria-current={tab === item.id ? 'page' : undefined}
          className={cn(
            'menu-nav-link flex min-h-12 items-center gap-2 px-5 text-sm transition-colors',
            mobile && 'flex-col gap-1 rounded-xl px-2 py-2 text-[11px]',
            tab === item.id
              ? 'is-current font-medium text-primary'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          <span className="nav-index" aria-hidden="true">
            {String(tabs.indexOf(item) + 1).padStart(2, '0')}
          </span>
          <item.icon className={mobile ? 'size-5' : 'size-4'} />
          {item.label}
        </a>
      ))}
    </nav>
  );
  return (
    <TutorialContext.Provider value={guideOpen}>
      <a
        href="#main"
        className="sr-only fixed left-4 top-4 z-[100] rounded bg-surface p-3 focus:not-sr-only"
      >
        跳到主要内容
      </a>
      <header className="menu-masthead">
        <div className="masthead-inner">
          <a href="#choose" className="flex items-center gap-3" aria-label="今天吃什么首页">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <BowlMark className="size-6" draw />
            </span>
            <span>
              <span className="block text-base font-semibold tracking-tight">今天吃什么</span>
              <span className="mt-0.5 hidden text-[10px] tracking-[0.15em] text-muted-foreground sm:block">
                选餐 · 分享 · 记下每一顿
              </span>
            </span>
          </a>

          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            <span className="hidden text-xs text-muted-foreground 2xl:block">
              {new Intl.DateTimeFormat('zh-CN', {
                month: 'long',
                day: 'numeric',
                weekday: 'short',
              }).format(new Date())}
            </span>
            <PersonalSyncButton />
            <Button
              variant="ghost"
              data-tour="help"
              aria-label="使用教程"
              className="min-h-11 gap-2 px-3 text-muted-foreground"
              onClick={() => setGuideOpen(true)}
            >
              <BookOpen className="size-4" />
              <span className="hidden sm:inline">使用教程</span>
            </Button>
          </div>
        </div>
      </header>
      <aside className="menu-spine">
        <span className="spine-label">今日菜单</span>
        {navigation(false)}
      </aside>
      <div id="menu-pages" className="menu-pages">
        <main id="main" className="menu-content" data-page={tab} tabIndex={-1}>
          {connectionError && (
            <div
              role="alert"
              className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-warning-border bg-warning p-4 text-sm text-warning-foreground"
            >
              <CloudOff className="size-4 shrink-0" />
              <span className="flex-1">云端暂时没有连上：{connectionError}</span>
              <Button variant="ghost" className="touch-button" onClick={() => void refresh()}>
                <RefreshCw className="mr-2 size-4" />
                重试
              </Button>
            </div>
          )}
          <div hidden={tab !== 'choose'} className="menu-page">
            <TodayPage
              restaurants={restaurants}
              meals={mode === 'shared' ? sharedMeals : local.meals}
              mode={mode}
              size={mode === 'shared' ? settings.window_size : local.window_size}
              ready={ready}
              visible={tab === 'choose'}
              additional={additional}
              onMode={setMode}
              onRecord={(selected) => setCompose({ seed: { mode, selected, intent: 'record' } })}
              onWindow={saveWindow}
            />
          </div>
          <div hidden={tab !== 'history'} className="menu-page">
            <HistoryPage
              restaurants={restaurants}
              meals={mode === 'shared' ? sharedMeals : local.meals}
              mode={mode}
              onMode={setMode}
              onRecord={() => setCompose({ seed: { mode, intent: 'record' } })}
              onEdit={(initial) => setMealDialog({ initial })}
              onDelete={deleteMeal}
              onShare={(meal) => setCompose({ seed: { mode, meal } })}
              onViewPosts={viewMealPosts}
            />
          </div>
          <div hidden={tab !== 'places'} className="menu-page">
            <RestaurantsPage
              restaurants={restaurants}
              ready={ready}
              visible={tab === 'places'}
              onSave={saveRestaurant}
            />
          </div>
          <div hidden={tab !== 'feed'} className="menu-page">
            {ready && (
              <FeedPage
                key={feedReset}
                scope={feedScope}
                onClearScope={() => setFeedScope(null)}
                onBack={() => {
                  setFeedScope(null);
                  location.hash = 'history';
                }}
                restaurants={restaurants}
                visible={tab === 'feed'}
                onCompose={() => setCompose({ seed: guideOpen ? { mode } : feedScope || { mode } })}
                onEdit={(edit) => {
                  const localMeal = local.meals.find((meal) =>
                    localPostIds(meal).includes(edit.id),
                  );
                  setCompose({
                    seed: localMeal ? { mode: 'local', meal: localMeal } : { mode },
                    edit,
                  });
                }}
                onDelete={deletePost}
                onError={report}
              />
            )}
            {!ready && (
              <p className="py-16 text-center text-muted-foreground">
                {connectionError ? '连接恢复后就能看到大家的分享。' : '正在连接大家的餐桌…'}
              </p>
            )}
          </div>
        </main>
      </div>
      <div className="mobile-navigation fixed inset-x-0 bottom-0 z-30 border-t bg-surface/95 px-3 pt-2 backdrop-blur lg:hidden safe-bottom">
        {navigation(true)}
      </div>
      {notice && (
        <div
          role={notice.error ? 'alert' : 'status'}
          className={cn(
            'fixed bottom-24 left-4 right-4 z-[60] flex items-center gap-3 rounded-xl border bg-surface p-4 shadow-lg sm:left-auto sm:max-w-md md:bottom-6',
            notice.error ? 'border-destructive/30 text-destructive' : 'text-primary',
          )}
        >
          {!notice.error && <CheckCircle2 className="size-5 shrink-0" />}
          <p className="flex-1 text-sm leading-6">{notice.text}</p>
          <Button
            variant="ghost"
            size="icon"
            className="touch-button shrink-0"
            aria-label="关闭提示"
            onClick={() => setNotice(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
      {mealDialog && (
        <MealDialog
          restaurants={restaurants}
          mode={mode}
          initial={mealDialog.initial}
          onClose={() => setMealDialog(null)}
          onSave={(meal) => saveMeal(meal, mode, true)}
        />
      )}
      {compose && (
        <LazyBoundary
          fallback={
            <FormModal title="编辑器暂时没有打开" onClose={() => setCompose(null)}>
              <p className="text-sm text-muted-foreground">请刷新页面后重试。</p>
              <Button onClick={() => location.reload()}>刷新页面</Button>
            </FormModal>
          }
        >
          <Suspense
            fallback={
              <FormModal title="正在打开编辑器" onClose={() => setCompose(null)}>
                <p role="status" className="text-sm text-muted-foreground">
                  正在打开…
                </p>
                <Button variant="ghost" onClick={() => setCompose(null)}>
                  取消
                </Button>
              </FormModal>
            }
          >
            <Composer
              restaurants={restaurants}
              seed={compose.seed}
              edit={compose.edit}
              onClose={() => setCompose(null)}
              onCreated={created}
              onRecord={(meal, targetMode) => saveMeal(meal, targetMode)}
              onEdited={async () => {
                dataStore.update((state) => state);
                await refreshFeed();
                notify('分享已更新');
              }}
            />
          </Suspense>
        </LazyBoundary>
      )}
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
      {guideOpen && (
        <Onboarding
          onClose={() => {
            rememberOnboarding();
            setGuideOpen(false);
          }}
        />
      )}
    </TutorialContext.Provider>
  );
}
