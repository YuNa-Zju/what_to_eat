import { api } from './api';
import type { RestaurantLocation } from './types';

// The provider is loaded only when a visible map is requested.
export type SDK = any;
let sdkPromise: Promise<SDK> | undefined;
export async function loadMap(): Promise<SDK> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = (async () => {
    const config = await api<{ enabled: boolean; key?: string }>('/maps/config');
    if (!config.enabled || !config.key) throw new Error('地图尚未配置，仍可保存照片和地址');
    const w = window as unknown as { AMap?: SDK; _AMapSecurityConfig?: { serviceHost: string } };
    if (w.AMap) return w.AMap;
    w._AMapSecurityConfig = { serviceHost: `${location.origin}/_AMapService` };
    return new Promise<SDK>((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => {
        script.remove();
        reject(new Error('地图加载超时，请重试'));
      }, 15000);
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.key!)}&plugin=AMap.PlaceSearch,AMap.Geocoder,AMap.Geolocation`;
      script.onload = () => {
        clearTimeout(timer);
        if (w.AMap) resolve(w.AMap);
        else reject(new Error('地图暂时不可用'));
      };
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        reject(new Error('地图暂时不可用，请检查网络或配置'));
      };
      document.head.append(script);
    });
  })();
  sdkPromise.catch(() => {
    sdkPromise = undefined;
  });
  return sdkPromise;
}

/** Called only after the user explicitly enables distance weighting. */
export async function locateForRecommendation(signal: AbortSignal): Promise<RestaurantLocation> {
  if (!window.isSecureContext || !navigator.geolocation)
    throw new Error('当前浏览器无法定位，请使用 HTTPS 或本地预览');
  const A = await loadMap();
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => fail(new DOMException('定位已取消', 'AbortError'));
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('定位超时，可以重试或继续按喜好挑选')), 12000);
    signal.addEventListener('abort', abort, { once: true });
    const locator = new A.Geolocation({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
      convert: true,
      noIpLocate: 3,
      needAddress: false,
      showButton: false,
      showMarker: false,
      showCircle: false,
    });
    locator.getCurrentPosition((status: string, result: SDK) => {
      if (settled) return;
      if (status !== 'complete' || !result?.position) {
        fail(new Error('未能取得当前位置，请检查定位权限后重试'));
        return;
      }
      if (result.location_type === 'ip' || (result.accuracy && result.accuracy > 1000)) {
        fail(new Error('当前位置不够准确，请稍后重新定位'));
        return;
      }
      const { lng, lat } = result.position;
      if (
        !Number.isFinite(lng) ||
        !Number.isFinite(lat) ||
        Math.abs(lng) > 180 ||
        Math.abs(lat) > 90
      ) {
        fail(new Error('定位结果无效，请重新定位'));
        return;
      }
      cleanup();
      resolve({ lng, lat, coordinate_system: 'gcj02' });
    });
  });
}
