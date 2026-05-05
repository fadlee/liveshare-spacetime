# Realtime Text Operations Design

## Goal

Make LiveShare feel realtime on every keystroke and prevent typed text from disappearing when subscription updates arrive out of order.

The current app saves the whole textarea after a debounce and treats the latest committed document as the source of truth. That design is simple, but it can overwrite local typing with older server text and loses concurrent edits. This upgrade moves synchronization to small text operations with revision tracking.

## Scope

This design keeps the product surface small: one public-by-link shared textarea per space.

In scope:

- Send text edits as insert/delete operations instead of whole-document replacements.
- Apply operations optimistically so local typing never waits for the server.
- Track document revisions to detect stale operations.
- Queue pending operations client-side and replay them after revision conflicts.
- Auto-create a missing space when the first operation arrives.

Out of scope:

- Collaborative cursors or user presence.
- Rich text formatting.
- Full CRDT or operational-transform framework.
- Edit history UI.
- Offline editing across page reloads.

## Backend Design

The `space` table remains the canonical current document state, with one new revision column:

- `id: string` primary key.
- `text: string` current shared document content.
- `revision: u64` current document revision.
- `createdAt: timestamp` creation time.
- `updatedAt: timestamp` last update time.
- `updatedBy: identity` last editor identity.

Revision starts at `0n` for a new space and increments by `1n` after each accepted text operation.

The primary reducer becomes `apply_text_operation({ id, baseRevision, operation })`.

`operation` is a tagged union:

- `insert`: `{ position: u64, text: string }`
- `delete`: `{ position: u64, length: u64 }`

Positions and lengths use UTF-16 string indexes, matching browser `textarea.selectionStart`, `selectionEnd`, and JavaScript string slicing. This keeps client operation generation simple. Emoji and complex grapheme clusters may span multiple UTF-16 units, which is acceptable for this MVP.

Reducer behavior:

- Validate the space ID format and maximum length.
- Create the space with empty text and revision `0n` if it does not exist.
- Reject the operation with `SenderError('Revision conflict')` if `baseRevision` does not equal the current revision.
- Validate operation positions and lengths against the current text.
- Validate that the resulting text does not exceed the existing maximum text length.
- Apply the operation with JavaScript string slicing.
- Update `text`, increment `revision`, and update metadata.

`create_space` remains as an idempotent convenience reducer for opening unknown URLs. `update_space_text` remains available as a compatibility reducer and must increment revision when replacing the whole document. The React client stops using `update_space_text` for typing and uses only `apply_text_operation` for textarea edits.

## Client Design

The textarea remains the main UI. The synchronization model changes from debounced whole-document save to optimistic operation queue.

Client state:

- `localText`: text currently shown in the textarea.
- `serverText`: latest subscribed server text.
- `knownRevision`: latest revision the client has incorporated as its baseline.
- `pendingOps`: local operations that are reflected in `localText` but not yet fully acknowledged.
- `sendInFlight`: whether one operation is currently being sent.

On textarea change:

- Compare the previous `localText` and the new textarea value.
- Compute the shortest changed range using common prefix and common suffix.
- Generate operations from that diff:
  - pure insert: one `insert` operation.
  - pure delete: one `delete` operation.
  - replacement or paste-over-selection: one `delete` followed by one `insert`.
- Update `localText` immediately.
- Append operations to `pendingOps`.
- Start sending pending operations immediately, one at a time.

Sending operations:

- Send the first pending operation with the current `knownRevision`.
- Do not send multiple operations concurrently from the same client.
- On success, remove the operation from the pending queue and advance the local base revision by one.
- Continue with the next pending operation immediately.

Subscription handling:

- If there are no pending operations, accept subscribed `space.text` and `space.revision` as the local baseline.
- If there are pending operations, do not overwrite `localText` with subscribed text. Store the subscription as the latest server baseline and let acknowledgements or conflict handling reconcile it.
- Ignore subscribed revisions older than the current baseline.

Conflict handling:

- If `applyTextOperation` fails with `Revision conflict`, use the latest subscribed server text and revision as the baseline.
- Replay all pending operations locally on top of that server text.
- Reset `localText` to the replayed result.
- Retry sending the pending queue from the new baseline revision.
- If no newer subscription has arrived yet, keep the local text visible and wait for the next subscription before retrying.

Other errors:

- Non-conflict reducer errors set the status to `error` and keep the local text visible.
- Connection loss keeps local text visible but stops sending until connected again.

## Realtime Semantics

This is not a full Google Docs implementation, but it is a meaningful step toward that feel.

The user who is typing gets immediate local feedback on every keystroke. Remote users receive small operations through server-updated table rows as soon as reducers commit. Revision conflicts no longer roll the textarea backward; the client keeps pending local edits and replays them on top of the latest server document.

Concurrent edits in different positions should usually merge cleanly after replay. Concurrent edits in the same position are resolved by server operation order and client replay order. This is acceptable for the current app because the goal is realtime-feeling shared text without introducing a full CRDT stack yet.

## UI Status

Replace the current debounced `saving/saved` mental model with sync-oriented status:

- `live`: connected and no pending operations.
- `syncing`: connected with pending operations or an operation in flight.
- `offline`: not connected.
- `error`: last non-conflict operation failed.

The textarea should remain enabled whenever a space ID exists and the app has an identity. Missing space creation is handled by reducers, so the UI should not need to disable editing while waiting for a space row to appear.

## Testing

Backend tests should cover:

- First operation auto-creates a missing space.
- Insert applies at the requested UTF-16 position and increments revision.
- Delete applies at the requested UTF-16 position and increments revision.
- Invalid insert positions are rejected.
- Invalid delete ranges are rejected.
- Oversized resulting text is rejected.
- Stale `baseRevision` is rejected with `Revision conflict`.

Client tests should cover:

- Typing one character generates an `insert` operation.
- Backspace/delete generates a `delete` operation.
- Replacing selected text generates `delete` then `insert`.
- The client does not overwrite local text with a subscription update while pending operations exist.
- A successful operation acknowledgement drains the pending queue and returns status to `live`.
- A revision conflict replays pending operations on top of newer server text and retries.

## Rollout

Implementation should proceed in this order:

1. Add backend revision and operation reducer.
2. Regenerate TypeScript bindings.
3. Replace client whole-document save logic with operation queue logic.
4. Update integration tests for operation semantics.
5. Run frontend tests, production build, and SpacetimeDB TypeScript typecheck.
6. Publish the updated SpacetimeDB module.
7. Commit and push the verified app changes.
