import { useEffect, useRef, useState } from 'react';
import { LocateFixed, School, Search, X } from 'lucide-react';
import { loadMap, type SDK } from '@/lib/amap';
import { clusterMapPoints, MAP_MARKER_HEIGHT, MAP_MARKER_WIDTH } from '@/lib/map-clusters';
import restaurantPlaceholder from '@/assets/restaurant-placeholder.svg?no-inline';
import type { Restaurant, RestaurantLocation } from '@/lib/types';
import { Button } from './ui/button';
import { Input } from './ui/input';

// AMap POI B023B02GYJ: Zhejiang University Yuquan campus (GCJ-02).
const YUQUAN_CENTER: [number, number] = [120.122946, 30.263776];
const YUQUAN_ZOOM = 15;
const NO_RESTAURANTS: Restaurant[] = [];

function restaurantMarkerContent(restaurants: Restaurant[], onClick: () => void) {
  const first = restaurants[0];
  const grouped = restaurants.length > 1;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'map-restaurant-marker';
  button.style.width = `${MAP_MARKER_WIDTH}px`;
  button.dataset.count = String(restaurants.length);
  button.title = restaurants.map((r) => r.name).join('、');
  button.setAttribute(
    'aria-label',
    grouped ? `${first.name}等${restaurants.length}家饭店，展开选择` : `查看${first.name}`,
  );
  if (grouped) button.setAttribute('aria-expanded', 'false');
  const photo = document.createElement('img');
  photo.src = first.cover?.url || restaurantPlaceholder;
  photo.alt = '';
  photo.draggable = false;
  const text = document.createElement('span');
  text.className = 'map-marker-copy';
  const name = document.createElement('span');
  name.className = 'map-marker-name';
  name.textContent = first.name;
  text.append(name);
  if (grouped) {
    const hint = document.createElement('span');
    hint.className = 'map-marker-hint';
    hint.textContent = `另有 ${restaurants.length - 1} 家`;
    text.append(hint);
  }
  button.append(photo, text);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  button.addEventListener('dblclick', (event) => event.stopPropagation());
  return button;
}

function pickedMarkerContent() {
  const point = document.createElement('div');
  point.className = 'map-picked-marker';
  point.setAttribute('role', 'img');
  point.setAttribute('aria-label', '饭店位置，可拖动调整');
  return point;
}

interface SearchResult {
  id?: string;
  name: string;
  address: string;
  location: { lng: number; lat: number };
}
export function RestaurantMap({
  restaurants = NO_RESTAURANTS,
  selected,
  onPick,
  onSelect,
  active = true,
  initialQuery = '',
}: {
  restaurants?: Restaurant[];
  selected?: RestaurantLocation | null;
  active?: boolean;
  initialQuery?: string;
  onPick?: (location: RestaurantLocation, address?: string) => void;
  onSelect?: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<SDK>(null),
    sdk = useRef<SDK>(null);
  const markers = useRef<SDK[]>([]),
    pickMarker = useRef<SDK>(null),
    generation = useRef(0);
  const clusterPanel = useRef<HTMLDivElement>(null),
    clusterTrigger = useRef<HTMLButtonElement | null>(null);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const expandedRestaurants = expandedIds
    .map((id) => restaurants.find((r) => r.id === id))
    .filter((r): r is Restaurant => !!r);
  const callbacks = useRef({ onPick, onSelect });
  callbacks.current = { onPick, onSelect };
  const [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState(initialQuery),
    [results, setResults] = useState<SearchResult[]>([]),
    [searching, setSearching] = useState(false);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    setReady(false);
    setError('');
    loadMap()
      .then((A) => {
        if (disposed || !host.current) return;
        sdk.current = A;
        map.current = new A.Map(host.current, {
          resizeEnable: true,
          viewMode: '2D',
          zoom: YUQUAN_ZOOM,
          center: YUQUAN_CENTER,
          mapStyle: matchMedia('(prefers-color-scheme: dark)').matches
            ? 'amap://styles/dark'
            : 'amap://styles/normal',
        });
        const dark = matchMedia('(prefers-color-scheme: dark)');
        const theme = () =>
          map.current?.setMapStyle(dark.matches ? 'amap://styles/dark' : 'amap://styles/normal');
        dark.addEventListener('change', theme);
        map.current.__themeCleanup = () => dark.removeEventListener('change', theme);
        map.current.on('click', (e: SDK) => {
          if (!callbacks.current.onPick) return;
          const n = ++generation.current;
          setSearching(false);
          const point: RestaurantLocation = {
            lng: e.lnglat.lng,
            lat: e.lnglat.lat,
            coordinate_system: 'gcj02',
          };
          callbacks.current.onPick(point);
          new A.Geocoder().getAddress([point.lng, point.lat], (status: string, result: SDK) => {
            if (!disposed && n === generation.current && status === 'complete')
              callbacks.current.onPick?.(point, result.regeocode?.formattedAddress);
          });
        });
        setReady(true);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
      generation.current++;
      setSearching(false);
      setResults([]);
      setExpandedIds([]);
      markers.current = [];
      pickMarker.current = null;
      map.current?.__themeCleanup?.();
      map.current?.destroy();
      map.current = null;
    };
  }, [active, attempt]);
  useEffect(() => {
    if (!ready || !active || !map.current) return;
    const currentMap = map.current;
    const A = sdk.current;
    let frame = 0;
    let disposed = false;
    const renderMarkers = () => {
      if (disposed || !host.current) return;
      const { clientWidth: width, clientHeight: height } = host.current;
      const points = restaurants.flatMap((restaurant) => {
        if (!restaurant.location) return [];
        const { lng, lat } = restaurant.location;
        const point = currentMap.lngLatToContainer(new A.LngLat(lng, lat));
        const x = point.getX(),
          y = point.getY();
        // Keep visible labels inside the canvas before clustering, including at its edges.
        if (x < 0 || x > width || y < 0 || y > height) return [];
        const insetX = Math.min(width / 2, MAP_MARKER_WIDTH / 2 + 8);
        return [
          {
            restaurant,
            x: Math.max(insetX, Math.min(width - insetX, x)),
            y: Math.max(MAP_MARKER_HEIGHT + 8, Math.min(height - 8, y)),
          },
        ];
      });
      // Rebuilding removes the trigger DOM, so close its list and return keyboard focus safely.
      if (clusterPanel.current?.contains(document.activeElement))
        host.current.focus({ preventScroll: true });
      clusterTrigger.current?.setAttribute('aria-expanded', 'false');
      clusterTrigger.current = null;
      setExpandedIds((ids) => (ids.length ? [] : ids));
      currentMap.remove(markers.current);
      markers.current = clusterMapPoints(points).map((group) => {
        const first = group.restaurants[0];
        const content = restaurantMarkerContent(group.restaurants, () => {
          if (group.restaurants.length === 1) callbacks.current.onSelect?.(first.id);
          else {
            clusterTrigger.current?.setAttribute('aria-expanded', 'false');
            clusterTrigger.current = content;
            content.setAttribute('aria-expanded', 'true');
            setExpandedIds(group.restaurants.map((r) => r.id));
          }
        });
        const position = [first.location!.lng, first.location!.lat];
        const projected = currentMap.lngLatToContainer(new A.LngLat(...position));
        const offsetX = group.x - projected.getX();
        content.style.setProperty(
          '--marker-tip-left',
          `${Math.max(4, Math.min(MAP_MARKER_WIDTH - 12, MAP_MARKER_WIDTH / 2 - 4 - offsetX))}px`,
        );
        return new A.Marker({
          position,
          content,
          anchor: 'bottom-center',
          offset: new A.Pixel(offsetX, group.y - projected.getY()),
          bubble: false,
        });
      });
      currentMap.add(markers.current);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(renderMarkers);
    };
    renderMarkers();
    currentMap.on('moveend', schedule);
    currentMap.on('zoomend', schedule);
    currentMap.on('complete', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(host.current!);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      // The map's own effect may already have destroyed this instance on close.
      if (map.current === currentMap) {
        currentMap.off('moveend', schedule);
        currentMap.off('zoomend', schedule);
        currentMap.off('complete', schedule);
        currentMap.remove(markers.current);
        markers.current = [];
      }
    };
  }, [ready, restaurants, active]);
  useEffect(() => {
    if (expandedIds.length)
      clusterPanel.current
        ?.querySelector<HTMLButtonElement>('[data-restaurant-id]')
        ?.focus({ preventScroll: true });
  }, [expandedIds]);
  useEffect(() => {
    if (!ready || !active || !map.current) return;
    if (pickMarker.current) map.current.remove(pickMarker.current);
    if (!selected) return;
    pickMarker.current = new sdk.current.Marker({
      content: pickedMarkerContent(),
      position: [selected.lng, selected.lat],
      anchor: 'bottom-center',
      bubble: false,
      draggable: !!onPick,
    });
    pickMarker.current.on('dragend', (e: SDK) => {
      generation.current++;
      setSearching(false);
      callbacks.current.onPick?.({
        lng: e.lnglat.lng,
        lat: e.lnglat.lat,
        coordinate_system: 'gcj02',
      });
    });
    map.current.add(pickMarker.current);
    map.current.setZoomAndCenter(16, [selected.lng, selected.lat]);
  }, [selected, ready, active]);
  function closeCluster() {
    setExpandedIds([]);
    clusterTrigger.current?.setAttribute('aria-expanded', 'false');
    if (clusterTrigger.current?.isConnected) clusterTrigger.current.focus({ preventScroll: true });
    else host.current?.focus({ preventScroll: true });
  }
  function search() {
    if (!query.trim() || !ready) return;
    setExpandedIds([]);
    const n = ++generation.current;
    setSearching(true);
    setError('');
    new sdk.current.PlaceSearch({ pageSize: 6, city: '330100', citylimit: false }).search(
      query.trim(),
      (status: string, result: SDK) => {
        if (n !== generation.current || !map.current) return;
        setSearching(false);
        const rows = status === 'complete' ? result.poiList?.pois || [] : [];
        setResults(
          rows
            .filter((r: SDK) => r.location)
            .map((r: SDK) => ({
              ...r,
              address: [r.pname, r.cityname, r.adname, r.address].filter(Boolean).join(''),
            })),
        );
        if (!rows.length) {
          const info = typeof result === 'string' ? result : result?.info;
          const code = typeof info === 'string' && /^[A-Z_]{3,50}$/.test(info) ? `（${info}）` : '';
          setError(
            status === 'no_data'
              ? '没有找到地点，可以直接在地图上选点'
              : `搜索不可用${code}，可重试或手动选点`,
          );
        }
      },
    );
  }
  function returnToYuquan() {
    if (!ready || !map.current) return;
    generation.current++;
    setSearching(false);
    setResults([]);
    setExpandedIds([]);
    setError('');
    map.current.setZoomAndCenter(YUQUAN_ZOOM, YUQUAN_CENTER);
  }
  function locate() {
    if (!ready) return;
    const n = ++generation.current;
    setSearching(false);
    new sdk.current.Geolocation({ enableHighAccuracy: true, timeout: 10000 }).getCurrentPosition(
      (status: string, result: SDK) => {
        if (n !== generation.current || !map.current) return;
        if (status === 'complete') {
          map.current.setZoomAndCenter(16, result.position);
          setError('');
        } else setError('未能取得当前位置，可搜索城市或拖动地图');
      },
    );
  }
  return (
    <div className="restaurant-map">
      <div className="mb-3 flex shrink-0 gap-2">
        <Input
          aria-label="搜索地图地点"
          placeholder="搜索杭州的地址或饭店"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              search();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          aria-label="搜索地图"
          disabled={!ready || searching}
          onClick={search}
        >
          <Search className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-label="回到玉泉校区"
          title="回到玉泉校区"
          disabled={!ready}
          onClick={returnToYuquan}
        >
          <School className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-label="定位到我附近"
          disabled={!ready}
          onClick={locate}
        >
          <LocateFixed className="size-4" />
        </Button>
      </div>
      {!!results.length && (
        <div className="map-results">
          {results.map((p, i) => (
            <button
              type="button"
              key={p.id || i}
              onClick={() => {
                generation.current++;
                map.current?.setZoomAndCenter(16, [p.location.lng, p.location.lat]);
                callbacks.current.onPick?.(
                  {
                    lng: p.location.lng,
                    lat: p.location.lat,
                    coordinate_system: 'gcj02',
                    poi_id: p.id,
                  },
                  p.address,
                );
                setResults([]);
              }}
            >
              <strong>{p.name}</strong>
              <span>{p.address}</span>
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="status" className="my-3 flex items-center gap-3 text-sm text-muted-foreground">
          {error}
          {!ready && (
            <Button type="button" variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
              重试
            </Button>
          )}
        </p>
      )}
      <div className="map-stage">
        <div ref={host} className="map-canvas" aria-label="饭店位置地图" tabIndex={-1} />
        {!!expandedRestaurants.length && (
          <div
            ref={clusterPanel}
            className="map-cluster-panel"
            role="region"
            aria-label="附近饭店选择"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeCluster();
              }
            }}
          >
            <div className="map-cluster-heading">
              <strong>这一带有 {expandedRestaurants.length} 家</strong>
              <button type="button" aria-label="收起附近饭店" onClick={closeCluster}>
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="map-cluster-list">
              {expandedRestaurants.map((restaurant) => (
                <button
                  type="button"
                  key={restaurant.id}
                  data-restaurant-id={restaurant.id}
                  onClick={() => callbacks.current.onSelect?.(restaurant.id)}
                >
                  <img src={restaurant.cover?.url || restaurantPlaceholder} alt="" />
                  <span>
                    <strong>{restaurant.name}</strong>
                    {restaurant.address && <small>{restaurant.address}</small>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {!ready && !error && (
        <p className="py-3 text-sm text-muted-foreground" role="status">
          正在展开地图…
        </p>
      )}
    </div>
  );
}
