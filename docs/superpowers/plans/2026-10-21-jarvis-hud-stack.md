# JARVIS HUD 多窗口结果面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每条完成的语音或文本请求创建独立、无限数量、可单独关闭的头盔旁 HUD，并让天气结果直接显示在 HUD。

**Architecture:** Renderer 维护有序 HUD 卡片状态；每轮请求开始时分配稳定 ID，回复增量更新该 ID 对应卡片，轮次结束后保留。Electron 本地工具提供受限的天气查询，指定城市直接查天气，未指定城市时通过公网 IP 定位当前城市，再查询天气；任何天气路径都不打开浏览器。

**Tech Stack:** Electron、TypeScript、原生 DOM/CSS、Node.js `fetch`、node:test/tsx、TypeScript 编译、electron-builder。

## Global Constraints

- 项目只在本地工作区保留，不推送到云端。
- 更新版本号到 `0.3.24`。
- 不自动关闭、替换或限制 HUD 数量；每张 HUD 独立关闭。
- HUD 只显示助手结果，不显示原始用户指令；现有识别文本显示框维持原样。
- 天气查询不打开浏览器；用户未指定城市时按公网 IP 定位当前城市。
- 不改头盔模型、粒子、手势或窗口启动动画。

---

### Task 1: Weather lookup core

**Files:**
- Create: `electron/weather.ts`
- Create: `tests/windows-weather.test.ts`
- Modify: `package.json`

**Interfaces:**
- `lookupWeather(options: { city?: string; fetcher?: typeof fetch }): Promise<string>` returns concise Chinese current-weather text.
- City specified: geocode via `https://geocoding-api.open-meteo.com/v1/search`, then query current conditions via `https://api.open-meteo.com/v1/forecast`.
- City omitted: fetch `https://ipwho.is/`, require `success: true` and a city, then use same geocode/weather flow.
- Use abort timeout of 8 seconds for each HTTP request; reject bad status, malformed payload, missing city/coordinates, and unknown city with clear Chinese errors.
- Add `"version": "0.3.24"` to package metadata only in the version task after implementation is verified.

- [ ] **Step 1: Write failing tests** for specified city avoiding IP lookup, omitted city using IP lookup, bounded/encoded city queries, and network/unknown-city errors. Inject a sequential fake `fetcher` that returns realistic JSON payloads.
- [ ] **Step 2: Run `npx tsx --test tests/windows-weather.test.ts`** and confirm the tests fail because `electron/weather.ts` does not exist.
- [ ] **Step 3: Implement `lookupWeather`** with URL/JSON validation, 8-second timeout, safe city encoding, and a small WMO-code-to-Chinese-description table.
- [ ] **Step 4: Re-run the focused test** and confirm all weather tests pass.

### Task 2: Register weather as a local Codex tool

**Files:**
- Modify: `electron/local-tools.ts`
- Modify: `tests/windows-local-tools.test.ts`

**Interfaces:**
- Extend `LocalTools` adapter with optional `lookupWeather(city?: string): Promise<string>`.
- Add `jarvis_get_weather` schema with optional string `city`, maximum length 80, no extra properties.
- Successful result is returned as one `inputText`; errors use existing `{ success: false, ... }` convention.

- [ ] **Step 1: Add tests** proving the schema is bounded, explicit city is passed to the lookup, absent city invokes the default-current-city path, and malformed arguments are rejected.
- [ ] **Step 2: Run `npx tsx --test tests/windows-local-tools.test.ts`** and confirm the new expectations fail.
- [ ] **Step 3: Register the tool** and inject `lookupWeather` adapter implementation from `electron/main.ts` using the core from Task 1.
- [ ] **Step 4: Re-run local tool tests** and confirm all pass; verify no browser adapter method was called by the weather cases.

### Task 3: Model independent HUD lifecycle

**Files:**
- Create: `src/hud-results.ts`
- Create: `tests/windows-hud-results.test.ts`
- Modify: `src/windows-main.ts`

**Interfaces:**
- `HudResults` owns ordered `{ id: number; text: string; pending: boolean }` records.
- `begin(): number` appends a new pending card and returns its stable ID.
- `update(id: number, text: string, pending: boolean): void` updates only that card.
- `close(id: number): void` removes only the selected card.
- `items(): readonly HudResult[]` returns a stable ordered snapshot.

- [ ] **Step 1: Add unit tests** for no initial cards, append order, isolated update, isolated close, and no imposed maximum count.
- [ ] **Step 2: Run `npx tsx --test tests/windows-hud-results.test.ts`** and confirm failure because the module is missing.
- [ ] **Step 3: Implement the small state class** with monotonically increasing IDs and immutable snapshots.
- [ ] **Step 4: Re-run the unit tests** and confirm all lifecycle cases pass.
- [ ] **Step 5: Add renderer markup** for an initially hidden HUD stack next to the helmet. Render cards from `HudResults`; use `textContent`, per-card close buttons, and event delegation.

### Task 4: Connect request lifecycle and streaming reply updates

**Files:**
- Modify: `src/windows-main.ts`
- Modify: `tests/windows-live-transcript.test.ts`
- Create: `tests/windows-hud-rendering.test.ts`

**Interfaces:**
- Each submitted voice/typed command creates a HUD card and stores its ID as the active response target.
- The current streaming `AssistantState.reply` updates the active card. A new request begins a separate card; closed cards are never recreated by late updates.
- Local completion/error states publish to the active card; startup speech/status messages do not create HUDs.

- [ ] **Step 1: Write renderer contract tests** asserting hidden initial stack, result-only content, per-card close control, and that recognized transcript is separate from HUD content.
- [ ] **Step 2: Run focused tests** and confirm they fail against current markup/render behavior.
- [ ] **Step 3: Wire command submission and `render(next)`** to the active HUD ID; preserve card on completion and route errors to the matching card.
- [ ] **Step 4: Re-run renderer tests** and confirm streaming and separation expectations pass.

### Task 5: Style the scrollable Iron Man HUD stack

**Files:**
- Modify: `src/windows.css`
- Modify: `tests/windows-live-transcript.test.ts`

- [ ] **Step 1: Add CSS assertions** for hidden-empty state, fixed-position stack, independent close button, and bounded scroll area.
- [ ] **Step 2: Run the focused test** and confirm the new style assertions fail.
- [ ] **Step 3: Style the stack** at the right of the helmet on wide windows and below/above it on narrow windows, respecting inspection mode and window edges. Use a fixed viewport-height cap with `overflow-y:auto`, never move the helmet or controls, and keep each card at compact width.
- [ ] **Step 4: Re-run style assertions** and inspect layout at 1920x1080 and 900x700 using the existing Electron visual check tooling when available.

### Task 6: Version, full verification, and installer

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Set package and lockfile version to `0.3.24`** using `npm version 0.3.24 --no-git-tag-version` only after all feature tests are green.
- [ ] **Step 2: Run `npm run windows:test`** and confirm the full suite passes.
- [ ] **Step 3: Run `npx tsc -p tsconfig.windows.json --noEmit`** and confirm no type errors.
- [ ] **Step 4: Run `npm run windows:dist`** and confirm the installer is produced under `release/windows/Jarvis-Windows-0.3.24-Setup.exe`.
- [ ] **Step 5: Run `git status --short`** and confirm only intended feature files are added/modified; do not commit or push.

## Coverage Review

- Hidden-at-start, unlimited append, order, independent close, and scrolling are covered in Tasks 3-5.
- Streaming card updates and user transcript separation are covered in Task 4.
- Explicit/default city weather, no browser launch, and network failures are covered in Tasks 1-2.
- Local-only policy and version bump are covered in Task 6.
