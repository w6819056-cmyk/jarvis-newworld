type WeatherOptions = { city?: string; fetcher?: typeof fetch };
export type WeatherResult = {
  city: string;
  country?: string;
  latitude: number;
  longitude: number;
  temperature: number;
  feelsLike?: number;
  humidity?: number;
  windSpeed?: number;
  weatherCode: number;
  condition: string;
  updatedAt?: string;
  locationMode: 'current' | 'named';
};

const weatherText: Record<number, string> = {
  0: '晴朗', 1: '大致晴朗', 2: '局部多云', 3: '阴天', 45: '有雾', 48: '冻雾',
  51: '毛毛雨', 53: '中等毛毛雨', 55: '强毛毛雨', 56: '冻毛毛雨', 57: '强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨', 71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
  80: '阵雨', 81: '中等阵雨', 82: '强阵雨', 85: '阵雪', 86: '强阵雪', 95: '雷暴', 96: '雷暴伴小冰雹', 99: '雷暴伴强冰雹',
};

async function getJson(fetcher: typeof fetch, url: URL, label: string): Promise<any> {
  let response: Response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
  } catch (error) {
    throw new Error(`${label}请求失败：${error instanceof Error && error.name === 'TimeoutError' ? '连接超时' : '网络不可用'}`);
  }
  if (!response.ok) throw new Error(`${label}服务暂不可用（HTTP ${response.status}）`);
  try { return await response.json(); }
  catch { throw new Error(`${label}返回了无效数据`); }
}

export function formatWeatherSpeech(result: WeatherResult): string {
  const feels = typeof result.feelsLike === 'number' ? `，体感 ${result.feelsLike}°C` : '';
  const humidity = typeof result.humidity === 'number' ? `，湿度 ${result.humidity}%` : '';
  const wind = typeof result.windSpeed === 'number' ? `，风速 ${result.windSpeed} km/h` : '';
  return `${result.city}当前天气：${result.condition}，气温 ${result.temperature}°C${feels}${humidity}${wind}。`;
}

export async function lookupWeather(options: WeatherOptions = {}): Promise<WeatherResult> {
  const fetcher = options.fetcher ?? fetch;
  let city = options.city?.trim();
  const locationMode = city ? 'named' : 'current';
  if (options.city !== undefined && (!city || city.length > 80)) throw new Error('城市名称需为 1 到 80 个字符');
  if (!city) {
    const location = await getJson(fetcher, new URL('https://ipwho.is/'), '城市定位');
    if (typeof location?.city !== 'string' || !location.city.trim() || location.success === false) throw new Error('无法根据当前网络定位城市，请在指令里说出城市名称');
    city = location.city.trim();
  }
  const cityName = city;
  if (!cityName) throw new Error('无法确定查询城市，请在指令里说出城市名称');

  const geocodeUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geocodeUrl.search = new URLSearchParams({ name: cityName, count: '1', language: 'zh', format: 'json' }).toString();
  const geocode = await getJson(fetcher, geocodeUrl, '城市查询');
  const place = geocode?.results?.[0];
  if (!place || typeof place.latitude !== 'number' || typeof place.longitude !== 'number') throw new Error(`找不到城市“${cityName}”，请说出更具体的城市名称`);

  const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
  forecastUrl.search = new URLSearchParams({
    latitude: String(place.latitude), longitude: String(place.longitude), current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m', timezone: 'auto',
  }).toString();
  const forecast = await getJson(fetcher, forecastUrl, '天气服务');
  const current = forecast?.current;
  if (!current || typeof current.temperature_2m !== 'number' || typeof current.weather_code !== 'number') throw new Error('天气服务返回的数据不完整');
  const name = typeof place.name === 'string' ? place.name : city;
  const condition = weatherText[current.weather_code] ?? '天气状况未知';
  return {
    city: name,
    ...(typeof place.country === 'string' && place.country ? { country: place.country } : {}),
    latitude: place.latitude,
    longitude: place.longitude,
    temperature: current.temperature_2m,
    ...(typeof current.apparent_temperature === 'number' ? { feelsLike: current.apparent_temperature } : {}),
    ...(typeof current.relative_humidity_2m === 'number' ? { humidity: current.relative_humidity_2m } : {}),
    ...(typeof current.wind_speed_10m === 'number' ? { windSpeed: current.wind_speed_10m } : {}),
    weatherCode: current.weather_code,
    condition,
    ...(typeof current.time === 'string' ? { updatedAt: current.time } : {}),
    locationMode,
  };
}
