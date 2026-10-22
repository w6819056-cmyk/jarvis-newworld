# Jarvis Rainform Integration Design

## Goal

Integrate the user's local Rainform checkout into Jarvis as a locally managed rainfall visualization module. A spoken or typed request can find the nearest Chinese prefecture-level city with current rain, report it, and show Rainform switched to that city. A named-city rain query follows the same display path.

## User Flow

### Find the nearest rainy city

1. The user says or types a request such as “现在离我们最近的哪个城市在下雨”.
2. Codex interprets the request and calls a dedicated Jarvis local tool. Codex does not receive raw GPS coordinates in the conversation; the local tool owns location and weather access.
3. Jarvis asks the existing map module for the current device coordinates through its restricted IPC interface. If permission is missing or location fails, Jarvis reports that and does not guess a location.
4. Jarvis loads a bundled catalog of Chinese prefecture-level cities, measures distance from the current coordinates to each city center, and queries weather candidates in nearest-first distance batches.
5. A city is considered rainy when the current QWeather observation indicates a rain condition or reports positive precipitation. Jarvis uses the nearest match from the first distance batch containing a rainy city. It caches each city's current observation for 10 minutes and limits concurrent requests to 8.
6. Jarvis returns the city, distance, observation time, condition, and precipitation amount to Codex for a concise spoken response.
7. Jarvis opens or focuses its Rainform BrowserWindow and sends the selected city's name, administrative region, coordinates, and available QWeather city ID over a restricted preload bridge. Rainform switches to the city and refreshes its 24-hour hourly precipitation series and 3D scene.

If every city in the bundled catalog has been checked without finding rain, Jarvis reports that no rainy city was found in the supported city catalog. It does not claim this proves that every village or weather station in China is dry.

### Query a named city

For a request such as “郑州现在的雨有多大”, Codex calls a named-city local tool. Jarvis resolves the name, obtains current conditions and the hourly forecast, opens or focuses Rainform, and sends the resolved city data to it. Jarvis speaks the current observation, while Rainform visualizes the city's next 24 hours of hourly precipitation.

## Architecture

### Local orchestration

Jarvis exposes narrow local tools for finding the nearest rainy city and querying a named city. The local service performs deterministic location, distance ordering, city selection, weather lookup, and Rainform control. Codex decides when to invoke the tools and formulates the response from their returned data. Tools validate bounded arguments and return explicit failures for unavailable dependencies.

### Location source

Extend the existing Jarvis-owned map controller with a request for the latest device location. The map renderer remains the only component that requests geolocation permission. Its existing session permission policy stays restricted to that window; the map preload returns only validated latitude, longitude, and a resolved address or city label. Coordinates are passed between trusted local components and are not added to persistent conversation memory.

### Weather access and credentials

Rainform's current weather client calls `/qweather/...` through a Vite development proxy. That proxy is absent from the packaged application, so packaged requests must move behind a Jarvis main-process weather adapter. The renderer will call only a restricted preload API for city lookup, current observations, and hourly precipitation; it will not receive the QWeather key or host.

Jarvis settings will store the QWeather API host and key locally in the user's Jarvis configuration. Development may continue to use Rainform's Vite proxy, but the `.env` file is never copied into renderer assets or the installer. Existing credentials may be imported from Rainform's ignored local `.env` during first setup without logging the values; if they are absent, Jarvis will show a clear setup state rather than silently using sample/default weather.

### Rainform module window

Rainform source is integrated under a clearly named `modules/rainform` directory and built as a local renderer entry. Jarvis creates and owns its BrowserWindow, applies context isolation and sandboxing, disables Node integration and untrusted popups, and exposes only the minimum bridge methods required to receive city/weather updates. City changes are commands, not navigation to an external site. The window can remain open for the user to explore Rainform controls, while Jarvis-originated city changes update the same scene.

### Nationwide city search

The search catalog's source must permit redistribution and its attribution must be retained. Failed city lookups are retried once. A result is described as the nearest rainy city only when every closer candidate has a successful current observation. If an unresolved candidate could be closer than the nearest verified rainy city, Jarvis reports a partial search and labels the result as the nearest verified rainy city rather than claiming certainty. If the entire catalog is checked successfully without rain, Jarvis reports no rainy city in the supported catalog.

The search catalog contains Chinese prefecture-level city centers and stable provider identifiers where available. Candidates are sorted by great-circle distance from the current location and processed in nearest-first batches, with at most 8 simultaneous weather requests. A 10-minute in-memory observation cache avoids repeating requests for the same city. A batch is fully evaluated before selecting its nearest rainy member, so a farther result cannot mask a closer rainy city in that batch. If no earlier batch has rain, the search expands until it finds a match or exhausts the catalog.

The returned current precipitation keeps the provider's documented unit and observation timestamp. Rainform's curve continues to use its 25-point representation of the provider's next-24-hour hourly precipitation, labeled in mm/h. Current observations and hourly forecasts must be presented as distinct data so a forecast value is not described as a measured current intensity.

## Failure Behavior

- Location denied/unavailable: explain that Windows location access is required and do not use a fixed or IP-derived position for nearest-city search.
- QWeather credentials absent or invalid: show a settings/configuration error; do not fall back to fabricated rainfall values.
- API timeout, quota, or network failure: retry a city once, return a bounded readable error, and do not claim a globally nearest result when closer candidates remain unresolved. Retain any already validated cache result only if it is still within its 10-minute TTL.
- No rainy city found: report that none was found among supported prefecture-level cities and offer a named-city query.
- Rainform renderer unavailable: Jarvis still reports a successfully retrieved weather result, while clearly stating that the visualization could not be opened or updated.
- Renderer reports an invalid city or malformed result: reject it at the main-process boundary and leave the last valid Rainform scene intact.

## Security, Privacy, and Licensing

- GPS and QWeather credentials remain in local Jarvis-owned processes/settings; neither is sent to Codex as model context unless a response requires a human-readable city/distance.
- The Rainform preload accepts a fixed command schema and validates city names, IDs, coordinates, arrays, and numeric precipitation values.
- The Rainform `.env`, `node_modules`, generated bundles, and local secrets are excluded from source integration and packaging.
- Keep Rainform-derived code, its `LICENSE`, and `NOTICE.md` clearly separate. Add the required Rainform attribution to Jarvis credits/documentation and retain all `Required Notice:` lines.
- Rainform is under PolyForm Noncommercial 1.0.0. Integration and any redistribution must remain noncommercial unless the author grants written permission. Do not claim the combined repository is covered solely by Jarvis's GPL license.

## Verification

- Unit tests cover city distance ordering, rainy-condition classification, batch selection, closer-candidate failures, retry behavior, cache expiration, concurrency bounds, malformed provider data, and no-result behavior.
- Local-tool tests prove that voice requests invoke the intended Rainform/weather operations and that failures are surfaced without opening external software.
- IPC tests reject untrusted senders, invalid coordinates, oversized payloads, and arbitrary navigation.
- Packaging tests verify the Rainform renderer and preload are included while `.env` and API credentials are absent from renderer bundles and installer inputs.
- GUI acceptance checks that nearest-city search uses actual device location, reports a result, opens the Jarvis-owned Rainform window, switches the city, and renders fresh hourly precipitation; named-city voice and typed requests follow the same path.

## Out of Scope

- Scanning every county, township, or individual weather station. “Nearest city” means the nearest rainy city among the bundled prefecture-level city catalog.
- Opening an external browser or standalone Rainform process.
- Nationwide rain radar visualization, historical rainfall, or automatic periodic monitoring after a one-shot query.
- Distributing Rainform as a commercial feature.
