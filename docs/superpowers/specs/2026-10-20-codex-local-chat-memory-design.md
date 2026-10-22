# Codex Local Chat Archive and Semantic Memory Design

## Goal

Add a Jarvis-owned local text archive and explicit long-term semantic memory that remain available while using Codex Voice. Codex threads continue to own native conversation continuity; the Jarvis store supports cross-thread history search and carefully scoped memory retrieval.

## User Experience

- Each completed user utterance and final Jarvis/Codex response is saved locally with its timestamp, Codex thread ID, and workspace path. Store recognized text only; never store microphone audio.
- The archive is independent of the selected voice provider and Codex thread lifecycle. It can be searched across workspaces and threads, and a user can delete an individual conversation or clear the archive.
- Long-term memory is written only after an explicit user instruction such as “记住我喜欢简洁的回答”. Ordinary conversation is not automatically promoted into memory.
- The user can ask “我让你记住了什么”, “搜索以前的聊天……”, and “忘记……”. Forgetting a memory removes it from retrieval and its persistent index.
- When a Codex turn needs a saved preference or past conversation detail, Codex can call a bounded local search tool. Retrieved entries are clearly labeled as stored memory/history, not as something the user just said. The full archive is never injected into a turn.
- Memory entries can be listed, searched, and deleted. If memory retrieval is unavailable, Codex continues without it and the archive remains intact.

## Architecture

Add a local `ConversationStore` owned by the Electron main process and stored beneath `app.getPath('userData')`. Use SQLite, with schema migrations and parameterized queries, for conversation turns and long-term memory records. Keep the existing `jarvis-settings.json` limited to settings and thread IDs.

Conversation records contain an event key, user text, assistant text, timestamp, Codex thread ID (or a Jarvis-local command thread), and workspace path. Save submitted typed text and finalized voice text, then complete the turn when its corresponding final assistant response arrives; retain a user-only record if the turn fails. The installed Codex app-server 0.163 protocol schema exposes `thread/realtime/transcript/done` with `role`, `text`, and `threadId`, and does not expose a stable transcript event/item ID. Jarvis consumes this final notification directly from the existing app-server event path; it does not inspect WebRTC audio or attach a second `oai-events` listener. It suppresses an identical repeated final user transcript within four seconds, but the protocol cannot guarantee cross-restart/event-ID deduplication. Text submitted through the input box and local memory commands follow the same persistence path. Do not persist partial ASR hypotheses, audio frames, or generated audio.

Long-term memories are distinct records with an ID, normalized text, creation/update timestamps, and a local embedding. Store embeddings locally and compute them with a small bundled or locally cached ONNX embedding model; never call a remote embedding service. Retrieval uses cosine similarity and a conservative threshold, returning at most five concise entries or 1,500 total characters. The database remains authoritative; the vector index can be rebuilt from stored memory text.

Register narrow Codex tools for `list_memories`, `search_memories`, `search_chat_history`, and `forget_memory`. Validate schemas and bounds in the main process. Codex receives instructions to search local memory when a request depends on saved preferences or asks about prior conversations; it should not search unrelated private history. `forget_memory` requires an exact or unambiguous matching memory and otherwise asks the user to clarify. History search returns bounded excerpts with timestamps and thread/workspace labels, not full raw rows.

An explicit “记住……” intent is detected from the user's final transcript by Jarvis and persisted locally. Do not treat a Codex-generated tool argument as proof that the user requested memory. This gate applies to both typed input and finalized Codex Voice transcript events. Memory search tools are available to both text turns and realtime Voice through the existing app-server tool-call path. Retrieved data is supplemental, may be outdated, and never overrides the user's current request.

## Data Flow

```text
final user transcript ─┬─> explicit remember intent ─> local memory record + embedding
                       └─> pending conversation turn
Codex memory/history tool call ─────────────────────────────> bounded local search result
Codex completed reply ─────────────────────────────────────> local conversation archive
search/forget requests ─────────────────────────────────────> typed local store tools
```

## Privacy and Retention

- All archive text, memories, and embeddings stay in the current Windows user's application data directory.
- No audio is recorded or persisted.
- No chat text or memory is sent to an embedding provider or a separate cloud memory service. Relevant memory text is sent to Codex only as part of the user's active Codex conversation context.
- Provide a clear-all action for archive and memory data. Clearing the archive must not delete Codex's own threads; clearing Jarvis memory must not delete archived turns unless the user selects both.
- File deletion and database migrations must be atomic where practical. A failed write must be reported and must not claim that a memory was saved.

## Error Handling and Limits

- Bound user/assistant text size, search result count, and memory context size.
- Handle duplicate final transcript events idempotently so one utterance is not archived twice.
- Store a user turn even if Codex fails; leave its assistant response empty and mark the turn incomplete so the failure does not erase what the user said.
- If embedding generation fails, preserve the memory text and allow exact/keyword search; report that semantic retrieval is temporarily unavailable.
- Bundle a pinned local quantized ONNX model and tokenizer in the Windows installer. Development setup may download it only through the explicit model setup command, with SHA-256 verification; the running app does not download model files.
- Keep archive access and deletion local. Codex tools must never accept arbitrary SQL, file paths, or code from model arguments.

## Testing and Acceptance

- Unit tests cover schema migrations, atomic turn persistence, duplicate transcript handling, workspace/thread metadata, archive search, clear behavior, and independent deletion of archive versus memory.
- Memory tests cover explicit-instruction gating, exact listing/search/deletion, semantic ranking and thresholding, maximum returned results, and embedding failure fallback.
- Codex runtime tests verify that only bounded retrieved memory is returned by the local tools for text and realtime turns, and that no audio payload or complete archive is exposed.
- Acceptance: conduct a Codex Voice conversation, restart Jarvis, search and find its text transcript, explicitly store a preference, start a different thread, and verify that a relevant future Codex turn receives that preference while unrelated turns do not.

## Constraints

- Preserve existing Codex thread resume/new-thread behavior and approval flow.
- Preserve the existing Codex, Doubao, and local voice-provider selection.
- Store no raw or derived microphone audio.
- Do not auto-extract or auto-save memories from ordinary conversation.
- Keep the work local; do not push changes to a remote repository.
