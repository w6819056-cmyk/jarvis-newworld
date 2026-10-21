# Weather Map HUD Design

## Goal

Render weather requests as a dedicated JARVIS HUD card containing a real map, a location marker, weather icon, and concise weather details while keeping spoken weather answers.

## Behavior

- “今天天气怎么样” uses the existing IP-based current-city lookup. The card labels the location as the current location and centers the map on that city's coordinates.
- “看看上海的天气” geocodes Shanghai, centers the map on Shanghai, and labels the selected city.
- The card contains an OpenStreetMap map, a location marker, city name, weather icon, condition, temperature, feels-like temperature, humidity, wind, and update time when available.
- The assistant continues to speak the concise weather summary through the active voice provider.
- Non-weather replies keep the existing text HUD card. Multiple HUD cards remain independently closable.

## Architecture

- Extend `electron/weather.ts` to return a typed `WeatherResult` with location, coordinates, current values, weather code, condition, and source mode. Keep bounded validation and existing provider APIs.
- Extend the local-tool result with an optional display payload. The weather tool returns a spoken text plus a structured weather payload; the Electron main process publishes the payload through `AssistantState`.
- Add Leaflet as a bundled renderer dependency. The weather HUD card initializes a Leaflet map with OpenStreetMap tiles and a circle marker, then invalidates its size after insertion. Map instances are disposed when cards close or the page unloads.
- Keep map tiles and weather requests network-only at runtime. No location or weather data is persisted to the cloud or local archive.

## Failure Handling

- Existing weather errors remain readable text HUD results and are still spoken.
- Missing weather fields prevent the structured card from rendering and fall back to the text result.
- Map tile failures do not fail the weather request; the card still shows the location and weather details.
- Map containers have bounded dimensions and do not change the HUD stack's scroll behavior.

## Verification

- Weather tests verify current-city and named-city coordinates, typed fields, and existing error handling.
- Local-tool tests verify the spoken result and structured display payload.
- Renderer tests verify weather card markup, map initialization/disposal hooks, and text-card fallback.
- Run all Windows tests, TypeScript checks, renderer build, and the Windows installer build as version `0.3.26`.
