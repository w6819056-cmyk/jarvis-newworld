import type { MapController } from '../modules/holo-map/protocol';
import type { RainformController } from '../modules/rainform/control';
import type { QWeatherCity, QWeatherCurrent, QWeatherForecast } from './qweather';
import type { RainCity, RainObservation, RainSearchResult } from './rain-search';
import { haversineMeters } from './rain-search';

type WeatherClient = {
  searchCities(query: string): Promise<QWeatherCity[]>;
  currentAt(latitude: number, longitude: number): Promise<QWeatherCurrent>;
  hourlyForecast(latitude: number, longitude: number): Promise<QWeatherForecast>;
};

type Options = {
  map: Pick<MapController, 'getCurrentLocation'>;
  rainSearch: { findNearestRainyCity(input: { origin: { latitude: number; longitude: number }; cities: RainCity[] }): Promise<RainSearchResult> };
  getWeather(): WeatherClient;
  rainform: Pick<RainformController, 'setCity'>;
  cities: RainCity[];
};

export class RainformOrchestrator {
  constructor(private readonly options: Options) {}

  async findNearestRainyCity(): Promise<string> {
    const location = await this.options.map.getCurrentLocation();
    const result = await this.options.rainSearch.findNearestRainyCity({
      origin: { latitude: location.latitude, longitude: location.longitude },
      cities: this.options.cities,
    });
    if (result.status === 'none') return '已检查支持的中国城市目录，当前没有查到正在下雨的城市。';
    if (result.status === 'incomplete') return `当前无法确认最近的下雨城市：有 ${result.unresolvedCities} 个城市实况查询失败，且没有验证到下雨城市。`;
    if (!result.city || !result.current || result.distanceMeters === undefined) throw new Error('最近雨城搜索返回的数据不完整');
    const city = await this.resolveProviderCity(result.city.name, result.city);
    const weather = this.options.getWeather();
    const [current, forecast] = await Promise.all([
      weather.currentAt(city.latitude, city.longitude),
      weather.hourlyForecast(city.latitude, city.longitude),
    ]);
    const visualization = await this.updateRainform(city, current, forecast);
    const nearest = result.partial ? '最近已验证正在下雨的城市' : '最近正在下雨的城市';
    const locationLabel = location.address ? `（从${location.address}约${this.formatDistance(result.distanceMeters)}）` : `（约${this.formatDistance(result.distanceMeters)}）`;
    const unresolved = result.partial ? `；另有 ${result.unresolvedCloserCities} 个更近城市未能确认` : '';
    return `${nearest}是${city.name}${locationLabel}，当前${current.condition}，实况降水 ${current.precipitationMm} mm${current.observedAt ? `（${current.observedAt}）` : ''}${unresolved}。${visualization}`;
  }

  async showCityRain(query: string): Promise<string> {
    if (typeof query !== 'string' || !query.trim() || query.length > 80) throw new Error('城市名称需为 1 到 80 个字符');
    const matches = await this.options.getWeather().searchCities(query.trim());
    if (!matches.length) throw new Error(`没有找到“${query.trim()}”对应的城市`);
    const exact = matches.filter(city => this.normalizeCity(city.name) === this.normalizeCity(query));
    const candidates = exact.length ? exact : matches;
    if (candidates.length > 1) {
      const list = candidates.slice(0, 5).map(city => `${city.adm1}${city.name}`).join('、');
      return `找到多个同名或相近城市：${list}。请指定省份后再查询。`;
    }
    const city = candidates[0]!;
    const weather = this.options.getWeather();
    const [current, forecast] = await Promise.all([
      weather.currentAt(city.latitude, city.longitude),
      weather.hourlyForecast(city.latitude, city.longitude),
    ]);
    const visualization = await this.updateRainform(city, current, forecast);
    return `${city.adm1 ? `${city.adm1} ` : ''}${city.name}当前${current.condition}，实况降水 ${current.precipitationMm} mm${current.observedAt ? `（${current.observedAt}）` : ''}。${visualization}`;
  }

  private async resolveProviderCity(name: string, source: RainCity): Promise<QWeatherCity> {
    try {
      const matches = await this.options.getWeather().searchCities(name);
      const closest = matches.slice().sort((a, b) =>
        haversineMeters(source, a) - haversineMeters(source, b))[0];
      if (closest && haversineMeters(source, closest) <= 100_000) return closest;
    } catch { /* Coordinates remain sufficient for QWeather weather endpoints. */ }
    return { id: source.id.slice(0, 32), name, adm1: '', latitude: source.latitude, longitude: source.longitude };
  }

  private async updateRainform(city: QWeatherCity, current: QWeatherCurrent, forecast: QWeatherForecast): Promise<string> {
    try {
      await this.options.rainform.setCity({ city, current, forecast });
      return 'Rainform 已切换到该城市。';
    } catch {
      return '天气已查到，但 Rainform 窗口未能打开或更新。';
    }
  }

  private normalizeCity(value: string): string {
    return value.trim().replace(/[市地区县州盟]$/u, '');
  }

  private formatDistance(meters: number): string {
    return meters >= 10_000 ? `${(meters / 1000).toFixed(0)} 公里` : `${(meters / 1000).toFixed(1)} 公里`;
  }
}
