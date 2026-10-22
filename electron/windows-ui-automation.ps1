$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class JarvisUiNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

function Get-ForegroundInfo {
  $handle = [JarvisUiNative]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero) { throw '没有可用的前台窗口' }
  $buffer = New-Object System.Text.StringBuilder 512
  [void][JarvisUiNative]::GetWindowText($handle, $buffer, $buffer.Capacity)
  [uint32]$processId = 0
  [void][JarvisUiNative]::GetWindowThreadProcessId($handle, [ref]$processId)
  $processName = ''
  try { $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch {}
  return [pscustomobject]@{ handle = $handle.ToInt64().ToString(); title = $buffer.ToString().Substring(0, [Math]::Min(200, $buffer.Length)); processName = $processName; processId = [int]$processId }
}

function Get-Patterns($element) {
  $patterns = [System.Collections.Generic.List[string]]::new()
  $pattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $patterns.Add('invoke') }
  $pattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern) -and -not $pattern.Current.IsReadOnly -and -not $element.Current.IsPassword) { $patterns.Add('setValue') }
  $pattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { $patterns.Add('select') }
  $pattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$pattern)) { $patterns.Add('scroll') }
  return ,$patterns.ToArray()
}

function Find-Element($root, [int[]]$wantedRuntimeId) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $stack = [System.Collections.Generic.Stack[object]]::new()
  $stack.Push(@($root, 0))
  $visited = 0
  while ($stack.Count -gt 0 -and $visited -lt 3000) {
    $entry = $stack.Pop(); $element = $entry[0]; $depth = [int]$entry[1]; $visited++
    try {
      $rid = $element.GetRuntimeId()
      if ($rid.Length -eq $wantedRuntimeId.Length -and [System.Linq.Enumerable]::SequenceEqual([int[]]$rid, $wantedRuntimeId)) { return $element }
    } catch {}
    if ($depth -ge 12) { continue }
    try {
      $children = [System.Collections.Generic.List[object]]::new()
      $child = $walker.GetFirstChild($element)
      while ($null -ne $child -and $children.Count -lt 200) { $children.Add($child); $child = $walker.GetNextSibling($child) }
      for ($i = $children.Count - 1; $i -ge 0; $i--) { $stack.Push(@($children[$i], $depth + 1)) }
    } catch {}
  }
  return $null
}

try {
  $requestText = [Console]::In.ReadToEnd()
  if ($requestText.Length -gt 65536) { throw '请求超过大小限制' }
  $request = $requestText | ConvertFrom-Json
  $foreground = Get-ForegroundInfo
  if ($request.operation -eq 'inspect') {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([int64]$foreground.handle))
    if ($null -eq $root) { throw '无法读取当前前台窗口的 UI Automation 树' }
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $stack = [System.Collections.Generic.Stack[object]]::new()
    $stack.Push(@($root, 0))
    $controls = [System.Collections.Generic.List[object]]::new()
    $visited = 0
    while ($stack.Count -gt 0 -and $controls.Count -lt 200 -and $visited -lt 2000) {
      $entry = $stack.Pop(); $element = $entry[0]; $depth = [int]$entry[1]
      $visited++
      try {
        $current = $element.Current
        if (-not $current.IsOffscreen) {
          $rid = $element.GetRuntimeId()
          $name = [string]$current.Name
          if ($name.Length -gt 200) { $name = $name.Substring(0, 200) }
          $controls.Add([pscustomobject]@{
            runtimeId = @($rid)
            role = [string]$current.ControlType.ProgrammaticName.Replace('ControlType.', '')
            name = $name
            enabled = [bool]$current.IsEnabled
            focused = [bool]$current.HasKeyboardFocus
            password = [bool]$current.IsPassword
            patterns = @(Get-Patterns $element)
          })
        }
      } catch {}
      if ($depth -ge 12) { continue }
      try {
        $children = [System.Collections.Generic.List[object]]::new()
        $child = $walker.GetFirstChild($element)
        while ($null -ne $child -and $children.Count -lt 200) { $children.Add($child); $child = $walker.GetNextSibling($child) }
        for ($i = $children.Count - 1; $i -ge 0; $i--) { $stack.Push(@($children[$i], $depth + 1)) }
      } catch {}
    }
    [pscustomobject]@{ ok = $true; foreground = $foreground; controls = @($controls.ToArray()) } | ConvertTo-Json -Compress -Depth 8
  } elseif ($request.operation -eq 'act') {
    if ([string]$request.foregroundHandle -ne [string]$foreground.handle) { throw '前台窗口已变化' }
    if ($null -eq $request.runtimeId -or $request.runtimeId.Count -gt 64) { throw '控件标识无效' }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([int64]$foreground.handle))
    $element = Find-Element $root ([int[]]$request.runtimeId)
    if ($null -eq $element) { throw '控件已不存在，请重新检查窗口' }
    if (-not $element.Current.IsEnabled -or $element.Current.IsPassword) { throw '控件不可用或属于密码框' }
    $action = $request.action
    $state = ''
    switch ($action.type) {
      'invoke' {
        $pattern = $null
        if (-not $element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { throw '控件不支持 invoke' }
        $pattern.Invoke(); $state = 'invoked'
      }
      'setValue' {
        if ($action.text -isnot [string] -or $action.text.Length -gt 2000) { throw '文本必须为 2000 字符以内' }
        $pattern = $null
        $patternKind = ''
        if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern) -and -not $pattern.Current.IsReadOnly) { $patternKind = 'value' }
        if (-not $patternKind) { throw '控件不支持写入文本' }
        $pattern.SetValue([string]$action.text)
        $fresh = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([int64]$foreground.handle))
        $verifiedElement = Find-Element $fresh ([int[]]$request.runtimeId)
        $verifyPattern = $null
        if ($null -eq $verifiedElement -or -not $verifiedElement.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$verifyPattern)) { throw '输入结果无法核验' }
        if ([string]$verifyPattern.Current.Value -cne [string]$action.text) { throw '输入结果与请求不一致' }
        $state = 'valueLength:' + $verifyPattern.Current.Value.Length
      }
      'select' {
        $pattern = $null
        if (-not $element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { throw '控件不支持 select' }
        $pattern.Select()
        if (-not $pattern.Current.IsSelected) { throw '选择状态无法核验' }
        $state = 'selected'
      }
      'scroll' {
        if ($action.direction -notin @('up', 'down') -or [int]$action.amount -lt 1 -or [int]$action.amount -gt 20) { throw '滚动参数无效' }
        $pattern = $null
        if (-not $element.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$pattern)) { throw '控件不支持 scroll' }
        $before = $pattern.Current.VerticalScrollPercent
        $scrollAmount = if ($action.direction -eq 'down') { [System.Windows.Automation.ScrollAmount]::LargeIncrement } else { [System.Windows.Automation.ScrollAmount]::LargeDecrement }
        for ($i = 0; $i -lt [int]$action.amount; $i++) { $pattern.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount, $scrollAmount) }
        $freshElement = Find-Element ([System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([int64]$foreground.handle))) ([int[]]$request.runtimeId)
        $freshPattern = $null
        if ($null -eq $freshElement -or -not $freshElement.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$freshPattern)) { throw '滚动结果无法核验' }
        $after = $freshPattern.Current.VerticalScrollPercent
        if ($before -eq $after) { throw '滚动后位置未变化，可能已到边界' }
        $state = 'scrollPercent:' + [Math]::Round($after, 1)
      }
      default { throw '动作类型不受支持' }
    }
    $afterForeground = Get-ForegroundInfo
    [pscustomobject]@{ ok = $true; foreground = $afterForeground; verified = ([string]$afterForeground.handle -eq [string]$foreground.handle); state = $state } | ConvertTo-Json -Compress -Depth 5
  } else { throw '操作类型不受支持' }
} catch {
  [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress -Depth 4
  exit 1
}
