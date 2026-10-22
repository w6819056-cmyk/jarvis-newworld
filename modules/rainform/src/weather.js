// Required Notice: Rainform / 数据成雨 © 2026 afterimage — https://rainform.pages.dev/
// Jarvis integration: weather requests are made in the main process through the restricted preload bridge.

export const SERIES_LENGTH = 25;

// —— 当前城市（模块级状态，可通过 setCurrentCity 切换）——
let currentCity = { name: '郑州', lat: '34.75', lon: '113.63', adm1: '河南省' };

export function getCurrentCity() {
  return { ...currentCity };
}

export function setCurrentCity(city) {
  const latNum = Number(city?.lat);
  const lonNum = Number(city?.lon);
  currentCity = {
    name: String(city?.name || '').trim() || '未知城市',
    lat: Number.isFinite(latNum) ? latNum.toFixed(2) : currentCity.lat,
    lon: Number.isFinite(lonNum) ? lonNum.toFixed(2) : currentCity.lon,
    adm1: String(city?.adm1 || '').trim()
  };
  return getCurrentCity();
}

// —— 城市搜索（和风 GeoAPI v2，经 Jarvis 主进程）——
// 返回 [{ name, adm1, lat, lon, id }]，已按相关性/Rank 由服务端排序。
export async function searchCities(query) {
  const keyword = String(query || '').trim();
  if (!keyword) return [];
  if (window.rainformBridge) {
    const results = await window.rainformBridge.searchCities(keyword);
    return results.map((item) => ({ name: item.name, adm1: item.adm1 || '', lat: Number(item.latitude).toFixed(2), lon: Number(item.longitude).toFixed(2), id: item.id || '' }));
  }
  throw new Error('Jarvis 天气服务尚未连接');
}

// —— 实时天气（v7 /weather/now）——
// 返回 { icon: 天气现象代码, text: 中文描述, temp: 温度 }。
export async function fetchNow(lat, lon) {
  if (window.rainformBridge) {
    const now = await window.rainformBridge.currentAt(Number(lat), Number(lon));
    return { icon: String(now.iconCode), text: now.condition, temp: now.temperature, precipitationMm: now.precipitationMm, observedAt: now.observedAt || '' };
  }
  throw new Error('Jarvis 天气服务尚未连接');
}

// 天气现象代码 → 图标（emoji，零外部依赖，通用渲染）。
// 完整代码表见和风「天气现象」文档。
const CONDITION_EMOJI = {
  100: '☀️', 150: '🌙',              // 晴 / 晴(夜间)
  101: '⛅', 102: '🌤️', 103: '🌤️',  // 多云 / 少云 / 晴间多云
  104: '☁️',                          // 阴
  300: '🌦️', 301: '🌦️',              // 阵雨 / 强阵雨
  302: '⛈️', 303: '⛈️', 304: '⛈️',  // 雷阵雨 / 强雷阵雨 / 雷阵雨伴冰雹
  305: '🌧️', 306: '🌧️', 307: '🌧️', 308: '🌧️', 309: '🌧️',
  310: '🌧️', 311: '🌧️', 312: '🌧️', 313: '🌧️', 314: '🌧️',
  315: '🌧️', 316: '🌧️', 317: '🌧️', 318: '🌧️', 399: '🌧️',
  400: '🌨️', 401: '🌨️', 402: '❄️', 403: '❄️',
  404: '🌨️', 405: '🌨️', 406: '🌨️', 407: '🌨️',
  408: '🌨️', 409: '🌨️', 410: '❄️', 499: '❄️',
  500: '🌫️', 501: '🌫️', 509: '🌫️', 510: '🌫️', 514: '🌫️', 515: '🌫️',
  502: '😶‍🌫️', 511: '😶‍🌫️', 512: '😶‍🌫️', 513: '😶‍🌫️',
  503: '💨', 504: '💨', 507: '🌪️', 508: '🌪️',
  900: '🥵', 901: '🥶', 999: '🌡️'
};

export function conditionEmoji(iconCode) {
  return CONDITION_EMOJI[String(iconCode)] || '🌡️';
}

// —— 纯函数：把和风 v1 小时预报接口的 hours 数组映射为 Rainform 需要的 25 点序列 ——
// - 每个点的数值 = 该小时降水强度 precipitation.intensity（mm/h），真实值直接驱动雨幕；
// - 时间标签取 forecastTime 的 HH:MM（请求时已带 localTime=true，即当地时刻）；
// - 接口默认返回 24 条，Rainform 需要 25 个点（含 24:00 端点），端点复用最后一小时；
//   不足 25 条时补 0 兜底。
export function buildForecastSeries(hours) {
  if (!Array.isArray(hours) || hours.length === 0) {
    throw new Error('QWeather 未返回逐小时数据');
  }
  const values = hours.map((item) => {
    const intensity = Number(item?.precipitation?.intensity?.value);
    if (Number.isFinite(intensity) && intensity >= 0) {
      return Math.round(intensity * 10) / 10;
    }
    const amount = Number(item?.precipitation?.amount?.value);
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 10) / 10 : 0;
  });
  const labels = hours.map((item) => {
    const time = String(item?.forecastTime || '');
    return time.length >= 16 ? time.slice(11, 16) : '--:--';
  });

  const paddedValues = [...values, values[values.length - 1]];
  const paddedLabels = [...labels, labels[labels.length - 1]];
  while (paddedValues.length < SERIES_LENGTH) paddedValues.push(0);
  while (paddedLabels.length < SERIES_LENGTH) {
    paddedLabels.push(paddedLabels[paddedLabels.length - 1] || '--:--');
  }

  return {
    values: paddedValues.slice(0, SERIES_LENGTH),
    labels: paddedLabels.slice(0, SERIES_LENGTH)
  };
}

// —— 逐小时预报（按当前城市经纬度，由 Jarvis 主进程请求）——
export async function fetchRainfallForecast() {
  const { lat, lon, name } = currentCity;
  if (!window.rainformBridge) throw new Error('Jarvis 天气服务尚未连接');
  const series = await window.rainformBridge.hourlyForecast(Number(lat), Number(lon));
  return {
    values: series.values,
    labels: series.labels,
    city: name,
    updatedAt: series.updatedAt || ''
  };
}
