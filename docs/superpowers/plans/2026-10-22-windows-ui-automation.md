# Windows UI Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded Windows UI Automation pilot that lets Codex inspect and perform one verified action in the current foreground application, with Notepad as the first supported validation target.

**Architecture:** Electron main process owns a short-lived UI Automation session. A fixed PowerShell/.NET adapter receives JSON over stdin and emits JSON over stdout. `LocalTools` exposes read-only inspection plus one-step invoke, set-value, select, and scroll tools; every action is bound to an ephemeral control handle and verified by a fresh read.

**Tech Stack:** TypeScript, Electron main process, Node `child_process.spawn`, PowerShell 5+/7, .NET `System.Windows.Automation`, Node test runner with `tsx`.

## Global Constraints

- Only the current foreground window is eligible for inspection and action.
- Control handles expire after 30 seconds or when the foreground window changes.
- Inspection returns at most 200 controls, depth 12, and names truncated to 200 characters.
- Text entry is limited to 2,000 characters and rejects password controls.
- No screenshots, OCR, coordinate input, arbitrary shell commands, background windows, file dialogs, save/overwrite, deletion, payment, or external publishing.
- Every action is one operation followed by state verification; unverified actions are errors.

---

### Task 1: Add the session and adapter contract tests

**Files:**
- Create: `tests/windows-ui-automation.test.ts`
- Modify: `electron/ui-automation.ts`

**Interfaces:**
- `UiAutomationSession.inspect(): Promise<UiInspection>`
- `UiAutomationSession.act(request: UiActionRequest): Promise<UiActionResult>`
- `UiAutomationProbe.inspect(request): Promise<UiProbeInspection>` and `UiAutomationProbe.act(request): Promise<UiProbeActionResult>`

- [ ] **Step 1: Write failing tests** for bounded inspection, opaque ID expiry, password rejection, stale foreground rejection, one-action enforcement, and verification mismatch.
- [ ] **Step 2: Run `npx tsx --test tests/windows-ui-automation.test.ts` and confirm the missing module/API failures.
- [ ] **Step 3: Implement pure validation/session logic with an injected probe; keep IDs in memory and never return values for password or text controls.
- [ ] **Step 4: Run the focused test and confirm all contract tests pass.

### Task 2: Implement the fixed PowerShell UI Automation adapter

**Files:**
- Create: `electron/windows-ui-automation.ps1`
- Modify: `electron/ui-automation.ts`

**Interfaces:**
- Adapter stdin: `{ operation: "inspect" | "act", hwnd?: number, controlId?: string, action?: {...} }`
- Adapter stdout: one JSON object with `ok`, `foreground`, `controls` or `verification`, and bounded `error`.

- [ ] **Step 1: Add adapter invocation tests using an injected process runner and assert JSON-only stdout, fixed script path, timeout termination, and stderr handling.
- [ ] **Step 2: Implement the PowerShell script with `Add-Type -AssemblyName UIAutomationClient`, foreground HWND capture, bounded recursive traversal, supported-pattern metadata, and no arbitrary expression evaluation.
- [ ] **Step 3: Implement invoke, writable ValuePattern set, SelectionItem select, and ScrollPattern scroll; reject password controls and unsupported patterns before acting.
- [ ] **Step 4: Re-read the target control and emit verification state; return an error when the foreground HWND changes.
- [ ] **Step 5: Run focused adapter tests on Windows and verify malformed requests are rejected.

### Task 3: Register narrow Codex local tools

**Files:**
- Modify: `electron/local-tools.ts`
- Modify: `electron/main.ts`
- Test: `tests/windows-local-tools.test.ts`

**Interfaces:**
- Tool: `jarvis_inspect_foreground_ui({})`
- Tool: `jarvis_ui_invoke({controlId})`
- Tool: `jarvis_ui_set_value({controlId, text})`
- Tool: `jarvis_ui_select({controlId})`
- Tool: `jarvis_ui_scroll({controlId, direction, amount})`

- [ ] **Step 1: Add failing schema and dispatch tests for exact keys, limits, stale handles, and concise Chinese results.
- [ ] **Step 2: Add strict tool specs with `additionalProperties: false`, enums, and maximum lengths.
- [ ] **Step 3: Inject the session into `LocalTools`, dispatch each action, and return only bounded metadata and verification status.
- [ ] **Step 4: Wire a fixed PowerShell path from `main.ts` using `spawn` with stdin JSON, no shell, and a 5-second timeout.
- [ ] **Step 5: Run all local-tool tests and the TypeScript check.

### Task 4: Document and validate the Notepad pilot

**Files:**
- Modify: `docs/WINDOWS.md`
- Create: `scripts/check-ui-automation-notepad.mjs`
- Test: `tests/windows-ui-automation-notepad.test.ts`

- [ ] **Step 1: Add an opt-in Windows integration test that launches a test-owned Notepad, inspects the edit control, sets harmless unsaved text, verifies only length/state, scrolls, and closes that process.
- [ ] **Step 2: Add the manual diagnostic script with explicit `--run` opt-in and no file save behavior.
- [ ] **Step 3: Document supported operations, limitations, stale-target recovery, and the Notepad command examples.
- [ ] **Step 4: Run `npm run windows:test`, `npx tsc -p tsconfig.windows.json --noEmit`, and the opt-in Notepad check on Windows.

### Task 5: Package and review

- [ ] **Step 1:** Run `npm run windows:build` and confirm the adapter is included in `dist-electron` or packaged resources.
- [ ] **Step 2:** Run the existing desktop checks and inspect the diff for unrelated changes.
- [ ] **Step 3:** Report exact test results and the pilot limitations.
