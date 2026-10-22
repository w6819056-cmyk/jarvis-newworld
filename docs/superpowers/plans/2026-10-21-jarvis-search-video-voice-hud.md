# Jarvis Search, Video, and Voice HUD Implementation Plan

> **For agentic workers:** Execute this plan inline in this session, task by task. Use test-first changes and verify each focused test before continuing.

**Goal:** Show useful web-search results and Codex Voice replies in Jarvis HUD cards, and open requested videos in the default browser.

**Architecture:** Add a small no-key DuckDuckGo HTML search adapter in the Electron main process, expose bounded search and video-open local tools to Codex, and route finalized Codex Voice assistant transcripts into the existing HUD result list. Keep the current tool and HUD boundaries; no embedded player or cloud archive is added.

**Tech Stack:** Electron main process, TypeScript, Node `fetch`, existing `node:test`/`tsx` test suite, existing renderer HUD.

## Global Constraints

- Keep all project data local; do not publish or push.
- Keep HTTP requests bounded by timeout, result count, and text size.
- Only open credential-free HTTP/HTTPS URLs from validated search results.
- Keep the existing Codex, Doubao, and local voice-provider selection unchanged.
- Bump the app version from `0.3.24` to `0.3.25` for this functional update.

---

### Task 1: Add a bounded web-search adapter

**Files:**
- Create: `electron/web-search.ts`
- Test: `tests/windows-web-search.test.ts`

**Interfaces:**
- Produces: `searchWeb(query: string, options?: { fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<SearchResult[]>`
- `SearchResult` is `{ title: string; url: string; snippet: string }`.
- Return at most five results with title <= 200 characters and snippet <= 500 characters. Reject empty/overlong queries, unsafe URLs, malformed pages, HTTP failures, timeouts, and no-result pages with readable errors.

- [x] **Step 1: Write failing tests** for extracting result titles/links/snippets from DuckDuckGo HTML, limiting results and lengths, rejecting empty/overlong queries and unsafe URLs, and reporting empty/network/HTTP/timeout failures.
- [x] **Step 2: Run `npx tsx --test tests/windows-web-search.test.ts`** and verify expected failures against the absent module.
- [x] **Step 3: Implement the adapter** with `https://html.duckduckgo.com/html/?q=...`, `AbortController` timeout cleanup, bounded decoding of HTML entities, and strict credential-free HTTP/HTTPS URL validation.
- [x] **Step 4: Re-run the focused test** and verify all adapter cases pass.

### Task 2: Expose search and video playback tools

**Files:**
- Modify: `electron/local-tools.ts`
- Modify: `electron/main.ts`
- Test: `tests/windows-local-tools.test.ts`

**Interfaces:**
- `LocalTools` adapter receives `searchWeb(query: string): Promise<SearchResult[]>`.
- Add `jarvis_search_web({ query })` returning bounded JSON results for Codex to summarize and cite in its reply.
- Add `jarvis_play_video({ query })`, searching `query + " 视频"`, opening the first validated result in the default browser, and returning the selected title and URL. If search returns no result, return a clear failure without opening a URL.

- [x] **Step 1: Add failing tests** for both tool schemas, structured search results, query validation and extra-key rejection, selecting/opening the first search result for video, and no-result/search-error behavior without browser launch.
- [x] **Step 2: Run `npx tsx --test tests/windows-local-tools.test.ts`** and verify failures identify missing tool behavior.
- [x] **Step 3: Implement the tools** with maximum query length 500, strict arguments, five-result and character bounds, and no shell execution. Construct `LocalTools` in `electron/main.ts` with the new adapter.
- [x] **Step 4: Re-run local-tool and web-search tests** and verify the existing weather, app-open, memory, and Mineradio tool cases still pass.

### Task 3: Forward Codex Voice final replies to HUD

**Files:**
- Create: `src/codex-voice-hud.ts`
- Modify: `src/windows-main.ts`
- Test: `tests/windows-codex-voice-hud.test.ts`

**Interfaces:**
- `CodexVoiceHud.accept(event: unknown): number | undefined` accepts only finalized assistant events, creates a completed `HudResults` item, and suppresses an identical immediate duplicate. A user final transcript resets duplicate suppression for the next turn.
- Renderer handles the assistant event using the returned HUD id; user transcript archival in the main process remains unchanged.

- [x] **Step 1: Add failing tests** for finalized assistant replies creating completed HUD results, duplicate finals being ignored, new user finals allowing identical replies in a later turn, and delta/audio events being ignored.
- [x] **Step 2: Run `npx tsx --test tests/windows-codex-voice-hud.test.ts`** and verify the new expectations fail.
- [x] **Step 3: Implement the renderer event path** in the existing `api.onCodexVoiceEvent` handler. Do not set unrelated assistant busy state or speak the reply a second time; Codex Voice audio remains owned by the existing WebRTC session.
- [x] **Step 4: Re-run focused tests** and verify duplicate suppression, user event pass-through behavior, and current SDP handling.

### Task 4: Version and verify the release surface

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] **Step 1: Bump version** from `0.3.24` to `0.3.25` in both package manifests without changing dependencies.
- [x] **Step 2: Run focused tests**: `npx tsx --test tests/windows-web-search.test.ts tests/windows-local-tools.test.ts tests/windows-voice.test.ts tests/windows-codex-voice-hud.test.ts tests/windows-hud-rendering.test.ts`.
- [x] **Step 3: Run full checks**: `npm run windows:test`, `npx tsc -p tsconfig.windows.json --noEmit`, and `git diff --check`.
- [x] **Step 4: Build into a new temporary output directory** using the Windows TypeScript configuration and Vite renderer build. Do not run `scripts/build-windows.mjs`, because it recursively deletes the existing untracked `dist-electron-build/` directory before building. Do not create or push a cloud release.

## Self-Review

- Search results/HUD behavior: Tasks 1-2 provide structured results and bounded errors; existing Codex reply flow supplies the search answer to the HUD.
- Video behavior: Task 2 searches for video results and opens the selected validated URL using the existing default-browser adapter.
- Codex Voice HUD behavior: Task 3 adds final assistant transcript events to the existing HUD list without duplicating audio playback.
- No-key provider, request limits, error behavior, local-only persistence, and version bump are covered.
- Live DuckDuckGo access could not be verified in this environment because DNS resolution for `html.duckduckgo.com` fails; deterministic parser and failure-path tests cover the response contract.
