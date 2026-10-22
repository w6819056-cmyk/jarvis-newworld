import { randomBytes } from 'node:crypto';

export type UiForeground = { handle: string; title: string; processName: string; processId: number };
export type UiProbeControl = {
  runtimeId: number[];
  role: string;
  name: string;
  enabled: boolean;
  focused: boolean;
  password: boolean;
  patterns: string[];
};
export type UiAutomationProbe = {
  inspect(): Promise<{ foreground: UiForeground; controls: UiProbeControl[] }>;
  perform(request: { foregroundHandle: string; runtimeId: number[]; action: UiAction }): Promise<{ foregroundHandle: string; verified: boolean; state: string }>;
};
export type UiAction =
  | { type: 'invoke' }
  | { type: 'setValue'; text: string }
  | { type: 'select' }
  | { type: 'scroll'; direction: 'up' | 'down'; amount: number };
export type UiActionRequest = { controlId: string; action: UiAction };
export type UiInspection = { foreground: UiForeground; controls: Array<Omit<UiProbeControl, 'runtimeId' | 'password'> & { id: string }> };
export type UiActionResult = { success: boolean; verified: boolean; state?: string; error?: string };

type Handle = { foreground: UiForeground; control: UiProbeControl; expiresAt: number };

const MAX_CONTROLS = 200;
const MAX_DEPTH = 12;

export class UiAutomationSession {
  public readonly probe: UiAutomationProbe;
  private readonly handles = new Map<string, Handle>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private foregroundHandle = '';

  constructor(probe: UiAutomationProbe, options: { now?: () => number; ttlMs?: number } = {}) {
    this.probe = probe;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 30_000;
  }

  async inspect(): Promise<UiInspection> {
    const snapshot = await this.probe.inspect();
    this.foregroundHandle = snapshot.foreground.handle;
    this.handles.clear();
    const controls = snapshot.controls.slice(0, MAX_CONTROLS).map(control => {
      const id = randomBytes(12).toString('hex');
      this.handles.set(id, { foreground: snapshot.foreground, control, expiresAt: this.now() + this.ttlMs });
      return {
        id,
        role: control.role.slice(0, 80),
        name: control.name.slice(0, 200),
        enabled: control.enabled,
        focused: control.focused,
        patterns: control.patterns.filter(pattern => ['invoke', 'setValue', 'select', 'scroll'].includes(pattern)),
      };
    });
    return { foreground: snapshot.foreground, controls };
  }

  async act(request: UiActionRequest): Promise<UiActionResult> {
    const handle = this.handles.get(request.controlId);
    if (!handle || handle.expiresAt <= this.now()) return { success: false, verified: false, error: '控件句柄已过期，请重新检查前台窗口' };
    if (handle.foreground.handle !== this.foregroundHandle) return { success: false, verified: false, error: '前台窗口已变化，请重新检查' };
    if (!handle.control.enabled) return { success: false, verified: false, error: '控件当前不可用' };
    const validation = validateAction(handle.control, request.action);
    if (validation) return { success: false, verified: false, error: validation };
    const current = await this.probe.inspect();
    if (current.foreground.handle !== handle.foreground.handle) return { success: false, verified: false, error: '执行前前台窗口已变化，请重新检查' };
    const result = await this.probe.perform({ foregroundHandle: handle.foreground.handle, runtimeId: handle.control.runtimeId, action: request.action });
    if (result.foregroundHandle !== handle.foreground.handle) return { success: false, verified: false, error: '执行期间前台窗口已变化，动作未确认' };
    if (!result.verified) return { success: false, verified: false, state: result.state, error: '动作已发送但结果未核验' };
    return { success: true, verified: true, state: result.state };
  }
}

function validateAction(control: UiProbeControl, action: UiAction): string | undefined {
  if (!action || typeof action !== 'object' || !['invoke', 'setValue', 'select', 'scroll'].includes(action.type)) return '动作类型不受支持';
  if (!control.patterns.includes(action.type)) return '控件不支持该动作';
  if (action.type === 'setValue') {
    if (control.password) return '出于安全原因不允许操作密码框';
    if (typeof action.text !== 'string' || action.text.length > 2_000) return '输入文本长度必须为 2000 字符以内';
  }
  if (action.type === 'scroll' && (!Number.isInteger(action.amount) || action.amount < 1 || action.amount > 20)) return '滚动幅度必须为 1 到 20';
  return undefined;
}
