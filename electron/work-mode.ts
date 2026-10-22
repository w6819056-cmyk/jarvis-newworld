export type WorkModeCommand = 'enter' | 'exit' | undefined;

function normalize(text: string): string {
  return text.replace(/[\s，。！？、,.!?：:；;“”‘’"']/g, '').toLowerCase();
}

export function matchWorkModeCommand(text: string, active: boolean): WorkModeCommand {
  const value = normalize(text);
  if (!active && /^(开始工作了贾维斯|贾维斯开始工作了|开始工作贾维斯|jarvis开始工作|hi?jarvis开始工作)$/.test(value)) return 'enter';
  if (active && /^(结束工作|停止工作|退出工作模式|结束工作模式|贾维斯结束工作)$/.test(value)) return 'exit';
  return undefined;
}
