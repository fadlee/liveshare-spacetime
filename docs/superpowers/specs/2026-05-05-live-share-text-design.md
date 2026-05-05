# Live Share Text Design

## Goal

Build a minimal live shared text application on the existing React and SpacetimeDB TypeScript starter project.

Users can open the web app, create a space, share the generated URL, and collaboratively edit one shared text document at that URL.

## Scope

The MVP supports public-by-link spaces. Anyone with `/:spaceId` can view and edit the text in that space.

The MVP uses a simple whole-document update model. Each edit replaces the stored text for the space. If two users edit at the same time, the latest committed update wins.

Out of scope for the MVP:

- Accounts or explicit permissions.
- Passcodes or private spaces.
- Rich text formatting.
- Edit history.
- Conflict-free replicated editing or operational transforms.
- Per-line or per-block synchronization.

## User Flow

1. User opens `/`.
2. User clicks `Create Space`.
3. The client generates a random URL-safe space ID.
4. The app navigates to `/:spaceId`.
5. The space page subscribes to the matching `space` row.
6. If no row exists, the client calls a reducer to create the space.
7. The user edits text in a large textarea.
8. The client saves edits through a debounced reducer call.
9. Other users on the same URL receive the updated text through the SpacetimeDB subscription.

Opening an unknown `/:spaceId` directly is valid and creates that space on demand.

## Backend Design

Replace the starter chat schema with a shared-document schema.

The main table is `space`:

- `id: string` primary key.
- `text: string` current shared document content.
- `createdAt: timestamp` creation time.
- `updatedAt: timestamp` last update time.
- `updatedBy: identity` last editor identity.

Reducers:

- `create_space({ id })`: validates the ID and inserts an empty space if it does not already exist.
- `update_space_text({ id, text })`: validates the ID and text, requires the space to exist, then updates `text`, `updatedAt`, and `updatedBy`.

Validation:

- `spaceId` must be URL-safe and bounded in length.
- `text` must be bounded in length to protect the reducer and subscription payload size.

No reducer returns data to the caller. The client reads state through table subscriptions.

## Client Design

The React app has two page states derived from `window.location.pathname`:

- Landing page at `/`.
- Editor page at `/:spaceId`.

No routing dependency is needed for the MVP.

Landing page:

- Shows the product name and a short explanation.
- Provides a `Create Space` button.
- Generates a random ID with browser APIs and navigates to `/${id}`.

Editor page:

- Subscribes to `tables.space.where(r => r.id.eq(spaceId))`.
- Calls `createSpace({ id: spaceId })` if the subscribed row is missing after connection.
- Shows a large textarea bound to local React state.
- Updates local state immediately on input.
- Debounces `updateSpaceText({ id: spaceId, text })` so typing does not call the reducer on every keystroke.
- Shows lightweight connection and save status.
- Provides a copyable share URL.

Generated SpacetimeDB bindings are not edited manually. After backend schema changes, bindings are regenerated with the project script or SpacetimeDB CLI.

## Realtime Semantics

The MVP intentionally uses last-write-wins whole-document updates.

This makes implementation small and clear, but concurrent typing can overwrite another user's recent local changes. That limitation is acceptable for the first version because the user asked for a simple live shared text app, not a production-grade collaborative editor.

The design leaves room for future conflict handling by adding revisions later, but no revision system is included now.

## Error Handling

The client shows:

- Connecting state while SpacetimeDB is unavailable.
- Creating/loading state before the space row is available.
- Saving or saved status during debounced updates.
- Failed-to-save status if a reducer call rejects.

Backend reducers throw `SenderError` for invalid IDs, oversized text, or updates to missing spaces.

## Testing

Backend reducer tests should cover:

- Creating a valid space.
- Reusing an existing space ID without duplicating it.
- Rejecting invalid IDs.
- Updating an existing space.
- Rejecting oversized text.

Client tests should cover:

- Landing page create flow generates a `/:spaceId` navigation.
- Editor page creates a missing space.
- Textarea edits call `updateSpaceText` with object reducer syntax.
- Incoming subscribed text updates render in the textarea.

Existing integration tests for the starter chat should be replaced or removed because the chat feature is no longer part of the app.

## Implementation Notes

- Keep the change minimal and focused on replacing chat with shared text.
- Follow SpacetimeDB TypeScript SDK patterns from `AGENTS.md`.
- Use object syntax for reducer calls.
- Use `ctx.sender` as the authenticated editor identity.
- Use subscriptions as the source of persisted truth, not reducer return values.
