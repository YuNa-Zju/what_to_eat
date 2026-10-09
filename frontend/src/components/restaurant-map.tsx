import { useEffect, useRef, useState } from 'react';
import { LocateFixed, Search } from 'lucide-react';
import { loadMap, type SDK } from '@/lib/amap';
import type { Restaurant, RestaurantLocation } from '@/lib/types';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface SearchResult {
  id?: string;
  name: string;
  address: string;
  location: { lng: number; lat: number };
}
export function RestaurantMap({
  restaurants = [],
  selected,
  onPick,
  onSelect,
  active = true,
}: {
  restaurants?: Restaurant[];
  selected?: RestaurantLocation | null;
  active?: boolean;
  onPick?: (location: RestaurantLocation, address?: string) => void;
  onSelect?: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<SDK>(null),
    sdk = useRef<SDK>(null);
  const markers = useRef<SDK[]>([]),
    pickMarker = useRef<SDK>(null),
    generation = useRef(0);
  const fitted = useRef('');
  const callbacks = useRef({ onPick, onSelect });
  callbacks.current = { onPick, onSelect };
  const [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<SearchResult[]>([]),
    [searching, setSearching] = useState(false);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    setReady(false);
    fitted.current = '';
    setError('');
    loadMap()
      .then((A) => {
        if (disposed || !host.current) return;
        sdk.current = A;
        map.current = new A.Map(host.current, {
          viewMode: '2D',
          zoom: 4,
          center: [104.2, 35.8],
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
      markers.current = [];
      pickMarker.current = null;
      map.current?.__themeCleanup?.();
      map.current?.destroy();
      map.current = null;
    };
  }, [active, attempt]);
  useEffect(() => {
    if (!ready || !active || !map.current) return;
    map.current.remove(markers.current);
    markers.current = restaurants
      .filter((r) => r.location)
      .map((r) => {
        const marker = new sdk.current.Marker({
          position: [r.location!.lng, r.location!.lat],
          title: r.name,
        });
        marker.on('click', () => callbacks.current.onSelect?.(r.id));
        return marker;
      });
    map.current.add(markers.current);
    const fitKey = restaurants
      .filter((r) => r.location)
      .map((r) => `${r.id}:${r.location!.lng}:${r.location!.lat}`)
      .join(',');
    if (markers.current.length && fitted.current !== fitKey)
      map.current.setFitView(markers.current, false, [45, 45, 45, 45], 16);
    fitted.current = fitKey;
  }, [ready, restaurants, active]);
  useEffect(() => {
    if (!ready || !active || !map.current) return;
    if (pickMarker.current) map.current.remove(pickMarker.current);
    if (!selected) return;
    pickMarker.current = new sdk.current.Marker({
      position: [selected.lng, selected.lat],
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
  function search() {
    if (!query.trim() || !ready) return;
    const n = ++generation.current;
    setSearching(true);
    setError('');
    new sdk.current.PlaceSearch({ pageSize: 6 }).search(
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
      <div className="mb-3 flex gap-2">
        <Input
          aria-label="搜索地图地点"
          placeholder="搜索城市、地址或饭店"
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
      <div ref={host} className="map-canvas" aria-label="饭店位置地图" />
      {!ready && !error && (
        <p className="py-3 text-sm text-muted-foreground" role="status">
          正在展开地图…
        </p>
      )}
    </div>
  );
}
