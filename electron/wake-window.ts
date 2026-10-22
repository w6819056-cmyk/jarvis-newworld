export interface WakeWindow {
  isMinimized(): boolean;
  restore(): void;
  setAlwaysOnTop(flag: boolean, level?: string): void;
  show(): void;
  focus(): void;
}

export function showWakeWindow(window: WakeWindow) {
  if (window.isMinimized()) window.restore();
  window.setAlwaysOnTop(true, 'floating');
  window.show();
  window.focus();
}
