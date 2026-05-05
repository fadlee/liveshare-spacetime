# LiveShare SpacetimeDB

LiveShare is a minimal collaborative text editor built with React and SpacetimeDB. A user creates a space, shares the generated URL, and everyone who opens that URL can edit the same text document live.

The app is intentionally simple: each space stores one text document, and updates replace the whole document. This is a good MVP for experimenting with SpacetimeDB subscriptions and reducers, but it is not a conflict-free rich text editor.

## Features

- Create a random public text space from `/`.
- Share URLs like `/:spaceId`.
- Open an unknown `/:spaceId` and create it on demand.
- Edit one shared textarea per space.
- Sync text through SpacetimeDB table subscriptions.
- Save edits through debounced reducer calls.
- Copy the current share URL.

## Tech Stack

- React 18
- Vite
- TypeScript
- SpacetimeDB TypeScript SDK 2.2.0
- Vitest and Testing Library
- Bun for scripts and dependency management

## Project Structure

```text
.
├── spacetimedb/
│   └── src/index.ts          # SpacetimeDB schema and reducers
├── src/
│   ├── App.tsx               # Landing page and shared editor UI
│   ├── App.css               # App styles
│   ├── main.tsx              # SpacetimeDB provider setup
│   └── module_bindings/      # Generated SpacetimeDB TypeScript bindings
├── docs/superpowers/         # Design and implementation planning docs
├── spacetime.json            # SpacetimeDB project config
└── spacetime.local.json      # Local DB config, ignored by git
```

## Architecture

SpacetimeDB is the source of truth for shared text. The React client never relies on reducer return values for persisted state. It subscribes to the current space row and renders whatever the subscription provides.

The MVP uses last-write-wins whole-document updates. When a user types, React updates local state immediately and sends `updateSpaceText` after a short debounce. Other clients receive the new text through their subscription.

If two users edit at the same time, the latest reducer update wins. Future versions could add revisions, per-block updates, or CRDT-based editing if stronger concurrent editing semantics are needed.

## SpacetimeDB Schema

The module defines one public table, `space`:

| Field | Type | Purpose |
| --- | --- | --- |
| `id` | `string` primary key | URL-safe space ID |
| `text` | `string` | Current shared document text |
| `createdAt` | `timestamp` | Space creation time |
| `updatedAt` | `timestamp` | Last edit time |
| `updatedBy` | `identity` | Last editor identity |

Reducers:

- `create_space({ id })` creates an empty space if it does not exist.
- `update_space_text({ id, text })` replaces the current text and records the editor identity.

Client reducer calls use generated camelCase accessors:

```ts
createSpace({ id: spaceId });
updateSpaceText({ id: spaceId, text: localText });
```

## Requirements

- Bun
- SpacetimeDB CLI
- A running local SpacetimeDB server or access to SpacetimeDB Maincloud

Check the CLI:

```bash
spacetime --version
```

## Install

```bash
bun install
```

## Local Development

Start SpacetimeDB locally in one terminal:

```bash
spacetime start
```

Publish the module to the local server:

```bash
spacetime publish liveshare-db --clear-database -y --module-path spacetimedb --server local
```

Start the Vite dev server in another terminal:

```bash
bun run dev
```

Open the Vite URL, create a space, then open the same `/:spaceId` in another tab to test live updates.

## Maincloud Development

This repository's `spacetime.json` is configured for `maincloud` and database `liveshare-db`.

Publish to the configured server:

```bash
spacetime publish liveshare-db --clear-database -y --module-path spacetimedb
```

If the frontend should connect to Maincloud instead of local SpacetimeDB, set `VITE_SPACETIMEDB_HOST` in `.env.local`.

Example:

```bash
VITE_SPACETIMEDB_HOST=wss://maincloud.spacetimedb.com
VITE_SPACETIMEDB_DB_NAME=liveshare-db
```

Use the websocket host expected by your SpacetimeDB deployment. The default frontend host is local: `ws://localhost:3000`.

## Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_SPACETIMEDB_HOST` | `ws://localhost:3000` | SpacetimeDB websocket host |
| `VITE_SPACETIMEDB_DB_NAME` | `liveshare-db` | Database name |

Auth tokens are stored in `localStorage` under a key based on host and database name.

## Regenerate Bindings

Regenerate TypeScript bindings after changing `spacetimedb/src/index.ts`:

```bash
bun run spacetime:generate
```

If you need the project fallback script:

```bash
bun run generate
```

Do not edit files in `src/module_bindings/` by hand. They are generated from the SpacetimeDB module.

## Test And Build

Run tests:

```bash
bun run test
```

Build the frontend:

```bash
bun run build
```

Type-check the SpacetimeDB module directly:

```bash
bunx tsc --noEmit -p spacetimedb/tsconfig.json
```

## Troubleshooting

### `External attempt to call nonexistent reducer "create_space" failed`

The frontend is connected to a database whose published module does not include the latest reducer.

Fixes:

- Regenerate bindings after schema changes: `bun run spacetime:generate`.
- Publish the updated module to the same database the frontend uses.
- Confirm `VITE_SPACETIMEDB_DB_NAME` matches the database you published.
- Confirm `VITE_SPACETIMEDB_HOST` points to the intended local or Maincloud server.

### The app connects but no shared text appears

Check that the space row exists or that the client can call `create_space`. Browser console errors from reducer calls usually indicate the database module is stale or the client is pointed at the wrong database.

### `tsc not found` or wrong TypeScript compiler

Use the real TypeScript package. This project uses `typescript`, not the unrelated `tsc` package.

```bash
bun install
bunx tsc --noEmit -p spacetimedb/tsconfig.json
```

## Deployment Notes

For a hosted deployment, deploy the Vite app with environment variables pointing at the same SpacetimeDB server and database where the module was published.

The current module is public-by-link. Anyone with a space URL can view and edit that space.

## Current Limitations

- No permissions, accounts, or passcodes.
- No edit history.
- No rich text formatting.
- Last-write-wins behavior can overwrite concurrent edits.
- Text size is bounded server-side to protect reducer and subscription payloads.

## License

See `LICENSE`.
