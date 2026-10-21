# Jarvis Search, Video, and Voice HUD Design

## Goal

Make web search, video playback requests, and Codex Voice responses visible and actionable through Jarvis's existing local HUD cards.

## User Experience

- A web-search request retrieves a bounded set of results. The active HUD card shows readable titles, short summaries, and source links; it does not merely say that a browser was opened.
- A request to find and play a video searches for the requested subject and opens the selected video in the user's default browser. The HUD reports what is opening and includes its source URL. If no suitable result is found, the HUD reports that outcome.
- Final Codex Voice assistant transcripts create or update the HUD response for that voice turn. Streaming text updates the same card when the protocol provides deltas; final text is retained without creating a duplicate card.
- Existing text/Codex replies, weather results, HUD close behavior, and voice-provider selection remain intact.

## Architecture

- Extend the existing bounded local-tool layer with separate web-search and video-search/play actions. Validate non-empty queries, cap result count and text length, enforce request timeouts, and accept only safe HTTP/HTTPS result URLs without credentials.
- Prefer a no-key search source. Return structured results to Codex so it can answer the request while the active HUD card can display useful result details and citations.
- Use the existing default-browser adapter to open the selected video URL. Do not embed a player in Jarvis.
- Route finalized Codex Voice assistant transcript events through the existing assistant state and HUD rendering path. Correlate them with the active voice turn and avoid duplicating the same final response.
- Keep all archives and state local; this feature adds no cloud persistence.

## Failure Handling

- Network errors, timeouts, malformed search responses, empty results, and unsafe result URLs return a concise tool error that can be shown in the HUD.
- Search output is bounded to a small number of results and short text fields so it cannot overwhelm the voice context or HUD.
- Failure to open a video is reported in the same HUD card; it does not silently claim playback succeeded.
- Missing or unsupported Codex Voice transcript events leave the existing provider behavior unchanged.

## Verification

- Unit tests cover bounded search parsing, result URL validation, empty results, timeout/error handling, and video URL opening.
- Voice tests cover finalized assistant transcript forwarding, streaming updates where available, and duplicate-final suppression.
- HUD tests verify search results and Codex Voice replies update the current turn's card without creating unintended duplicates.
- Run the Windows test suite and TypeScript/build checks. Do not publish or push the local project.
