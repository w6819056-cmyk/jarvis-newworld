# Jarvis–Mineradio Visual Preset Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Jarvis switch Mineradio among its built-in music visual presets by name or by a random-other-preset voice command.

**Architecture:** Jarvis recognizes explicit visual preset commands after the wake gate and sends a typed allowlisted action over the existing authenticated named pipe. Mineradio validates the requested preset against its built-in preset list and calls the existing `setPreset` function, returning the confirmed display name.

**Tech Stack:** Electron, TypeScript, Node.js named pipes, Mineradio renderer JavaScript, `node:test`, `tsx`.

## Global Constraints

- Keep the authenticated current-user named-pipe bridge and its action allowlist.
- Do not expose arbitrary JavaScript, DOM selectors, or generic renderer commands.
- Keep work local; do not push either project to a remote repository.
- Voice commands run only after Jarvis's wake gate has extracted the command, and do not enter Codex conversation history.

---

## File Structure

- Jarvis `electron/mineradio-protocol.ts`: define `visual.set_preset` and validate fixed preset IDs or the dedicated random request.
- Jarvis `electron/mineradio-voice-command.ts`: map explicit Chinese switch utterances to named preset IDs or random selection.
- Jarvis `electron/main.ts`: dispatch matched final post-wake commands and report Mineradio's confirmed preset.
- Mineradio `desktop/mineradio-jarvis-bridge.js`: add the new action to the existing pipe allowlist.
- Mineradio `public/js/modules/10-shell/00-jarvis-actions.js`: validate and dispatch preset changes through a dependency supplied by the renderer bridge.
- Mineradio `public/js/modules/10-shell/06-jarvis-bridge.js`: connect the action to existing `setPreset` and return the selected name.
- Tests in each project cover input validation, named mapping, random choice, and the real dispatch boundary.
- Both projects' package manifests and lockfiles increment their patch versions before their respective distributable builds.

### Task 1: Add validated preset actions to the Mineradio bridge

**Files:**
- Modify: Mineradio `desktop/mineradio-jarvis-bridge.js`
- Modify: Mineradio `public/js/modules/10-shell/00-jarvis-actions.js`
- Modify: Mineradio `public/js/modules/10-shell/06-jarvis-bridge.js`
- Test: Mineradio `tests/mineradio-jarvis-bridge.test.js`
- Test: Mineradio `tests/mineradio-jarvis-actions.test.js`

**Interfaces:**
- Add bridge action `visual.set_preset` with payload `{ presetId: integer }` or `{ random: true }`; reject other fields and IDs outside `0..12`.
- Renderer adapter supplies `setPreset(id)` and `getPreset()` dependencies; the action factory accepts an optional `random()` dependency defaulting to `Math.random` for deterministic random-choice tests.
- Dispatch returns `{ ok: true, result: { presetId, presetName } }` only after the existing setter accepts the preset.
- Random selection chooses uniformly from `0..12` excluding `getPreset()`.

- [ ] Add a test that a valid `visual.set_preset` request reaches dispatch and an unknown bridge action is rejected.
- [ ] Run `node --test tests/mineradio-jarvis-bridge.test.js` and confirm the new valid-action assertion fails against the old allowlist.
- [ ] Add action tests using the real `createJarvisActions` dispatcher and a deterministic `random()` dependency. Assert preset 10 applies and returns “雨幕霓虹”; assert preset 13 leaves setter calls empty; assert a random value of `0` selects the first ID other than active preset 10.
- [ ] Run `node --test tests/mineradio-jarvis-actions.test.js` and confirm the new action cases fail before implementation.
- [ ] Add `visual.set_preset` to the fixed bridge allowlist; validate exactly one of `presetId` or `random: true` at dispatch; resolve names from the existing `presetMeta`; invoke `setPreset(id)`; return the resulting ID/name.
- [ ] Run `node --test tests/mineradio-jarvis-bridge.test.js tests/mineradio-jarvis-actions.test.js` and confirm all focused tests pass.

### Task 2: Route Jarvis spoken preset changes locally

**Files:**
- Modify: Jarvis `electron/mineradio-protocol.ts`
- Modify: Jarvis `electron/mineradio-bridge.ts`
- Modify: Jarvis `electron/mineradio-voice-command.ts`
- Modify: Jarvis `electron/main.ts`
- Test: Jarvis `tests/windows-mineradio-protocol.test.ts`
- Test: Jarvis `tests/windows-mineradio-voice-command.test.ts`
- Test: Jarvis `tests/windows-voice.test.ts`

**Interfaces:**
- Add `visual.set_preset` to `MineradioAction`.
- Export `matchMineradioVisualCommand(text): { presetId: number } | { random: true } | undefined`.
- Named commands require a switch verb and one recognized built-in name/alias; random commands require “换一个音乐效果” or a direct equivalent.
- In `transcript`, run matching on `VoiceGate.accept(...).text` only when final, then dispatch `{ presetId }` or `{ random: true }` through `MineradioBridge.request`.

- [ ] Add tests for all 13 preset names, aliases for English subtitling where useful, a command lacking a switch verb, incidental mention of a preset, random intent, and non-final text.
- [ ] Run `npx tsx --test tests/windows-mineradio-voice-command.test.ts` and confirm new mapping tests fail because the matcher is absent.
- [ ] Add protocol tests accepting preset IDs 0 and 12 and rejecting -1, 13, a missing selector, and additional fields.
- [ ] Run `npx tsx --test tests/windows-mineradio-protocol.test.ts` and confirm the new validation cases fail against the old protocol.
- [ ] Implement the matcher and action validation. In `electron/main.ts`, dispatch only after the wake gate yields command text; open Mineradio if needed, await the confirmed response, and publish a concise success/error detail without calling `submit` or `speak`.
- [ ] Run `npx tsx --test tests/windows-mineradio-voice-command.test.ts tests/windows-mineradio-protocol.test.ts tests/windows-voice.test.ts` and confirm all focused tests pass.

### Task 3: Bump versions, run full checks, and build releases

**Files:**
- Modify: Jarvis `package.json`, `package-lock.json`
- Modify: Mineradio `package.json`, `package-lock.json`
- Verify: Jarvis Windows package and Mineradio packaged application

- [ ] Increment Jarvis from `0.3.18` to `0.3.19` and Mineradio from `2.2.1` to `2.2.2` in package manifests and lockfiles.
- [ ] Run `npm run windows:test` and `npx tsc -p tsconfig.windows.json --noEmit` from Jarvis.
- [ ] Run focused Mineradio visual/bridge tests, then `npm test` from Mineradio.
- [ ] Build Jarvis with `npm run windows:dist`; build Mineradio with its documented Windows packaging script only if required dependencies are present and the build can complete locally.
- [ ] Verify the Jarvis installer path/version and inspect the packaged Mineradio application for the bridge action implementation; report build limitations exactly if Mineradio packaging cannot run locally.
