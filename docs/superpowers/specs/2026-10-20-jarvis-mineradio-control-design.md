# Jarvis–Mineradio Voice Control Design

## Goal

Let the user speak naturally to Jarvis and have Jarvis operate Mineradio. The user should not need to memorize exact command phrases. The first release covers opening Mineradio, playback control, search and play, volume, and current playback status. The design must continue working when Jarvis switches from its current voice path to Codex Voice.

## User Experience

The user can say requests such as:

- “打开音乐播放器。”
- “给我放点周杰伦的歌。”
- “这首先停一下。” / “继续播放。”
- “换一首。” / “回到上一首。”
- “声音小一点。” / “音量调到 30%。”
- “现在放的是什么？”

Jarvis interprets intent and parameters, calls a Mineradio-specific tool, waits for the tool result, and reports only what Mineradio confirms. For ambiguous search results, missing platform choices, or unavailable playback state, Jarvis asks a short follow-up question. Destructive playlist operations are outside the first release.

## Architecture

```text
Microphone / text input
        |
        v
Jarvis voice provider -> Codex conversation and intent interpretation
        |                         |
        |                         +-- dynamic Mineradio tools
        v
Jarvis Electron main process (named-pipe server)
        | Windows named pipe, versioned JSON request/response + events
        v
Mineradio Electron main process (authenticated pipe client) -> existing renderer playback actions
        |                                      |
        +----------- result/status events <----+
```

Jarvis remains the sole owner of microphone capture, wake behavior, speech recognition, Codex conversation, and spoken responses. Mineradio remains the sole owner of music providers, playback, lyrics, visual modes, and its own user data. Neither application receives the other application's credentials or directly manipulates its renderer DOM.

Jarvis hosts a Windows named pipe server instead of opening an HTTP listener. It generates a random endpoint suffix and one-time token for each Jarvis process. When opening Mineradio, Jarvis starts its executable with the endpoint and token in a narrowly parsed argument pair. Mineradio's Electron single-instance lock forwards those arguments to an already-running instance through `second-instance`, allowing a user-opened instance to connect without creating another window. The pipe is restricted to the current interactive user. The token is checked during the first client handshake before any requests are accepted. Messages use bounded newline-delimited JSON with request IDs, protocol version, action, and payload. Unknown versions/actions, oversized frames, malformed input, and unauthorized clients are rejected.

## Startup and Connection

Jarvis receives an explicit Mineradio executable path setting, with a safe discovery attempt for the standard installation location. “Open Mineradio” creates its pipe listener, generates a one-time token, and launches the configured executable with only the bridge endpoint/token arguments. If Mineradio is already running, Electron forwards the arguments to its primary instance, which connects to Jarvis and focuses its window. Jarvis waits for the authenticated handshake with a bounded timeout. Repeated open requests reuse the current authenticated connection and focus the window.

Jarvis may continue to send playback tools only while the bridge is connected. If Mineradio exits or the bridge disconnects, Jarvis reports that state and can offer to reopen Mineradio. It must not report playback as successful merely because a request was sent; it waits for an accepted execution result.

## Protocol and Actions

Protocol messages include `version`, `id`, `type`, `action`, and `payload`. Responses echo `id` and include `ok`, a stable error code when needed, and a structured result. Unsolicited events include connection state, playback state, current track, duration/progress, volume, and provider availability.

The first release exposes narrow operations:

- `app.open` / `app.focus`
- `player.get_state`
- `player.play` / `player.pause` / `player.resume`
- `player.next` / `player.previous`
- `player.set_volume` with a clamped 0–100 integer
- `search.play` with a bounded query and an optional supported provider

Search results must return the selected track and provider, or a typed no-results/ambiguous-result response. Jarvis can ask the user to choose when confidence is insufficient. The bridge does not accept shell strings, JavaScript, arbitrary URLs, file paths, or generic renderer commands.

## Natural Language and Voice Provider Independence

Jarvis exposes the bridge operations as dynamic Codex tools with concise descriptions and JSON schemas. Codex maps varied Chinese phrasing to these tools; deterministic state changes are tool calls, not guessed natural-language confirmations. The current local/Doubao transcription path and future Codex Voice both feed the same Codex conversation/tool layer, so no Mineradio-specific voice integration is added to each provider.

The assistant instructions explain the available Mineradio actions, require clarification when an essential parameter is missing, and prohibit claiming success without a successful tool response. The wake listener and voice capture lifecycle remain unchanged.

## Error Handling

- Mineradio not installed or executable path invalid: explain how to select the executable in Jarvis settings.
- Startup or handshake timeout: report that Mineradio did not become ready; do not imply the command ran.
- Disconnected during a request: return a connection error; do not retry non-idempotent search/play automatically.
- Unsupported provider or no search result: return a typed response that Jarvis can explain or clarify.
- Stale/out-of-order events: sequence playback events and include a monotonically increasing revision so Jarvis ignores older state.
- Jarvis STOP: interrupt the current Codex turn. It does not forcibly terminate Mineradio or undo a completed playback action.

## Security and Privacy

The pipe is local-only and restricted to the current user. A one-time token passed only to the launched/forwarded Mineradio instance protects the handshake from unrelated clients; the token is never persisted or logged. The action schema is an allowlist; no arbitrary command execution or file modification is exposed. Search terms and track metadata remain local to the two applications except for requests already sent to the selected music provider. The bridge does not transfer Jarvis voice recordings or Codex credentials to Mineradio.

## Testing and Acceptance

Protocol tests cover valid handshakes, authorization failures, malformed/oversized frames, unsupported versions/actions, request correlation, disconnects, and event ordering. Mineradio integration tests verify every allowlisted action against its existing playback/store layer. Jarvis tool tests verify natural-language tool schemas, structured success/error reporting, and that the tool result—not the attempted request—drives the spoken claim.

End-to-end acceptance on Windows verifies:

1. Saying “打开音乐播放器” starts or focuses the configured Mineradio instance.
2. Different phrasings of search-and-play reach the same structured action.
3. Pause, resume, previous/next, volume, and status work through voice and text input.
4. Playback state changes initiated inside Mineradio are reflected in Jarvis.
5. Switching Jarvis between local/Doubao and Codex Voice does not change bridge behavior.
6. Closing Mineradio, starting a second instance, an unavailable provider, and an ambiguous search produce truthful, recoverable responses.

## Rollout

Implement the shared protocol and playback actions first, then Jarvis tool registration and Mineradio settings/discovery, then run end-to-end tests with both development and packaged builds. Keep lyric, visual-mode, playlist editing, and desktop-mode tools out of the first release; they can be added as new versioned allowlist actions later.
