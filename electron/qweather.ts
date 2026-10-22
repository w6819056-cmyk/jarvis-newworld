export type QWeatherCity = { id: string; name: string; adm1: string; latitude: number; longitude: number };
export type QWeatherCurrent = {
  temperature: number;
  feelsLike?: number;
  humidity?: number;
  windSpeed?: number;
  condition: string;
  iconCode: number;
  precipitationMm: number;
  observedAt?: string;
};
export type QWeatherForecast = { values: number[]; labels: string[]; updatedAt: string };
type Options = { apiHost: string; apiKey: string; fetcher?: typeof fetch };

function finiteNumber(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function qweatherHost(value: string): string {
  const host = value.trim().toLowerCase();
  if (!/^(?:[a-z0-9-]+\.)+qweatherapi\.com$/.test(host)) throw new Error('和风天气 API Host 无效');
  return host;
}

export function createQWeatherClient(options: Options) {
  const host = qweatherHost(options.apiHost);
  const apiKey = options.apiKey.trim();
  if (!apiKey || apiKey.length > 512) throw new Error('请配置有效的和风天气 API Key');
  const fetcher = options.fetcher ?? fetch;

  async function request(path: string): Promise<any> {
    let response: Response;
    try {
      response = await fetcher(`https://${host}${path}`, {
        headers: { 'X-QW-Api-Key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      throw new Error(`和风天气请求失败：${error instanceof Error && error.name === 'TimeoutError' ? '连接超时' : '网络不可用'}`);
    }
    if (!response.ok) throw new Error(`和风天气服务暂不可用（HTTP ${response.status}）`);
    let payload: any;
    try { payload = await response.json(); }
    catch { throw new Error('和风天气返回了无效数据'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('和风天气返回了无效数据');
    if (payload.code !== '200') throw new Error(`和风天气返回错误（${String(payload.code ?? '未知错误').slice(0, 40)}）`);
    return payload;
  }

  return {
    async searchCities(query: string): Promise<QWeatherCity[]> {
      const keyword = query.trim();
      if (!keyword || keyword.length > 80) throw new Error('城市名称需为 1 到 80 个字符');
      const params = new URLSearchParams({ location: keyword, range: 'cn', number: '8' });
      const payload = await request(`/geo/v2/city/lookup?${params}`);
      if (!Array.isArray(payload.location)) throw new Error('和风天气没有返回城市列表');
      return payload.location.slice(0, 8).flatMap((item: any) => {
        const latitude = finiteNumber(item?.lat);
        const longitude = finiteNumber(item?.lon);
        if (typeof item?.id !== 'string' || !item.id || typeof item?.name !== 'string' || !item.name || latitude === undefined || latitude < -90 || latitude > 90 || longitude === undefined || longitude < -180 || longitude > 180) return [];
        return [{ id: item.id.slice(0, 32), name: item.name.slice(0, 80), adm1: String(item.adm1 ?? item.adm2 ?? '').slice(0, 80), latitude, longitude }];
      });
    },

    async currentAt(latitude: number, longitude: number): Promise<QWeatherCurrent> {
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('位置坐标无效');
      const params = new URLSearchParams({ location: `${longitude.toFixed(2)},${latitude.toFixed(2)}`, lang: 'zh' });
      const payload = await request(`/v7/weather/now?${params}`);
      const now = payload.now;
      const temperature = finiteNumber(now?.temp);
      const iconCode = finiteNumber(now?.icon);
      const precipitationMm = finiteNumber(now?.precip);
      if (temperature === undefined || iconCode === undefined || precipitationMm === undefined || precipitationMm < 0 || typeof now?.text !== 'string' || !now.text) throw new Error('和风天气实况数据不完整');
      const feelsLike = finiteNumber(now.feelsLike);
      const humidity = finiteNumber(now.humidity);
      const windSpeed = finiteNumber(now.windSpeed);
      return {
        temperature, condition: now.text.slice(0, 80), iconCode, precipitationMm,
        ...(feelsLike !== undefined ? { feelsLike } : {}),
        ...(humidity !== undefined ? { humidity } : {}),
        ...(windSpeed !== undefined ? { windSpeed } : {}),
        ...(typeof now.obsTime === 'string' ? { observedAt: now.obsTime.slice(0, 40) } : {}),
      };
    },

    async hourlyForecast(latitude: number, longitude: number): Promise<QWeatherForecast> {
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('位置坐标无效');
      const payload = await request(`/weather/v1/hourly/${latitude.toFixed(2)}/${longitude.toFixed(2)}?hours=24&localTime=true`);
      if (!Array.isArray(payload.hours) || payload.hours.length === 0 || payload.hours.length > 48) throw new Error('和风天气没有返回有效的逐小时降水数据');
      const values = payload.hours.map((item: any) => {
        const intensity = finiteNumber(item?.precipitation?.intensity?.value);
        const amount = finiteNumber(item?.precipitation?.amount?.value);
        const value = intensity ?? amount;
        if (value === undefined || value < 0) throw new Error('和风天气逐小时降水数据无效');
        return Math.round(value * 10) / 10;
      });
      const labels = payload.hours.map((item: any) => typeof item?.forecastTime === 'string' && item.forecastTime.length >= 16 ? item.forecastTime.slice(11, 16) : '--:--');
      values.push(values[values.length - 1]!);
      labels.push(labels[labels.length - 1]!);
      while (values.length < 25) values.push(0);
      while (labels.length < 25) labels.push(labels[labels.length - 1] || '--:--');
      return { values: values.slice(0, 25), labels: labels.slice(0, 25), updatedAt: typeof payload.metadata?.tag === 'string' ? payload.metadata.tag.slice(0, 80) : '' };
    },
  };
}
