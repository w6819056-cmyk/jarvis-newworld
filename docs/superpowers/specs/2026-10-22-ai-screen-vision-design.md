# AI Screen Vision for Jarvis

## Goal

Extend Jarvis's Windows UI Automation pilot with on-demand screenshot understanding through the Codex cloud model. Combine visual pixels with UI Automation metadata so Codex can understand custom-drawn interfaces while Jarvis retains all operating-system execution authority.

## Context

Jarvis is an Electron/TypeScript Windows application with a local Codex app-server runtime and a bounded foreground-only UI Automation service. The current `turn/start` implementation sends text-only input. The UI Automation pilot can enumerate accessible controls, but custom interfaces such as game launchers may expose incomplete trees. No local vision model will be used.

## User Flow

1. The user asks Jarvis to inspect or operate the current application. Screenshot capture is on demand; there is no background recording or periodic capture.
2. Jarvis records the foreground window identity and captures only that active window. It also reads the bounded UI Automation tree and its positions.
3. A Screen Context Builder combines the image, window identity, UIA metadata, DPI/scale and capture timestamp into one short-lived context.
4. Jarvis applies configured sensitive-window exclusions and masks password controls and other confidently identified sensitive rectangles before sending the screenshot and context to Codex. If protection cannot be applied reliably, image transmission is refused and Jarvis explains why.
5. Codex returns a visual explanation or a candidate target expressed as a matching UIA control ID when possible, otherwise as a window-relative target rectangle and rationale. It does not receive an execution API.
6. Jarvis validates that the same foreground window remains active. UIA patterns are preferred for actions; a bounded coordinate action may be used only for a visually identified target that lacks an operable UIA element. Jarvis performs one action and captures/reads state again to verify the result.
7. Actions with external effects or irreversible results, including login submission, sending, deleting, purchasing, or publishing, require explicit user confirmation. Password values are never read from screenshots or controls.

## Architecture

- `ScreenService` owns foreground-window metadata, on-demand capture, display scale and bounded accessibility-tree retrieval.
- `ScreenContextBuilder` binds screenshot and UIA data to the same foreground HWND and timestamp, applies redaction/exclusion policy, and produces a non-persistent context.
- `CodexRuntime` gains an image-capable turn input after its exact app-server protocol shape is verified. The image is sent only as part of an explicitly requested screen-inspection turn; it is not written to disk or added to conversation archives.
- `LocalTools` exposes narrow inspect and one-action operations. Vision analysis returns suggestions; a separate Jarvis action path validates target lifetime and performs operations.
- Windows capture uses the active-window capture path available to the packaged Electron version. If that path cannot capture the target reliably, Jarvis fails closed instead of silently capturing another monitor.

## Coordinate and Action Rules

- UIA control IDs are preferred over coordinates and retain the current 30-second lifetime.
- Visual rectangles are expressed in physical pixels relative to the captured window, include the capture's scale metadata, and are invalidated when the window moves, resizes, changes DPI, or loses foreground status.
- Before a coordinate action, Jarvis rechecks HWND, bounds, scale, and current foreground status, translates to screen coordinates, and executes exactly one click/scroll action.
- No drag paths, arbitrary key sequences, background interaction, or repeated autonomous loops are included in this phase.
- The screenshot model cannot call native functions or directly execute actions.

## Privacy and Data Handling

- Only the active window is captured, only after an explicit screen-inspection request.
- Screenshots are sent to Codex cloud for visual analysis; the user selects this mode and understands that visible content leaves the device.
- Screenshots, accessibility trees, and derived contexts are not persisted by Jarvis, added to local conversation memory, or retained in temporary files.
- Password controls are masked before upload. Configured excluded applications/windows are not captured or uploaded.
- Jarvis declines upload if it cannot confidently apply required masking or if capture identifies a protected/excluded window.
- Raw UIA text is bounded and can contain personal information; only the active window's relevant, limited metadata is included.

## Error Handling

- Unsupported Codex image input protocol: report that cloud visual analysis is unavailable and keep the existing UIA-only behavior.
- Capture failure, foreground switch, window resize, display/DPI change, stale target, or post-action mismatch: cancel the action and require a fresh inspection.
- Missing UIA data: vision may explain the screen and propose a target, but a target that cannot be safely mapped and revalidated cannot be acted upon.
- Redaction failure or excluded-window match: do not upload the screenshot.
- A failed verification is reported as unverified; no success is inferred from action dispatch.

## Scope Exclusions

- Local OCR or local vision models.
- Continuous screen recording, unattended background observation, persistent screenshots, or visual memory.
- Unbounded screenshot collection, remote desktop control, and arbitrary desktop-wide coordinate automation.
- Reading/extracting password contents or automatic credential vault integration.
- Automatic submission of login forms, purchases, messages, destructive actions, or publishing.
- UI-TARS/UFO agent runtime or independent model server.

## Verification

- Unit tests cover capture scoping, context/window identity matching, image and UIA bounds, coordinate scaling, stale-window rejection, sensitive-window exclusion, redaction refusal, and no persistence.
- Protocol tests verify the exact Codex app-server multimodal input format and confirm image input is attached only to the requested turn.
- Windows integration checks compare screenshot bounds with the active window and validate DPI/scale conversion on a controlled test window.
- A WeGame visual inspection may be used as a manual acceptance case after the general flow is validated; it must not submit the login form.
- Full Windows tests, TypeScript checks, packaged build, and manual speech/typed-command checks pass.

## Risks

- Current app-server code sends text-only turns; image support and its payload shape must be proven against the installed Codex CLI before implementation is considered viable.
- Electron's packaged capture path may not expose all protected or elevated windows.
- Password masking can fail when a custom app does not expose password rectangles through UIA. Such a window must not be uploaded until a reliable app-specific exclusion/mask is configured.
- Visual coordinate actions are less robust than UIA actions and must remain bounded to a fresh foreground capture.
