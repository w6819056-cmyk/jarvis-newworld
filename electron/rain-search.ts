export type RainCity = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  countryCode: string;
  sourceName?: string;
  admin1Code?: string;
  featureCode?: string;
};

export type RainObservation = {
  condition: string;
  iconCode: number;
  precipitationMm: number;
  observedAt?: string;
};

export type RainSearchResult = {
  status: 'found' | 'none' | 'incomplete';
  city?: RainCity;
  distanceMeters?: number;
  current?: RainObservation;
  partial: boolean;
  unresolvedCloserCities: number;
  unresolvedCities: number;
};

type Location = { latitude: number; longitude: number };
type Options = { readCurrent(city: RainCity): Promise<RainObservation>; now?: () => number };

const EARTH_RADIUS_METERS = 6_371_008.8;
const CACHE_TTL_MS = 10 * 60 * 1000;
const BATCH_SIZE = 8;

function validLocation(location: Location): boolean {
  return Number.isFinite(location.latitude) && location.latitude >= -90 && location.latitude <= 90
    && Number.isFinite(location.longitude) && location.longitude >= -180 && location.longitude <= 180;
}

export function haversineMeters(from: Location, to: Location): number {
  if (!validLocation(from) || !validLocation(to)) throw new Error('位置坐标无效');
  const radians = Math.PI / 180;
  const latitudeDelta = (to.latitude - from.latitude) * radians;
  const longitudeDelta = (to.longitude - from.longitude) * radians;
  const fromLatitude = from.latitude * radians;
  const toLatitude = to.latitude * radians;
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, a)));
}

function validateObservation(value: RainObservation): RainObservation {
  if (!value || typeof value.condition !== 'string' || value.condition.length > 80
    || !Number.isFinite(value.iconCode) || !Number.isFinite(value.precipitationMm)
    || value.precipitationMm < 0) throw new Error('天气实况数据无效');
  return { ...value, condition: value.condition.trim() };
}

function validCity(city: RainCity): boolean {
  return typeof city?.id === 'string' && city.id.length > 0
    && typeof city.name === 'string' && city.name.length > 0
    && city.countryCode === 'CN' && validLocation(city);
}

export function createRainSearchService(options: Options) {
  const cache = new Map<string, { expiresAt: number; observation: RainObservation }>();
  const now = options.now ?? Date.now;

  function isRaining(current: RainObservation): boolean {
    const observation = validateObservation(current);
    return (observation.iconCode >= 300 && observation.iconCode < 400)
      || observation.precipitationMm > 0
      || /雨|雷/.test(observation.condition);
  }

  async function read(city: RainCity): Promise<RainObservation> {
    const cached = cache.get(city.id);
    if (cached && cached.expiresAt > now()) return cached.observation;
    if (cached) cache.delete(city.id);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = validateObservation(await options.readCurrent(city));
        cache.set(city.id, { observation: result, expiresAt: now() + CACHE_TTL_MS });
        return result;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('天气实况查询失败');
  }

  async function findNearestRainyCity(input: { origin: Location; cities: RainCity[] }): Promise<RainSearchResult> {
    if (!validLocation(input.origin)) throw new Error('当前位置坐标无效');
    if (!Array.isArray(input.cities) || input.cities.some(city => !validCity(city))) throw new Error('城市目录数据无效');
    const ordered = input.cities.map(city => ({ city, distanceMeters: haversineMeters(input.origin, city) }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters || a.city.name.localeCompare(b.city.name, 'zh-CN') || a.city.id.localeCompare(b.city.id));
    const unresolved: Array<{ distanceMeters: number }> = [];

    for (let start = 0; start < ordered.length; start += BATCH_SIZE) {
      const batch = ordered.slice(start, start + BATCH_SIZE);
      const checked = await Promise.all(batch.map(async candidate => {
        try { return { ...candidate, current: await read(candidate.city) }; }
        catch { unresolved.push({ distanceMeters: candidate.distanceMeters }); return null; }
      }));
      const rainy = checked.filter((item): item is NonNullable<typeof item> => item !== null && isRaining(item.current))
        .sort((a, b) => a.distanceMeters - b.distanceMeters || a.city.name.localeCompare(b.city.name, 'zh-CN'));
      if (rainy.length > 0) {
        const nearest = rainy[0]!;
        const unresolvedCloserCities = unresolved.filter(item => item.distanceMeters <= nearest.distanceMeters).length;
        return {
          status: 'found', city: nearest.city, distanceMeters: Math.round(nearest.distanceMeters), current: nearest.current,
          partial: unresolvedCloserCities > 0, unresolvedCloserCities, unresolvedCities: unresolved.length,
        };
      }
    }

    return {
      status: unresolved.length ? 'incomplete' : 'none', partial: unresolved.length > 0,
      unresolvedCloserCities: unresolved.length, unresolvedCities: unresolved.length,
    };
  }

  return { findNearestRainyCity, isRaining, clearCache: () => cache.clear() };
}
