import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

// The fixed program and the spoken text use separate channels. Text is never code.
const program = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voice = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
  if (!$voice) { $voice = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'zh-*' } | Select-Object -First 1 }
  if (!$voice) { exit 2 }
  $synth.SelectVoice($voice.VoiceInfo.Name)
  $synth.Speak([string]$request.text)
} finally { $synth.Dispose() }
`;
export class WindowsSpeech {
  private child?: ChildProcessWithoutNullStreams;
  private cancel?: () => void;
  constructor(private options: { spawnProcess?: (...args: any[]) => any } = {}) {}
  speak(text: string): Promise<void> {
    this.stop();
    if (!text.trim()) return Promise.resolve();
    const child = (this.options.spawnProcess ?? spawn)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(program, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'pipe' }) as ChildProcessWithoutNullStreams;
    this.child = child;
    return new Promise((resolve, reject) => {
      let cancelled = false;
      const timer = setTimeout(() => { cancelled = true; child.kill(); finish(new Error('语音播放超时')); }, 120000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        if (this.child === child) { this.child = undefined; this.cancel = undefined; }
        error ? reject(error) : resolve();
      };
      this.cancel = () => { cancelled = true; child.kill(); finish(); };
      child.stderr.on('data', () => {});
      child.stdout.on('data', () => {});
      child.stdin.on('error', () => {});
      child.on('error', error => finish(error));
      child.on('exit', code => finish(!cancelled && code !== 0 ? new Error('Windows 中文语音不可用，请在语言设置中安装中文语音后重试') : undefined));
      child.stdin.end(JSON.stringify({ text: text.slice(0, 1600) }), 'utf8');
    });
  }
  stop() { this.cancel?.(); }
}
