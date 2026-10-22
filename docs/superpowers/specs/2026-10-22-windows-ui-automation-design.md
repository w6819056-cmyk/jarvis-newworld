# Windows UI Automation for Jarvis

## Goal

Add a bounded Windows UI Automation pilot to Jarvis so Codex can inspect controls in the foreground application, target a named control, perform one action, and verify the resulting control state. The first repeatable target is Notepad.

## Context

Jarvis is an Electron and TypeScript Windows application. Codex app-server calls local tools registered by `electron/local-tools.ts`; Windows-specific execution currently lives in the Electron main process. There is no existing general-purpose UI Automation or screenshot-driven computer-use dependency. The current desktop tools can enumerate and focus top-level windows, but cannot inspect a window's controls.

## Selected Approach

Use the Windows UI Automation framework through a small local PowerShell/.NET adapter invoked by Electron with `execFile` and fixed scripts. Do not introduce a Python service, a second agent runtime, or UI-TARS/UFO dependencies in this pilot. Codex remains the planner and Jarvis exposes narrow tools for inspection and one-step execution.

The adapter accepts structured, bounded arguments and returns structured JSON. It must not evaluate user-supplied PowerShell, type arbitrary command strings into a shell, or expose general-purpose process execution. The foreground window is captured at the start of each operation and is the only target. If it changes before action execution, the action is rejected and the user is asked to retry.

## User Flow

1. The user asks Jarvis to inspect the current application or name a foreground application.
2. Jarvis lists visible controls with a short-lived control identifier, role, accessible name, enabled state, and supported patterns. Password values and control contents are never returned.
3. Codex selects a control from that result and requests exactly one supported action: invoke, set a value, select, or scroll.
4. Jarvis checks that the target still belongs to the same foreground window, that the control is enabled, and that the requested UI Automation pattern is supported.
5. Jarvis performs one action, re-reads the relevant control state, and returns the observed result. It never claims success based only on issuing the action.
6. The pilot is validated using harmless Notepad actions that do not save or overwrite files.

## Scope

Included:

- Read-only UI Automation tree inspection for the current foreground window.
- Bounded results: at most 200 controls, accessible names truncated to 200 characters, and a maximum tree depth of 12.
- Control metadata: ephemeral ID, role/control type, accessible name, enabled/focused state, and supported action patterns.
- Single-step invoke, set-value, select, and scroll actions on controls returned by a recent inspection.
- Post-action verification and concise Chinese status in the existing Codex tool result.
- A Notepad pilot for focusing its edit control, entering non-file content, inspecting text length/state without returning sensitive content, and scrolling.

Excluded:

- Screenshot capture, image upload, OCR, vision models, or UI-TARS/UFO integration.
- Background-window interaction, global mouse/keyboard injection, coordinate clicks, or unbounded action loops.
- Password fields, credential entry, file dialogs, save/overwrite, send/publish/pay, deleting data, or changing system settings.
- Automatic task execution from arbitrary page text or instructions displayed by an application.
- Persistent storage of control trees or entered text.

## Safety and Lifetime

- Control IDs are opaque, random, scoped to the current Jarvis process, and expire after 30 seconds or when the foreground window changes.
- Every action must reference an ID from a currently valid inspection; raw selectors, executable paths, scripts, and arbitrary key sequences are rejected.
- Text entry is limited to 2,000 characters and to a non-password control exposing the Value pattern as writable.
- Invoke/select/scroll are limited to explicitly supported controls and bounded scroll amounts.
- Any operation whose result can modify a user file or produce an external effect remains outside the pilot and requires the existing explicit confirmation flow.
- UI Automation failures, elevated-window access restrictions, unsupported control patterns, and foreground changes are surfaced as errors; the adapter does not fall back to coordinate input.

## Architecture

- `electron/ui-automation.ts`: validate inspection/action requests, manage ephemeral control handles and foreground-window lifetime, and format bounded results.
- `electron/windows-ui-automation.ps1`: fixed PowerShell/.NET UI Automation implementation. It receives JSON data over stdin and emits JSON only on stdout; diagnostics go to stderr.
- `electron/local-tools.ts`: register `jarvis_inspect_foreground_ui` and one-step action tools with strict JSON schemas.
- `electron/main.ts`: provide the adapter to `LocalTools` using `execFile` with fixed executable and script paths.
- `tests/windows-ui-automation.test.ts`: exercise request validation, ID expiration, stale-window rejection, control limits, password rejection, action verification, and tool schemas with an injected probe.
- `docs/WINDOWS.md`: document the pilot commands and limitations after implementation.

The renderer receives only Codex's bounded text result through the existing event flow. It receives no UI Automation COM objects, process handles, PowerShell text, or raw window contents.

## Errors and Recovery

- Missing PowerShell or UI Automation assemblies: report that Windows UI Automation is unavailable.
- Foreground window changes or stale control ID: return a recoverable stale-target result and require a fresh inspection.
- Unsupported pattern, disabled control, password field, or protected action: reject before invoking the control.
- Timeout or provider failure: terminate the owned PowerShell process and return a bounded error; never report success.
- Verification mismatch: report the action as unverified and expose the new inspection state if it remains within bounds.

## Verification

- Unit tests confirm schemas reject extra fields and all limits, expiry rules, password checks, foreground checks, and protection rules.
- Windows integration tests launch a fresh Notepad instance, inspect its controls, set harmless text in the edit control, verify the new state without returning the text, scroll, and close only the test-owned Notepad instance.
- A manual acceptance pass confirms speech and typed commands use the same Codex tools and errors are surfaced rather than hidden.
- TypeScript checks, the full Windows test suite, and a packaged-build check pass.

## Risks

- Some applications expose incomplete or custom UI Automation trees. Such applications will not be operable in this pilot; no visual fallback is implied.
- Elevated applications may be inaccessible from a non-elevated Jarvis process. Jarvis must not request elevation automatically.
- Notepad implementation details vary by Windows version. Integration assertions should target semantic control roles and supported patterns rather than fixed localized names.
