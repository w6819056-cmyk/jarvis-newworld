# Codex Local Chat Archive and Semantic Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local text archive and explicit local semantic memory that Codex can search from both text and realtime Voice turns.

**Architecture:** Electron main owns a SQLite database in the app user-data directory. Conversation turns and explicit memory records are separate tables; a local quantized Chinese ONNX embedding model indexes memory records while SQLite FTS provides reliable keyword fallback and archive search. Narrow dynamic Codex tools access bounded search/list/forget operations, and Jarvis persists explicit “remember” requests from finalized user text.

**Tech Stack:** Electron 44, TypeScript, built-in `node:sqlite`, `@huggingface/transformers` ONNX feature extraction, `node:test`/`tsx`, electron-builder extra resources.

## Global Constraints

- Preserve existing Codex thread resume/new-thread behavior and approval flow.
- Preserve the existing Codex, Doubao, and local voice-provider selection.
- Store no raw or derived microphone audio.
- Do not auto-extract or auto-save memories from ordinary conversation.
- All archive text, memories, and embeddings stay in the current Windows user's app-data directory.
- Never send chat text to a remote embedding or memory service; relevant stored text reaches Codex only when returned by a bounded local tool during the active turn.
- Keep work local; do not push changes to a remote repository.

---

## File Structure

- Create `electron/conversation-store.ts`: SQLite migrations, turn persistence, FTS archive search, memory CRUD, conversation deletion, and separate clear operations.
- Create `electron/memory-embeddings.ts`: local ONNX embedder lifecycle, normalized vectors, cosine ranking, threshold, and bounded result construction.
- Create `electron/memory-intents.ts`: deterministic recognition of explicit remember/list/forget/search utterances; no model-generated content can authorize a write.
- Modify `electron/local-tools.ts`: expose bounded memory and archive search tools to Codex and dispatch validated tool calls to the store.
- Modify `electron/main.ts`: initialize the store/embedder, persist finalized text and realtime transcript turns, associate completed replies, handle explicit memory commands, and close SQLite on quit.
- Modify `electron/codex-runtime.ts`: preserve dynamic tool flow and add only the minimal runtime support required to correlate realtime transcript events if the existing generic event forwarding is insufficient.
- Modify `src/windows-main.ts`: render archive/history results and user-facing memory/archive controls through the existing IPC/state conventions.
- Modify `electron/protocol.ts` and `electron/preload.ts`: validate and expose narrowly typed local history/memory UI actions if renderer controls need them.
- Modify `scripts/build-windows.mjs` and `electron-builder.yml`: stage the pinned local embedding model and tokenizer as packaged resources without downloading at runtime.
- Add `tests/windows-conversation-store.test.ts`, `tests/windows-memory-embeddings.test.ts`, `tests/windows-memory-intents.test.ts`, `tests/windows-local-tools.test.ts`, and focused runtime/voice tests.
- Update `docs/WINDOWS.md` with archive location, retention, search, deletion, and model packaging behavior.

## Task 1: Verify Codex Voice transcript events and turn boundaries

**Files:**
- Modify: `src/codex-voice.ts`
- Test: `tests/windows-codex-runtime.test.ts`
- Test: `tests/windows-voice.test.ts`
- Modify: `docs/superpowers/specs/2026-10-20-codex-local-chat-memory-design.md` only if the installed app-server protocol proves materially different

**Interfaces:**
- Consumes: `CodexRuntime.onEvent(listener)` and current realtime forwarding.
- Produces: `extractCodexVoiceTranscript(event): { role: 'user' | 'assistant'; threadId: string; text: string } | undefined` for app-server's finalized `thread/realtime/transcript/done` notification.

- [x] **Step 1: Inspect the installed Codex app-server protocol schema.** Version 0.163 defines `thread/realtime/transcript/done` with required `role`, `text`, and `threadId`; it does not define a stable event/item ID. The existing renderer already consumes this notification, and the Electron main process receives it through `CodexRuntime.onEvent`.
- [x] **Step 2: Add parser tests** in `tests/windows-voice.test.ts` for finalized user/assistant notifications, ignored deltas/audio/invalid roles, and empty text.
- [x] **Step 3: Run `npx tsx --test tests/windows-voice.test.ts`** and confirm the parser assertions fail before implementation.
- [x] **Step 4: Implement the pure final-notification parser** in `src/codex-voice.ts`. Do not attach a second listener to `oai-events`; audio stays within WebRTC and only finalized text is exposed by app-server.
- [x] **Step 5: Run focused tests and verify the installed protocol schema.** Parser tests pass; the final app-server notification is the supported text source. A live microphone exchange remains part of end-to-end acceptance.
- [x] **Step 6: Run `git diff --check`** and document that app-server does not expose stable transcript event IDs; main-process writes use unique local keys and suppress only an identical immediate voice duplicate.

## Task 2: Add the local SQLite archive and explicit memory store

**Files:**
- Create: `electron/conversation-store.ts`
- Test: `tests/windows-conversation-store.test.ts`

**Interfaces:**
- `MemoryRecord = { id: number; text: string; createdAt: number; updatedAt: number; embedding: Float32Array | null; embeddingVersion: string | null }` is the shared store/embedder record type.
- `ConversationStore(path: string)` opens a database and applies idempotent schema migrations.
- `beginTurn(input: { eventKey: string; userText: string; timestamp: number; threadId: string; workspace: string }): { turnId: number; inserted: boolean }` inserts exactly once using the unique event key.
- `completeTurn(turnId: number, assistantText: string, completedAt: number): void` updates the assistant text and completion state.
- `searchHistory(query: string, limit: number): Array<{ userText: string; assistantText: string; timestamp: number; threadId: string; workspace: string }>` returns bounded FTS matches.
- `listMemories(limit: number): MemoryRecord[]`, `findMemories(query: string, limit: number): MemoryRecord[]`, `putMemory(text: string, embedding: Float32Array | null): MemoryRecord`, `deleteMemory(id: number): boolean`, `deleteConversation(threadId: string, workspace: string): boolean`, `clearArchive(): void`, `clearMemories(): void`, and `close(): void` operate only on their named local tables.

- [ ] **Step 1: Write failing migration and persistence tests** for initial schema, repeated open/migration, parameterized Unicode text, metadata, pending turns, completed turns, idempotent event keys, FTS search bounds, single-conversation deletion, and separate archive/memory clearing.
- [ ] **Step 2: Run `npx tsx --test tests/windows-conversation-store.test.ts`** and confirm the tests fail because the store module is absent.
- [ ] **Step 3: Implement schema migrations using `node:sqlite`** with `turns`, `memories`, FTS5 virtual tables, foreign-key constraints, unique event keys, and prepared statements. Keep DB path under Electron `app.getPath('userData')`; never use the repository directory.
- [ ] **Step 4: Implement store methods** with strict text/result limits, transactional inserts/clears, FTS trigger maintenance, and explicit incomplete-turn representation when a response never arrives.
- [x] **Step 5: Run focused tests and TypeScript checks** with `npx tsx --test tests/windows-conversation-store.test.ts` and `npx tsc -p tsconfig.windows.json --noEmit`.

## Task 3: Add local Chinese semantic indexing with keyword fallback

**Files:**
- Create: `electron/memory-embeddings.ts`
- Create: `scripts/download-memory-model.mjs`
- Modify: `scripts/build-windows.mjs`
- Modify: `electron-builder.yml`
- Test: `tests/windows-memory-embeddings.test.ts`

**Interfaces:**
- `MemoryEmbedder(modelDir: string, options?: { pipelineFactory?: Function })` lazily creates a CPU ONNX feature-extraction pipeline from staged local files only.
- `embed(text: string): Promise<Float32Array>` returns a finite, L2-normalized vector.
- `search(query: string, records: MemoryRecord[], limit: number): Promise<MemoryRecord[]>` ranks cosine similarity, applies the configured minimum threshold, and caps output at five records and 1,500 combined characters.
- Store embeddings as versioned float32 blobs; vectors whose model version/dimension differs are re-embedded from authoritative memory text.

- [ ] **Step 1: Write failing tests** for vector normalization, cosine ordering, threshold rejection, result count/character bounds, model-load failure, and version/dimension mismatch.
- [ ] **Step 2: Run `npx tsx --test tests/windows-memory-embeddings.test.ts`** and confirm it fails because the embedder does not exist.
- [ ] **Step 3: Pin `@huggingface/transformers` and a specific Xenova Chinese embedding model revision** in package metadata/script constants. Download only tokenizer/config and one quantized ONNX model into a cache, verify SHA-256 values, and stage them locally for the installer; never fetch model files from the running app.
- [ ] **Step 4: Implement lazy CPU inference** with mean-pooled sentence embeddings and normalized vectors. Keep model loading off the UI thread; fall back to SQLite FTS if loading or inference fails.
- [ ] **Step 5: Package the model under `resources/models/jarvis-memory`** using the build script and `extraResources`, and test resolution in both development and packaged layouts.
- [ ] **Step 6: Run focused tests, `npm run windows:build`, and verify model checksums and package resource paths** before continuing.

## Task 4: Add explicit memory intent handling and bounded Codex tools

**Files:**
- Create: `electron/memory-intents.ts`
- Modify: `electron/local-tools.ts`
- Modify: `electron/main.ts`
- Test: `tests/windows-memory-intents.test.ts`
- Test: `tests/windows-local-tools.test.ts`

**Interfaces:**
- `matchMemoryIntent(text: string): { type: 'remember'; text: string } | { type: 'list' } | { type: 'forget'; query: string } | { type: 'search_history'; query: string } | undefined` only matches explicit user phrasing and rejects blank/overlong memory content.
- Dynamic tools: `jarvis_list_memories({})`, `jarvis_search_memories({ query })`, `jarvis_search_chat_history({ query, limit? })`, and `jarvis_forget_memory({ id })`; all schemas use `additionalProperties: false`.
- `LocalTools` receives typed store/embedder dependencies. Search returns excerpts with timestamps, workspace, and thread ID; no tool accepts SQL, paths, arbitrary code, or raw vectors.
- Memory writes are initiated only by Jarvis's final user transcript or typed submission intent. Model-generated tool arguments can search/list/forget under normal explicit tool policy but cannot create a memory.

- [ ] **Step 1: Write intent tests** for Chinese remember/list/forget/history-search forms, ordinary mentions that must not save, blank phrases, overlong values, and unrelated sentences.
- [ ] **Step 2: Write tool tests** for schema-bounded list/search/history/forget behavior, result character limits, unknown IDs, malformed args, and store/embedder failures.
- [ ] **Step 3: Run focused tests** and confirm intent/tool tests fail before implementation.
- [ ] **Step 4: Implement deterministic memory intent matching**; strip only recognized command prefixes and persist the user's exact remaining text. Do not derive or rewrite a memory from the assistant response.
- [ ] **Step 5: Add dynamic tool specs and main-process dispatch** with strict argument validation. Semantic search uses embeddings when ready and FTS fallback otherwise; forgetting requires a numeric existing ID returned by local listing/search.
- [x] **Step 6: Run focused intent/tool tests and TypeScript checks.**

## Task 5: Persist text and realtime Voice turns safely

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/codex-runtime.ts` only if Task 1 shows event normalization belongs at the runtime boundary
- Modify: `tests/windows-voice.test.ts`
- Modify: `tests/windows-codex-runtime.test.ts`

**Interfaces:**
- A pending-turn coordinator pairs finalized user text and its thread ID with the corresponding completed assistant message and persists them through `ConversationStore`.
- Typed turns use the same coordinator before `turn/start`; Doubao and local ASR final transcript callbacks use the existing `transcript(text, final)` path; Codex Voice uses the finalized data-channel transcript events identified in Task 1.
- Partial transcripts from every provider update the UI only and are never persisted.
- Duplicate final events use a stable event key, and incomplete Codex turns retain user text with an incomplete status.

- [ ] **Step 1: Write tests** for typed turn persistence, final Codex/Doubao/local transcript persistence, ignored partials/audio events, duplicate finals, reply correlation, failed turns, and no double-write when renderer receives the same event.
- [ ] **Step 2: Run focused tests** and verify they fail against the current no-archive flow.
- [ ] **Step 3: Add pending-turn correlation in the Electron main process**. Use final user transcript events as the only voice archive source; never infer the user's exact words from the assistant reply. Store assistant text from completed agent-message events, not partial deltas.
- [ ] **Step 4: Intercept explicit memory intents before `turn/start` for typed input. For realtime Voice, handle finalized transcript events as a side channel after audio reaches Codex; write only the exact final user text following “记住”, and show a clear Jarvis confirmation. Never claim the spoken command was withheld from Codex.**
- [ ] **Step 5: Preserve Codex tool calls for on-demand search** so both text and realtime Voice can request relevant memories and prior chat excerpts. Include only bounded results, clearly labeled as stored context.
- [ ] **Step 6: Run voice/runtime/archive tests and TypeScript checks**; verify stop, pause, provider switching, and new-thread behavior do not erase saved rows.

## Task 6: Add user archive and memory management controls

**Files:**
- Modify: `electron/protocol.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Modify: `src/windows-main.ts`
- Modify: `src/windows.css`
- Test: `tests/windows-protocol.test.ts`
- Test: `tests/windows-local-tools.test.ts`

**Interfaces:**
- Add typed renderer actions to search/list local history, delete one conversation, list memories, delete a memory by ID, and clear archive/memories independently.
- Main process returns bounded, redacted-to-display records; renderer never opens SQLite directly.
- Clear operations require a visible confirmation dialog and identify which local layer will be removed. They never delete Codex threads.

- [ ] **Step 1: Add protocol tests** accepting valid bounded search/delete/clear requests and rejecting oversized queries, invalid IDs, unknown layers, and extra fields.
- [ ] **Step 2: Implement main/preload IPC** following existing trusted-window checks and validate all payloads with `validateAction`.
- [ ] **Step 3: Add compact history and memory views** consistent with the current Jarvis settings/conversation UI, with search, timestamps, workspace/thread labels, per-conversation and per-memory delete, separate clear actions, loading/empty/error states, and confirmation for deletion/clear.
- [ ] **Step 4: Run protocol tests, Windows TypeScript checks, and a desktop screenshot/smoke check** at the existing app viewport. Verify long transcripts wrap and controls do not overlap.

## Task 7: Document privacy behavior, bump version, and package

**Files:**
- Modify: `docs/WINDOWS.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Verify: packaged Windows application and `release/windows`

**Interfaces:**
- Documentation describes the user-data DB path, text-only retention, absence of saved audio, explicit-memory commands, archive/memory deletion boundaries, and local embedding model behavior.
- Increment the Jarvis patch version once after all implementation tasks are complete.

- [ ] **Step 1: Document** how to view/search prior text, say “记住…”, list and forget memories, clear either store, and understand Codex thread versus Jarvis archive behavior.
- [ ] **Step 2: Run the complete checks** with `npm run windows:test`, `npx tsc -p tsconfig.windows.json --noEmit`, and `npm run windows:build`.
- [ ] **Step 3: Increment package and lockfile patch version** after successful implementation verification, then run `npm run windows:dist`.
- [ ] **Step 4: Inspect the packaged app** to confirm SQLite initializes under app user data, model assets resolve locally without network access, and no raw audio files are created.
- [ ] **Step 5: Perform an end-to-end acceptance run**: complete a Codex Voice exchange, restart Jarvis, search and find the text transcript, explicitly save a preference, start a new thread, verify a relevant future turn can retrieve it, and confirm an unrelated query does not receive unrelated memory.
- [ ] **Step 6: Report installer path/version and test results. Keep all changes local; do not push.**

## Handoff Notes

- Do not start implementation until the user selects an execution approach.
- The repository already has extensive unrelated working-tree changes. Stage only files belonging to this feature and never clean or revert other changes.
- Git author identity is not configured. Do not change Git configuration; commits may be unavailable until the user configures it.
- Real Codex Voice transcript event names are an explicit prerequisite in Task 1. If the installed app-server does not provide final transcript text, pause and revise the design before claiming realtime voice archival.
