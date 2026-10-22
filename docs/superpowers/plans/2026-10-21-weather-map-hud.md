# Weather Map HUD Implementation Plan

> **For agentic workers:** Execute this plan inline in this session, task by task. Use test-first changes and verify each focused test before continuing.

**Goal:** Turn weather replies into map-based HUD cards with location, weather icon, details, and spoken output.

**Architecture:** Return typed weather data from the existing Open-Meteo service, carry it as a bounded local-tool display payload through Electron state, and render it in a Leaflet/OpenStreetMap HUD card. Preserve text HUD fallback and local-only persistence.

**Tech Stack:** Electron, TypeScript, Leaflet 1.9, OpenStreetMap tiles, Open-Meteo, existing node:test/tsx suite, Vite.

## Global Constraints

- Keep location and weather data local to the running app; do not archive or upload it.
- Keep existing city validation, network timeouts, and readable errors.
- Use OpenStreetMap attribution in the map card.
- Preserve existing text HUD cards, voice providers, and map-independent functions.
- Bump the app version from `0.3.25` to `0.3.27` after the map loading and responsive HUD fix.

---

### Task 1: Return structured weather data

**Files:**
- Modify: `electron/weather.ts`
- Modify: `tests/windows-weather.test.ts`

**Interfaces:**
- Produce `WeatherResult` with `city`, optional `country`, `latitude`, `longitude`, `temperature`, optional `feelsLike`, `humidity`, `windSpeed`, `weatherCode`, `condition`, optional `updatedAt`, and `locationMode: 'current' | 'named'`.
- Preserve `lookupWeather(options): Promise<WeatherResult>` and all existing validation/error behavior.

- [x] Write failing tests for typed named/current results and coordinates while retaining error cases.
- [x] Run the focused weather tests and confirm failure against the string-only implementation.
- [x] Implement the typed result and a `formatWeatherSpeech(result)` helper for the concise spoken summary.
- [x] Re-run the focused weather tests.

### Task 2: Carry a structured weather display payload

**Files:**
- Modify: `electron/local-tools.ts`
- Modify: `electron/protocol.ts`
- Modify: `electron/main.ts`
- Modify: `tests/windows-local-tools.test.ts`

**Interfaces:**
- Extend `ToolResult` with optional `{ kind: 'weather'; weather: WeatherResult }` display data.
- `jarvis_get_weather` returns the formatted speech text and display payload.
- `AssistantState.weather` is optional and is reset at the beginning of each new request.

- [x] Write failing tests for the weather tool's formatted text and structured display payload.
- [x] Run local-tool tests and verify the display assertion fails.
- [x] Implement type-safe display propagation and publish weather payloads when dispatching the local tool.
- [x] Re-run local-tool, protocol, and existing runtime tests.

### Task 3: Render map weather HUD cards

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/windows-main.ts`
- Modify: `src/windows.css`
- Test: `tests/windows-weather-hud.test.ts`

**Interfaces:**
- Add `leaflet` and `@types/leaflet` dependencies.
- Weather HUD markup includes `.win-weather-card`, `.weather-map`, `.weather-location`, `.weather-icon`, `.weather-temperature`, and `.weather-details`.
- Initialize a Leaflet map centered on `WeatherResult.latitude/longitude`, add an OpenStreetMap tile layer and circle marker, and clean up map instances when cards close/unload.

- [x] Write failing renderer source tests for weather card markup, OpenStreetMap layer, attribution, map disposal, and text fallback.
- [x] Run the focused renderer tests and confirm failure.
- [x] Implement the weather card and map lifecycle without changing normal text cards.
- [x] Run renderer tests and TypeScript checks.

### Task 4: Version, build, and verify

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] Bump package versions to `0.3.27` without changing unrelated dependencies.
- [x] Run `npm run windows:test`, `npx tsc -p tsconfig.windows.json --noEmit`, `git diff --check`, and the renderer build.
- [x] Run `npm run windows:dist` and verify `release/windows/Jarvis-Windows-0.3.27-Setup.exe` exists.
- [x] Keep all changes local; do not push or publish.
