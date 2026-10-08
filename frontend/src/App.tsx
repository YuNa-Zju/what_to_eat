import { useCallback, useEffect, useRef, useState } from 'react';
import {
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
import { Composer } from '@/components/composer';
import { ConfirmDialog, MealDialog } from '@/components/dialogs';
import { FeedPage } from '@/components/feed-page';
import { RestaurantsPage } from '@/components/restaurants-page';
import { TodayPage } from '@/components/today-page';
import { HistoryPage } from '@/components/history-page';
import { BowlMark } from '@/components/food-art';
import { api, json } from '@/lib/api';
import { addLocalMeal, readLocal, updateLocal } from '@/lib/storage';
import { useVisualViewport } from '@/lib/viewport';
import { linkLocalPost, localPostIds } from '@/lib/meal-posts';
import { cn } from '@/lib/utils';
import type {
  ComposeSeed,
  LocalData,
  Meal,
  Mode,
  Post,
  Restaurant,
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
function activeTab(): Tab {
  const value = location.hash.slice(1);
  return tabs.some((tab) => tab.id === value) ? (value as Tab) : 'choose';
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后再试';
}

export default function App() {
  const [tab, setTab] = useState<Tab>(activeTab);
  const [mode, setMode] = useState<Mode>('shared');
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [sharedMeals, setSharedMeals] = useState<Meal[]>([]);
  const [settings, setSettings] = useState<Settings>({ window_size: 5 });
  const [local, setLocal] = useState<LocalData>({ version: 1, window_size: 5, meals: [] });
  const [ready, setReady] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [mealDialog, setMealDialog] = useState<{ initial?: Meal; selected?: string } | null>(null);
  const [compose, setCompose] = useState<{ seed: ComposeSeed; edit?: Post } | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    action: () => Promise<void>;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [feedReset, setFeedReset] = useState(0);
  const [feedScope, setFeedScope] = useState<FeedScope | null>(null);
  const request = useRef(0);
  const notify = useCallback((text: string, error = false) => setNotice({ text, error }), []);
  const report = useCallback((text: string) => notify(text, true), [notify]);
  const refresh = useCallback(async () => {
    const generation = ++request.current;
    try {
      const [places, history, config] = await Promise.all([
        api<Restaurant[]>('/restaurants'),
        api<Meal[]>('/meals'),
        api<Settings>('/settings'),
      ]);
      if (generation === request.current) {
        setRestaurants(places);
        setSharedMeals(history);
        setSettings(config);
        setReady(true);
        setConnectionError('');
      }
    } catch (error) {
      if (generation === request.current) setConnectionError(errorMessage(error));
    }
  }, []);
  useEffect(() => {
    const hash = () => {
      setTab(activeTab());
      window.scrollTo({ top: 0 });
    };
    const storage = () => {
      try {
        setLocal(readLocal());
      } catch (error) {
        report(errorMessage(error));
      }
    };
    storage();
    // Establish one visitor cookie before other API calls.
    void api('/health')
      .then(refresh)
      .catch((error) => setConnectionError(errorMessage(error)));
    const focus = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
        storage();
      }
    };
    const interval = setInterval(focus, 30000);
    window.addEventListener('hashchange', hash);
    window.addEventListener('storage', storage);
    window.addEventListener('focus', focus);
    return () => {
      request.current++;
      clearInterval(interval);
      window.removeEventListener('hashchange', hash);
      window.removeEventListener('storage', storage);
      window.removeEventListener('focus', focus);
    };
  }, [refresh, report]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useVisualViewport();

  async function saveMeal(meal: Meal) {
    if (mode === 'local') {
      if (mealDialog?.initial)
        setLocal(
          updateLocal((data) => ({
            ...data,
            meals: data.meals.map((row) => (row.id === meal.id ? meal : row)),
          })),
        );
      else setLocal(addLocalMeal(meal));
    } else {
      if (mealDialog?.initial) {
        await api(`/meals/${meal.id}`, json('PUT', meal));
        setSharedMeals((rows) => rows.map((row) => (row.id === meal.id ? meal : row)));
      } else {
        const saved = await api<Meal>('/meals', json('POST', meal));
        setSharedMeals((rows) => [...rows.filter((row) => row.id !== saved.id), saved]);
      }
      void refresh();
    }
    notify('这顿饭，记下了。');
  }
  function deleteMeal(meal: Meal) {
    setConfirm({
      title: '删除这顿饭的记录？',
      description: `${mode === 'shared' ? '大家的' : '本地'}最近用餐窗口会重新计算，已有分享不会删除。`,
      action: async () => {
        if (mode === 'local')
          setLocal(
            updateLocal((data) => ({
              ...data,
              meals: data.meals.filter((row) => row.id !== meal.id),
            })),
          );
        else {
          await api(`/meals/${meal.id}`, { method: 'DELETE' });
          setSharedMeals((rows) => rows.filter((row) => row.id !== meal.id));
          void refresh();
        }
        notify('已删除用餐记录');
      },
    });
  }
  async function saveWindow(window_size: number) {
    if (mode === 'local') setLocal(updateLocal((data) => ({ ...data, window_size })));
    else {
      const saved = await api<Settings>('/settings', json('PUT', { window_size }));
      setSettings(saved);
    }
    notify('最近用餐窗口已更新');
  }
  async function saveRestaurant(name: string, original?: Restaurant) {
    if (original) {
      await api(`/restaurants/${original.id}`, json('PUT', { name, active: original.active }));
      setRestaurants((rows) =>
        rows.map((row) => (row.id === original.id ? { ...original, name } : row)),
      );
    } else {
      const added = await api<Restaurant>('/restaurants', json('POST', { name, active: true }));
      setRestaurants((rows) => [...rows, added]);
    }
    void refresh();
    notify('共享饭店名单已更新');
  }
  function toggleRestaurant(restaurant: Restaurant) {
    setConfirm({
      title: `${restaurant.active ? '暂时停用' : '恢复'}「${restaurant.name}」？`,
      description: restaurant.active
        ? '它将退出大家的候选名单，已有记录和分享会保留。'
        : '它将重新出现在大家的候选名单中。',
      action: async () => {
        await api(
          `/restaurants/${restaurant.id}`,
          json('PUT', { name: restaurant.name, active: !restaurant.active }),
        );
        setRestaurants((rows) =>
          rows.map((row) => (row.id === restaurant.id ? { ...row, active: !row.active } : row)),
        );
        void refresh();
        notify('共享饭店名单已更新');
      },
    });
  }
  function deletePost(post: Post) {
    setConfirm({
      title: '删除这条分享？',
      description:
        '这条分享将从大家的页面移除。没有其他分享引用的照片会从服务器删除，用餐历史仍保留。',
      action: async () => {
        await api(`/posts/${post.id}`, { method: 'DELETE' });
        setRefreshKey((value) => value + 1);
        notify('分享已删除');
      },
    });
  }
  async function created(post: Post, record: string, rating: Rating, localMeal?: Meal) {
    if (record === 'local')
      setLocal(
        addLocalMeal({
          id: post.id,
          restaurant_id: post.restaurant_id,
          eaten_on: post.eaten_on,
          created_at: post.created_at,
          rating,
          post_ids: [post.id],
        }),
      );
    if (localMeal) setLocal(updateLocal((data) => linkLocalPost(data, localMeal.id, post.id)));
    setFeedScope(null);
    setRefreshKey((value) => value + 1);
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
      className={mobile ? 'grid grid-cols-4' : 'flex gap-1'}
    >
      {tabs.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          aria-current={tab === item.id ? 'page' : undefined}
          className={cn(
            'flex min-h-12 items-center justify-center gap-2 rounded-full px-5 text-sm transition-colors',
            mobile && 'flex-col gap-1 rounded-xl px-2 py-2 text-[11px]',
            tab === item.id
              ? 'bg-secondary font-medium text-primary'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          <item.icon className={mobile ? 'size-5' : 'size-4'} />
          {item.label}
        </a>
      ))}
    </nav>
  );
  return (
    <>
      <a
        href="#main"
        className="sr-only fixed left-4 top-4 z-[100] rounded bg-surface p-3 focus:not-sr-only"
      >
        跳到主要内容
      </a>
      <header className="border-b bg-background/90">
        <div className="page-shell flex min-h-20 items-center justify-between gap-5">
          <a href="#choose" className="flex items-center gap-3" aria-label="今天吃什么首页">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <BowlMark className="size-6" />
            </span>
            <span>
              <span className="block text-base font-semibold tracking-tight">今天吃什么</span>
              <span className="mt-0.5 block text-[10px] tracking-[0.15em] text-muted-foreground">
                GOOD FOOD, GOOD COMPANY
              </span>
            </span>
          </a>
          <div className="hidden lg:block">{navigation(false)}</div>
          <span className="hidden text-xs text-muted-foreground xl:block">
            {new Intl.DateTimeFormat('zh-CN', {
              month: 'long',
              day: 'numeric',
              weekday: 'short',
            }).format(new Date())}
          </span>
        </div>
      </header>
      <main
        id="main"
        className="page-shell min-h-[75dvh] pb-32 pt-8 sm:pt-12 lg:pb-16"
        tabIndex={-1}
      >
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
        {tab === 'choose' && (
          <TodayPage
            restaurants={restaurants}
            meals={mode === 'shared' ? sharedMeals : local.meals}
            mode={mode}
            size={mode === 'shared' ? settings.window_size : local.window_size}
            ready={ready}
            onMode={setMode}
            onRecord={(selected) => setMealDialog({ selected })}
            onEdit={(initial) => setMealDialog({ initial })}
            onDelete={deleteMeal}
            onShare={(meal) => setCompose({ seed: { mode, meal } })}
            onViewPosts={viewMealPosts}
            onWindow={saveWindow}
          />
        )}
        {tab === 'history' && (
          <HistoryPage
            restaurants={restaurants}
            meals={mode === 'shared' ? sharedMeals : local.meals}
            mode={mode}
            size={mode === 'shared' ? settings.window_size : local.window_size}
            onMode={setMode}
            onRecord={() => setMealDialog({})}
            onEdit={(initial) => setMealDialog({ initial })}
            onDelete={deleteMeal}
            onShare={(meal) => setCompose({ seed: { mode, meal } })}
            onViewPosts={viewMealPosts}
          />
        )}
        {tab === 'places' && (
          <RestaurantsPage
            restaurants={restaurants}
            ready={ready}
            onSave={saveRestaurant}
            onToggle={toggleRestaurant}
          />
        )}
        {tab === 'feed' && ready && (
          <FeedPage
            key={feedReset}
            scope={feedScope}
            onClearScope={() => setFeedScope(null)}
            onBack={() => {
              setFeedScope(null);
              location.hash = 'history';
            }}
            restaurants={restaurants}
            refreshKey={refreshKey}
            onCompose={() => setCompose({ seed: feedScope || { mode } })}
            onEdit={(edit) => {
              const localMeal = local.meals.find((meal) => localPostIds(meal).includes(edit.id));
              setCompose({ seed: localMeal ? { mode: 'local', meal: localMeal } : { mode }, edit });
            }}
            onDelete={deletePost}
            onError={report}
          />
        )}
        {tab === 'feed' && !ready && (
          <p className="py-16 text-center text-muted-foreground">
            {connectionError ? '连接恢复后就能看到大家的分享。' : '正在连接大家的餐桌…'}
          </p>
        )}
      </main>
      <footer className="page-shell hidden items-center justify-between border-t py-6 text-xs text-muted-foreground lg:flex">
        <span>少一点纠结，多一点好好吃饭。</span>
        <span>一起维护 · 一起发现</span>
      </footer>
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
          selected={mealDialog.selected}
          onClose={() => setMealDialog(null)}
          onSave={saveMeal}
        />
      )}
      {compose && (
        <Composer
          restaurants={restaurants}
          seed={compose.seed}
          edit={compose.edit}
          onClose={() => setCompose(null)}
          onCreated={created}
          onEdited={async () => {
            setRefreshKey((value) => value + 1);
            notify('分享已更新');
          }}
        />
      )}
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </>
  );
}
