# Jarvis Holo Map Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate `E:\Projects\jarvis-holo-map` as a Jarvis-managed map module so voice and typed commands search nearby places and plan routes inside Jarvis.

**Architecture:** Keep the map React renderer as an internal module page and create its resizable `BrowserWindow` from Jarvis's existing Electron main process. A dedicated preload exposes only map configuration and typed map requests; a main-process controller owns window lifecycle, validates request/response messages, and backs strict Codex local tools. The map UI and its high-Amap API calls remain inside this Jarvis-managed module; it is not separately installed, launched, or allowed to start another Electron process.

**Tech Stack:** Electron 44, TypeScript 7, Vite 8, React 19, AMap JS API, Node test runner via `tsx`.

## Global Constraints

- Target version is `0.3.30`; update `package.json` and `package-lock.json` consistently.
- The map window is a Jarvis-managed window in the same Electron app process and installer, never a standalone software/process.
- Keep the Jarvis HUD CSP restrictive; map remote origins belong only to the map page CSP.
- Do not copy the source project's Electron main/preload, package manifests, build config, `node_modules`, build output, logs, or installer.
- Do not keep AMap credentials or fallback home coordinates in source; credentials remain in local Jarvis user settings and location failure is explicit.
- Commands must use strict schemas and dedicated IPC methods; do not expose shell, arbitrary URLs, channel names, or renderer methods.
- Route planning and immersive view stay in the map module; do not open a browser or external map app.
- Do not add cloud persistence for credentials, location, or map command history.
- Do not push changes to a remote repository.

## File Map

- `modules/holo-map/renderer/`: integrated React map page, styles, and map-only assets migrated from `E:\Projects\jarvis-holo-map\src\renderer\src` and `src\renderer\public`.
- `modules/holo-map/index.html`: dedicated page metadata and map-only CSP.
- `modules/holo-map/preload.ts`: narrow map-window bridge; no generic IPC exposure.
- `modules/holo-map/controller.ts`: main-process map window lifecycle, origin checks, request IDs, timeout handling, and pending request cleanup.
- `electron/main.ts`: construct and inject `MapController`; add map settings load/save and map-window permission policy.
- `electron/local-tools.ts`: strict schemas and handlers for nearby search and route planning, delegated to `MapController`.
- `electron/protocol.ts`: validate the optional local map credential setting and map action payload constraints if shared action types require them.
- `src/windows-main.ts`: expose the local map key only in the Jarvis settings dialog and persist the settings action.
- `vite.windows.config.ts`: build the map page alongside the existing HUD entry without changing the HUD entry CSP.
- `scripts/build-windows.mjs`: compile and stage the dedicated map preload with existing Electron outputs.
- `electron-builder.yml`: include map page assets and existing map renderer runtime dependencies in the single Jarvis installer.
- `tests/windows-map-controller.test.ts`: controller request correlation, timeout, close, and invalid sender cases.
- `tests/windows-local-tools.test.ts`: map tool schemas, argument bounds, no-external-launch behavior, and result formatting.
- `tests/windows-protocol.test.ts`: map setting and request validation.
- `README.zh-CN.md`: document local AMap setup and voice/text map commands.

## Task 1: Add Strict Map Command Contracts

**Files:** `electron/local-tools.ts`, `tests/windows-local-tools.test.ts`

- [ ] Add a `MapController` interface with `searchNearby({ category })` and `planRoute({ destination, mode })`; results are typed summaries containing POI labels/distances or route endpoints/distance/duration.
- [ ] Add `jarvis_map_search_nearby` and `jarvis_map_plan_route` strict tool specs. Accept only bounded `category`, `destination`, and mode values `drive | ride | walk`; reject extra fields and values over 200 characters.
- [ ] Add tests proving both tools delegate to the injected controller, preserve the returned structured summary, reject unknown fields/modes/empty strings/overlong strings, and never invoke `openUrl` or `openApp`.
- [ ] Run `npx tsx --test tests/windows-local-tools.test.ts` and confirm the new tests fail before implementation, then pass after implementation.

## Task 2: Build the Jarvis-Managed Map Controller

**Files:** `modules/holo-map/controller.ts`, `modules/holo-map/preload.ts`, `modules/holo-map/index.html`, `tests/windows-map-controller.test.ts`

- [ ] Define typed map commands (`searchNearby`, `planRoute`) and result/error envelopes with request IDs in a shared map protocol module.
- [ ] Implement a controller that lazily creates one resizable child `BrowserWindow` using the map page and map-only preload, focuses an existing window, and closes it when Jarvis exits.
- [ ] Validate IPC sender against that window's main frame and allow only the two typed operations; add bounded request timeout, pending-request rejection on window close/crash, and explicit renderer-not-ready errors.
- [ ] Implement preload methods that expose only map configuration retrieval and `onCommand`/`completeCommand`; do not expose `ipcRenderer`, filesystem, shell, generic `send`, or arbitrary channel names.
- [ ] Add unit tests for one-window reuse, request ID correlation, timeout cleanup, close cleanup, and rejection of foreign-window or malformed messages.
- [ ] Run `npx tsx --test tests/windows-map-controller.test.ts` and `npx tsc -p tsconfig.windows.json --noEmit`.

## Task 3: Migrate the Map Renderer Without the Source App Shell

**Files:** `modules/holo-map/renderer/**`, `modules/holo-map/index.html`, `vite.windows.config.ts`

- [ ] Copy only map React components, styles, and assets required by the renderer. Exclude the source app's `src/main`, source preload, package files, Electron Vite and Builder configs, `node_modules`, `out`, `dist`, logs, and installers.
- [ ] Add the map renderer as a second Vite HTML input; keep `windows.html` and its existing HUD CSP intact.
- [ ] Add map-page-only CSP origins required by the AMap loader, AMap API/map tile subdomains, and the existing external weather/radar data actually used by the page. Avoid wildcard `*` sources and do not permit remote scripts except the exact AMap SDK origin required by its loader.
- [ ] Remove both hard-coded AMap key values and the fixed Zhengzhou fallback coordinate. Read the key/security code from the dedicated map preload bridge; if unavailable, render a setup diagnostic without initializing AMap.
- [ ] Remove hand-gesture camera/model logic from the map renderer if it is not a required map capability; retain the map interactions, search, route UI, and other non-camera map features.
- [ ] Replace location fallback behavior with a visible location-denied/unavailable error, and ensure nearby searches cannot run against a stale coordinate.
- [ ] Run the map renderer build and inspect the generated map HTML to verify separate CSP and local bundled scripts.

## Task 4: Connect UI Actions to the Map Command Bridge

**Files:** `modules/holo-map/renderer/**`, `modules/holo-map/preload.ts`, map protocol module

- [ ] Register the map page's command listener after renderer boot and return every result through the matching request ID.
- [ ] Implement `searchNearby` by setting the requested category, using the current GPS location, drawing the existing markers, and returning at most five nearest POIs with bounded name/address/distance fields.
- [ ] Implement `planRoute` by resolving the destination with AMap PlaceSearch/AutoComplete; when there are multiple plausible matches, show up to five clickable candidates and return a `needsSelection` result rather than guessing.
- [ ] For a unique destination, set current location as start, set the destination, call the existing route planner, and enter the existing immersive map view only after a successful route result.
- [ ] Return explicit errors for location unavailable, AMap not ready, no POI/destination, ambiguous destination, and route planning failure.
- [ ] Add focused renderer tests around command routing and result shaping using a fake map adapter; verify mode selection maps only to supported route services.

## Task 5: Add Local Map Settings and Main-Process Integration

**Files:** `electron/main.ts`, `electron/protocol.ts`, `src/windows-main.ts`, map controller wiring, protocol tests

- [ ] Add optional `amapJsApiKey` and `amapSecurityCode` settings with strict maximum lengths; load and save them in the existing local `jarvis-settings.json`.
- [ ] Add a map configuration field group to Jarvis settings, show saved values without logging them, and save through the existing validated settings action. Use password inputs for both values.
- [ ] Instantiate one `MapController` in Jarvis main; pass it to `LocalTools`. Connect map-window creation/close to the existing Electron lifecycle and do not alter the HUD's fullscreen/transparent window behavior.
- [ ] Grant geolocation only to the map window after validating its origin; deny camera/microphone and unrelated permissions for the map page.
- [ ] Add protocol tests for valid credential lengths, invalid types, oversize credentials, and preservation of existing settings when map fields are omitted.
- [ ] Run `npx tsx --test tests/windows-protocol.test.ts tests/windows-local-tools.test.ts tests/windows-map-controller.test.ts`.

## Task 6: Package Renderer, Preload, and Runtime Dependencies

**Files:** `package.json`, `package-lock.json`, `scripts/build-windows.mjs`, `electron-builder.yml`

- [ ] Move only required map runtime dependencies into the Jarvis root dependency set: AMap loader and any React/Three/MediaPipe modules still used by retained map code. Remove MediaPipe/Three dependencies if Task 3 removes all their map usage and Jarvis does not otherwise need them.
- [ ] Increment root package and lockfile version from `0.3.29` to `0.3.30`; regenerate lock metadata with `npm install --package-lock-only --ignore-scripts` after dependency changes.
- [ ] Add a `map-preload.ts` compile output to the current Electron build script with a deterministic `dist-electron/map-preload.cjs` path; validate its local requires.
- [ ] Ensure the single Jarvis installer includes the map HTML/assets, AMap loader bundle, and renderer assets without packaging a second application or source-project Electron files.
- [ ] Add packaging checks that assert the map page and preload exist in staging and that no source map package manifest, nested Electron main, source logs, or embedded credentials are present.
- [ ] Run `npm run windows:build` and the package staging checks.

## Task 7: End-to-End Verification and Local Documentation

**Files:** `README.zh-CN.md`, relevant acceptance scripts/tests

- [ ] Document adding an AMap JS API key and security code in Jarvis settings, including that key restrictions should be configured in the AMap console.
- [ ] Document the supported commands: “贾维斯，帮我看看附近有什么美食”, “附近咖啡馆”, and “导航到郑州东站”; explain that the latter plans and displays the route in Jarvis's map window.
- [ ] Run `npm run windows:test` and `npm run windows:build` on the Windows workspace.
- [ ] Launch the locally built Jarvis package and verify the voice and text commands open/focus the same Jarvis-owned map window; confirm closing the map leaves Jarvis listening.
- [ ] Verify nearby POIs appear at the actual current location, denied geolocation produces an actionable message, ambiguous destinations wait for a user choice, and a valid route enters the immersive map view.
- [ ] Confirm no browser/external map process starts and no map key, coordinates, or search history are added to Codex conversation/archive data.
- [ ] Review `git diff --check`, changed-file list, and package staging; commit only task-specific paths when each task is accepted, and never push to remote.
