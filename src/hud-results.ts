import type { WeatherDisplay } from '../electron/protocol';

export type HudResult = { id: number; text: string; pending: boolean; weather?: WeatherDisplay };

export class HudResults {
  private nextId = 1;
  private results: HudResult[] = [];

  begin(): number {
    const id = this.nextId++;
    this.results.push({ id, text: '', pending: true });
    return id;
  }

  update(id: number, text: string, pending: boolean): void {
    const result = this.results.find(item => item.id === id);
    if (!result) return;
    result.text = text;
    result.pending = pending;
  }

  updateWeather(id: number, weather: WeatherDisplay): void {
    const result = this.results.find(item => item.id === id);
    if (!result) return;
    result.weather = { ...weather };
    result.text = `${weather.city}当前天气：${weather.condition}，气温 ${weather.temperature}°C。`;
    result.pending = false;
  }

  close(id: number): void {
    this.results = this.results.filter(item => item.id !== id);
  }

  items(): readonly HudResult[] {
    return this.results.map(item => ({ ...item }));
  }
}
