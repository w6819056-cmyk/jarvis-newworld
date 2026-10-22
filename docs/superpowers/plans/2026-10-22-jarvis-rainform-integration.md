# Jarvis Rainform Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan task-by-task in the current session, preserving the user's existing working-tree changes. Each task ends with its listed tests before continuing.

**Goal:** Integrate Rainform as a Jarvis-owned rainfall visualization module with named-city queries and nearest-rainy-city search across a redistributable catalog of Chinese prefecture-level cities.

**Architecture:** Jarvis main process owns QWeather credentials and network requests, coordinates current location through the existing HoloMap controller, and directs the Rainform renderer through a fixed validated IPC protocol. Codex receives only local tools and human-readable weather results; it does not receive credentials or raw coordinates. Rainform-derived files remain isolated with their original notices and license.

**Tech Stack:** Electron 44, TypeScript, Vite 8, Node fetch, existing QWeather APIs, Rainform Three.js/WebGL renderer, `node:test` through `tsx`.

## Global Constraints

- Keep the existing user working-tree changes; do not revert or stage unrelated files.
- Keep all QWeather credentials and host data in Jarvis local settings and the Electron main process; never bundle `.env` or secrets.
- Request geolocation only through the existing Jarvis map renderer and its restricted permission session.
- Search China-wide among prefecture-level city centers only; do not claim an exact nearest result if a closer city observation remains unresolved.
- Query cities nearest-first in batches with no more than 8 concurrent requests and a 10-minute in-memory observation cache.
- Keep current observed precipitation distinct from Rainform's next-24-hour forecast curve.
- Preserve Rainform's PolyForm Noncommercial 1.0.0 license and all `Required Notice:` lines; do not use in commercial distribution.
- Do not run a release build that overwrites existing `release/windows` artifacts without first selecting a distinct output directory.

## File Map

- `modules/rainform/`: isolated Rainform HTML, styles, runtime source, license, notice, and provider attribution.
- `modules/rainform/weather-client.js`: renderer-side adapter using only the exposed Rainform bridge for city lookup, current weather, and hourly forecast.
- `modules/rainform/control.ts`, `preload.ts`, and `protocol.ts`: fixed, validated main-to-renderer commands and weather requests.
- `electron/rainform-window.ts`: Jarvis-owned BrowserWindow, trusted sender checks, readiness, location command, and Rainform command/result IPC.
- `electron/qweather.ts`: main-process QWeather host/key handling, request timeouts, bounded response parsing, geocoding, current observation, hourly forecast, and city catalog discovery/normalization.
- `modules/rainform/city-catalog.json` and `modules/rainform/CITY-CATALOG-NOTICE.md`: bundled city centers, provider identifiers where available, and verified source license/attribution. Add these only after confirming redistribution rights.
- `electron/rain-search.ts`: distance calculation, rain classification, nearest-first batch search, retry, cache, and partial-result semantics.
- `modules/holo-map/protocol.ts`, `controller.ts`, `preload.ts`, and `renderer/App.tsx`: add one validated `getCurrentLocation` request and response.
- `electron/protocol.ts`, `main.ts`, `local-tools.ts`, `src/windows-main.ts`, `tests/windows-protocol.test.ts`: local QWeather settings, tools, orchestration, and user-facing configuration fields.
- `vite.windows.config.ts`, `tsconfig.rainform.json`, `scripts/build-windows.mjs`, and `electron-builder.yml`: Rainform renderer/build/preload packaging.
- `tests/windows-rain-*.test.ts`, `tests/windows-rainform-*.test.ts`, `tests/windows-map-controller.test.ts`, `tests/windows-map-packaging.test.ts`, `README.zh-CN.md`, and `docs/THIRD-PARTY-NOTICES.md`: coverage, packaging assertions, and notices.

## Task 1: Verify Rainform Integration and City-Catalog Rights

**Files:**
- Read: `C:\Users\Kevin\Rainform\LICENSE`, `NOTICE.md`, `docs/INTEGRATION.md`, `package.json`, and only production-required source/assets.
- Create: `modules/rainform/LICENSE`, `modules/rainform/NOTICE.md`, `modules/rainform/CITY-CATALOG-NOTICE.md`, `modules/rainform/city-catalog.json`.
- Test: `tests/windows-rainform-packaging.test.ts`.

- [ ] Identify production-required files from Rainform's source; exclude `node_modules`, `.env`, `.git`, generated `dist`, development-only tools, and screenshot artifacts.
- [ ] Identify a city-center catalog source whose terms explicitly allow local redistribution; record source URL, version/date, license, and attribution in `CITY-CATALOG-NOTICE.md`.
- [ ] If catalog redistribution is not permitted or cannot be established, stop this task and ask for a permitted data source; do not substitute Rainform's 14 demonstration cities for nationwide coverage.
- [ ] Copy the Rainform source and required license/notice files into the isolated module directory, preserving every required notice.
- [ ] Add a failing packaging test asserting the Rainform license/notice and catalog notice exist, the catalog contains at least 250 bounded China city records, and `.env`, `node_modules`, and upstream `dist` are absent.
- [ ] Run `npm run windows:test -- --test-name-pattern="Rainform package"` and confirm the test fails before required files are added, then passes.

## Task 2: Add Validated Device Location to HoloMap

**Files:**
- Modify: `modules/holo-map/protocol.ts`, `modules/holo-map/controller.ts`, `modules/holo-map/preload.ts`, `modules/holo-map/renderer/App.tsx`.
- Test: `tests/windows-map-controller.test.ts`.

- [ ] Add `getCurrentLocation` to the map command union and a result contract `{ latitude: number; longitude: number; address: string; city: string }`.
- [ ] In the renderer, return only the latest real device coordinates; if unavailable, invoke the existing real geolocation path and wait for its result, rejecting after 15 seconds without a fallback coordinate.
- [ ] Validate finite latitude in `[-90, 90]`, longitude in `[-180, 180]`, and bounded address/city strings in the controller before resolving.
- [ ] Add tests for a valid result, location failure, timeout/window close, and malformed coordinates.
- [ ] Run `npm run windows:test -- --test-name-pattern="map controller"` and verify all map-controller cases pass.

## Task 3: Implement Main-Process QWeather Client and Local Settings

**Files:**
- Create: `electron/qweather.ts`.
- Modify: `electron/protocol.ts`, `src/windows-main.ts`, `electron/main.ts`, `README.zh-CN.md`.
- Test: `tests/windows-qweather.test.ts`, `tests/windows-protocol.test.ts`.

- [ ] Add bounded `qweatherApiHost` and `qweatherApiKey` fields to settings validation and settings persistence; reject malformed hosts and values above 512 characters.
- [ ] Add two settings inputs and populate/save them through the existing settings action; show these fields with the map/weather configuration group and avoid writing credentials to logs.
- [ ] Implement a fetch-injected QWeather client requiring an HTTPS host, setting the API key only as the upstream authentication header, using 8-second timeouts, and limiting error bodies.
- [ ] Implement city lookup, current weather and precipitation extraction, and next-24-hour forecast normalization. Reject malformed API envelopes and unsupported precipitation values.
- [ ] Implement a one-time, no-log import of `QWEATHER_API_HOST` and `QWEATHER_API_KEY` from `C:\Users\Kevin\Rainform\.env` only when Jarvis settings lack those values; never copy or bundle the file.
- [ ] Add tests for auth header isolation, HTTPS/host validation, endpoint construction, timeout, invalid JSON, provider error codes, precipitation units, and settings bounds.
- [ ] Run `npm run windows:test -- --test-name-pattern="QWeather|settings accepts"`.

## Task 4: Implement Rain Classification, Distance Search, Retry, and Cache

**Files:**
- Create: `electron/rain-search.ts`.
- Test: `tests/windows-rain-search.test.ts`.

- [ ] Define city/result contracts using the verified bundled catalog; calculate great-circle distance in meters and sort stable ties by city name.
- [ ] Classify rain only from provider-defined current rain condition codes/text or a finite positive current precipitation field; do not infer current rain from forecast precipitation.
- [ ] Query nearest-first batches with `concurrency <= 8`; await all observations in a batch before selecting its nearest rainy city.
- [ ] Cache validated current observations by stable city ID for 10 minutes; provide a fake clock/cache clear seam for deterministic tests.
- [ ] Retry each failed city once. Continue searching, but return `partial: true` and the nearest verified rainy city if any unresolved city could be closer; never describe that result as certainly nearest.
- [ ] Test distance ordering, tie stability, rain/no-rain classification, batch selection, closer-city failure, retry once, max concurrency, cache TTL/expiry, malformed data, and exhausted no-rain catalog.
- [ ] Run `npm run windows:test -- --test-name-pattern="rain search|rain classification|rain cache"`.

## Task 5: Add Rainform Main-Process Window and Restricted Protocol

**Files:**
- Create: `electron/rainform-window.ts`, `modules/rainform/protocol.ts`, `modules/rainform/preload.ts`, `modules/rainform/control.ts`.
- Modify: `scripts/build-windows.mjs`.
- Test: `tests/windows-rainform-controller.test.ts`, `tests/windows-rainform-ipc.test.ts`.

- [ ] Define fixed commands `setCity`, `setRainfallForecast`, and `showStatus`, with request IDs, bounded string/array sizes, valid coordinate ranges, exactly 25 nonnegative forecast values, bounded time labels, and explicit units/timestamps.
- [ ] Implement a controller that opens/focuses one Jarvis-owned Rainform window, waits for renderer readiness, correlates replies, rejects malformed/untrusted messages, times out, and rejects pending requests on close.
- [ ] Configure `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, deny popups and non-file navigation, and use a dedicated persistent session without geolocation permission.
- [ ] Expose only command subscription, completion, and QWeather request methods through the Rainform preload; never expose `ipcRenderer`, Node APIs, credentials, or arbitrary URLs.
- [ ] Add tests for ready reuse, trusted/untrusted sender checks, invalid city/coordinates/forecast payload, timeout, renderer close, and arbitrary navigation denial.
- [ ] Run `npm run windows:test -- --test-name-pattern="Rainform controller|Rainform IPC"`.

## Task 6: Connect Rainform Renderer to Jarvis Weather and City Commands

**Files:**
- Modify: `modules/rainform/src/weather.js`, `modules/rainform/src/main.js`, `modules/rainform/src/bootstrap.js`, `modules/rainform/index.html`, `modules/rainform/src/styles.css`.
- Create: `tests/windows-rainform-renderer.test.ts`.

- [ ] Replace direct `/qweather` calls in the packaged Rainform renderer with the restricted bridge adapter while keeping the upstream 25-point curve and manual city controls intact.
- [ ] Add a host-command listener that validates the fixed schema, resolves the selected city, refreshes current observation and hourly forecast through the bridge, switches city state, and invokes existing `loadLiveWeather()`/`applyRainfallData()` paths.
- [ ] Keep current observation text/precipitation separate from the forecast curve and show update time, unit, loading, and failure states in Rainform's UI.
- [ ] Return a completion result only after the city change and forecast refresh succeed; retain the last valid scene on failure.
- [ ] Test host-triggered city switching, request bridge usage, no direct renderer secret, 25-point series, malformed command rejection, and forecast failure retaining the current scene.
- [ ] Run `npm run windows:test -- --test-name-pattern="Rainform renderer"` and the Rainform source `npm run check` in `C:\Users\Kevin\Rainform` before copying any later source changes back.

## Task 7: Add Jarvis Local Tools and Orchestration

**Files:**
- Modify: `electron/local-tools.ts`, `electron/main.ts`, `electron/protocol.ts`.
- Test: `tests/windows-local-tools.test.ts`, `tests/windows-rainform-orchestration.test.ts`.

- [ ] Add `jarvis_find_nearest_rainy_city` with an empty strict schema and `jarvis_show_city_rain` with a required bounded city string; describe that both control Jarvis's Rainform module and never launch an external app.
- [ ] Inject `MapController`, QWeather client, rain-search service, and Rainform controller into `LocalTools` behind narrow interfaces.
- [ ] For nearest search: get current location first, search the catalog, select or report partial result, then send the chosen city and hourly forecast to Rainform; return spoken location/distance/current precipitation and search-confidence wording.
- [ ] For named-city query: resolve unambiguous city; if multiple matches remain, return bounded candidates and request clarification instead of selecting the first silently; then query current conditions and forecast and update Rainform.
- [ ] Register the Rainform window/controller in main process and close/reject it alongside HoloMap on app shutdown; do not block or replace Mineradio lifecycle.
- [ ] Tests verify tool schemas, no external `openApp`/browser invocation, map location usage, selected city forwarding, partial-result wording, errors, and normal named-city flow.
- [ ] Run `npm run windows:test -- --test-name-pattern="local tools|Rainform orchestration"`.

## Task 8: Add Rainform Build, Packaging, Attribution, and Version

**Files:**
- Create: `tsconfig.rainform.json`.
- Modify: `vite.windows.config.ts`, `package.json`, `package-lock.json`, `scripts/build-windows.mjs`, `electron-builder.yml`, `docs/THIRD-PARTY-NOTICES.md`, `README.zh-CN.md`, `tests/windows-rainform-packaging.test.ts`.

- [ ] Add Rainform as a separate Vite HTML entry with relative assets and CSP limited to local resources required by the module; do not add remote script dependencies.
- [ ] Compile its preload/controller and QWeather main-process adapter into resolvable `dist-electron` files; package renderer files, Rainform license/notices, and catalog attribution, excluding `.env`, `node_modules`, and source development files not needed at runtime.
- [ ] Add distribution checks proving renderer bundles contain no QWeather API host/key and all Rainform/CITY catalog notices ship with the module.
- [ ] Increment the app version by exactly one patch from the checked-out version, update the lockfile consistently, and leave old release installers untouched.
- [ ] Add visible Rainform attribution in Jarvis documentation/about content and a clearly separate Rainform license entry in third-party notices.
- [ ] Run `npm run windows:test` and `npm run windows:build`; inspect the generated file list and search renderer output for credential values and `.env` references.

## Task 9: Local GUI Acceptance and Delivery

**Files:**
- Modify: `docs/WINDOWS.md` only if setup/usage instructions need updating.
- Test: local Jarvis application and Rainform window.

- [ ] Run app from the built local output without producing or overwriting an installer.
- [ ] Configure QWeather host/key locally, confirm the values persist without appearing in renderer assets or logs, and grant Windows location only to Jarvis's map window.
- [ ] Test “现在离我们最近的哪个城市在下雨”: verify location, nearest-first search, reported city/distance/current rain, Rainform opening and city switch, and 24-hour curve refresh.
- [ ] Test a named city through both voice and typed input; confirm current measured rainfall and forecast curve are labeled separately.
- [ ] Test denied location, missing credentials, network failure, no rain in catalog, partial search, and closing Rainform during a request.
- [ ] Report test/build status, the local output path, credential setup location, and remaining live API limitations. Do not push to a remote repository.

## Execution Notes

- Execute in the current session in batches, preserving the existing local-only workflow.
- Before any release packaging, inspect the existing `release/windows` outputs and choose a separate output directory if an installer is requested.
- Stop before integration if either Rainform source integration rights or city-catalog redistribution rights cannot be verified; report the exact permission needed.
