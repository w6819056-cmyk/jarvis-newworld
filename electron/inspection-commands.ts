export type InspectionCommand = 'enter' | 'exit';

const ENTER_PHRASES = new Set([
  '检查一下战甲',
  '检查战甲',
  '检查下战甲',
  '检测一下战甲',
  '查看一下战甲',
  '看一下战甲',
  '检查一下盔甲',
  '检查一下机甲',
  '检查机甲',
  '检查下机甲',
  '检测一下机甲',
  '查看一下机甲',
  '看一下机甲',
  '检查一下铠甲',
]);

export function matchInspectionCommand(text: string, active: boolean): InspectionCommand | undefined {
  const normalized = text.replace(/[\s，。！？!?.,]/g, '').replace(/铠甲|盔甲|机甲/g, '战甲');
  if (!active && ENTER_PHRASES.has(normalized)) return 'enter';
  if (active && normalized === '结束检查') return 'exit';
  return undefined;
}
