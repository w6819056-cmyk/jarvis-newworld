export type RainformWeatherUpdate = {
  city: { id: string; name: string; adm1: string; latitude: number; longitude: number };
  current: { condition: string; iconCode: number; precipitationMm: number; observedAt?: string };
  forecast: { values: number[]; labels: string[]; updatedAt: string };
};

export type RainformCommandEnvelope = {
  id: number;
  type: 'setCity';
  payload: RainformWeatherUpdate;
};

export type RainformResponseEnvelope = { id: number; success: boolean; error?: string };

export type RainformCity = {
  id: string;
  name: string;
  adm1: string;
  latitude: number;
  longitude: number;
};

function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));
}

export function validateRainformUpdate(value: unknown): RainformWeatherUpdate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Rainform 城市天气数据无效');
  const update = value as Record<string, any>;
  const city = update.city;
  const current = update.current;
  const forecast = update.forecast;
  if (!exactKeys(update, ['city', 'current', 'forecast']) || !city || typeof city !== 'object' || Array.isArray(city)
    || !exactKeys(city, ['id', 'name', 'adm1', 'latitude', 'longitude'])
    || typeof city.id !== 'string' || !city.id || city.id.length > 32
    || typeof city.name !== 'string' || !city.name.trim() || city.name.length > 80
    || typeof city.adm1 !== 'string' || city.adm1.length > 80
    || !Number.isFinite(city.latitude) || city.latitude < -90 || city.latitude > 90
    || !Number.isFinite(city.longitude) || city.longitude < -180 || city.longitude > 180) throw new Error('Rainform 城市信息无效');
  if (!current || typeof current !== 'object' || Array.isArray(current)
    || !exactKeys(current, ['condition', 'iconCode', 'precipitationMm', ...(current.observedAt === undefined ? [] : ['observedAt'])])
    || typeof current.condition !== 'string' || current.condition.length > 80
    || !Number.isFinite(current.iconCode) || current.iconCode < 0 || current.iconCode > 999
    || !Number.isFinite(current.precipitationMm) || current.precipitationMm < 0 || current.precipitationMm > 10000
    || (current.observedAt !== undefined && (typeof current.observedAt !== 'string' || current.observedAt.length > 40))) throw new Error('Rainform 实况数据无效');
  if (!forecast || typeof forecast !== 'object' || Array.isArray(forecast)
    || !exactKeys(forecast, ['values', 'labels', 'updatedAt'])
    || !Array.isArray(forecast.values) || forecast.values.length !== 25
    || forecast.values.some((value: unknown) => !Number.isFinite(value) || Number(value) < 0 || Number(value) > 10000)
    || !Array.isArray(forecast.labels) || forecast.labels.length !== 25
    || forecast.labels.some((value: unknown) => typeof value !== 'string' || value.length > 8)
    || typeof forecast.updatedAt !== 'string' || forecast.updatedAt.length > 80) throw new Error('Rainform 逐小时预报数据无效');
  return structuredClone(update) as RainformWeatherUpdate;
}
