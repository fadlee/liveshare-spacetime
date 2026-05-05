# Realtime Text Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace debounced whole-document saves with optimistic per-edit text operations so typing feels realtime and local text is not overwritten by stale subscriptions.

**Architecture:** SpacetimeDB stores the canonical current document plus a monotonic revision. The React client derives UTF-16 insert/delete operations from textarea changes, queues them locally, sends one operation at a time, and replays pending operations after revision conflicts.

**Tech Stack:** React 18, Vitest, Testing Library, SpacetimeDB TypeScript SDK 2.2, Bun, TypeScript.

---

## File Structure

- Modify `spacetimedb/src/index.ts`: add `revision`, define operation payload types, add `apply_text_operation`, and keep compatibility reducers.
- Regenerate `src/module_bindings/*`: generated SpacetimeDB reducer/table bindings after backend schema changes. Do not edit generated files manually.
- Create `src/textOperations.ts`: pure UTF-16 diff/apply/replay helpers used by React and unit tests.
- Create `src/textOperations.test.ts`: fast unit tests for operation generation and replay.
- Modify `src/App.tsx`: replace debounce/save logic with operation queue, revision tracking, subscription reconciliation, and sync statuses.
- Modify `src/App.integration.test.tsx`: replace old whole-document save expectations with operation reducer expectations and subscription/conflict behavior.
- Optional docs update `README.md`: only if reducer names or realtime semantics in README become inaccurate after implementation.

---

### Task 1: Backend Revision And Operation Reducer

**Files:**
- Modify: `spacetimedb/src/index.ts`

- [ ] **Step 1: Add backend revision and operation code**

Replace `spacetimedb/src/index.ts` with this complete implementation:

```ts
import { schema, t, table, SenderError } from 'spacetimedb/server';

const MAX_SPACE_ID_LENGTH = 48;
const MAX_TEXT_LENGTH = 100_000;
const SPACE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const TextInsertOperation = t.object('TextInsertOperation', {
  position: t.u64(),
  text: t.string(),
});

const TextDeleteOperation = t.object('TextDeleteOperation', {
  position: t.u64(),
  length: t.u64(),
});

const TextOperation = t.enum('TextOperation', {
  insert: TextInsertOperation,
  delete: TextDeleteOperation,
});

type TextOperationValue =
  | { tag: 'insert'; value: { position: bigint; text: string } }
  | { tag: 'delete'; value: { position: bigint; length: bigint } };

const space = table(
  { name: 'space', public: true },
  {
    id: t.string().primaryKey(),
    text: t.string(),
    revision: t.u64(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
    updatedBy: t.identity(),
  }
);

const spacetimedb = schema({ space });
export default spacetimedb;

function validateSpaceId(id: string) {
  if (!id) throw new SenderError('Space ID is required');
  if (id.length > MAX_SPACE_ID_LENGTH) {
    throw new SenderError('Space ID is too long');
  }
  if (!SPACE_ID_PATTERN.test(id)) {
    throw new SenderError(
      'Space ID may only contain letters, numbers, hyphens, and underscores'
    );
  }
}

function validateText(text: string) {
  if (text.length > MAX_TEXT_LENGTH) {
    throw new SenderError('Text is too long');
  }
}

function validatePosition(position: bigint, text: string) {
  const max = BigInt(text.length);
  if (position > max) throw new SenderError('Operation position is invalid');
}

function applyOperation(text: string, operation: TextOperationValue): string {
  if (operation.tag === 'insert') {
    const position = operation.value.position;
    validatePosition(position, text);
    const index = Number(position);
    return `${text.slice(0, index)}${operation.value.text}${text.slice(index)}`;
  }

  const position = operation.value.position;
  const length = operation.value.length;
  validatePosition(position, text);
  const end = position + length;
  if (end > BigInt(text.length)) {
    throw new SenderError('Delete range is invalid');
  }

  const startIndex = Number(position);
  const endIndex = Number(end);
  return `${text.slice(0, startIndex)}${text.slice(endIndex)}`;
}

export const create_space = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => {
    validateSpaceId(id);

    const existing = ctx.db.space.id.find(id);
    if (existing) return;

    ctx.db.space.insert({
      id,
      text: '',
      revision: 0n,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
      updatedBy: ctx.sender,
    });
  }
);

export const update_space_text = spacetimedb.reducer(
  { id: t.string(), text: t.string() },
  (ctx, { id, text }) => {
    validateSpaceId(id);
    validateText(text);

    let existing = ctx.db.space.id.find(id);
    if (!existing) {
      existing = ctx.db.space.insert({
        id,
        text: '',
        revision: 0n,
        createdAt: ctx.timestamp,
        updatedAt: ctx.timestamp,
        updatedBy: ctx.sender,
      });
    }

    ctx.db.space.id.update({
      ...existing,
      text,
      revision: existing.revision + 1n,
      updatedAt: ctx.timestamp,
      updatedBy: ctx.sender,
    });
  }
);

export const apply_text_operation = spacetimedb.reducer(
  { id: t.string(), baseRevision: t.u64(), operation: TextOperation },
  (ctx, { id, baseRevision, operation }) => {
    validateSpaceId(id);

    let existing = ctx.db.space.id.find(id);
    if (!existing) {
      existing = ctx.db.space.insert({
        id,
        text: '',
        revision: 0n,
        createdAt: ctx.timestamp,
        updatedAt: ctx.timestamp,
        updatedBy: ctx.sender,
      });
    }
    if (existing.revision !== baseRevision) {
      throw new SenderError('Revision conflict');
    }

    const nextText = applyOperation(existing.text, operation);
    validateText(nextText);

    ctx.db.space.id.update({
      ...existing,
      text: nextText,
      revision: existing.revision + 1n,
      updatedAt: ctx.timestamp,
      updatedBy: ctx.sender,
    });
  }
);

export const init = spacetimedb.init(_ctx => {});
```

- [ ] **Step 2: Typecheck backend and fix SDK type issues**

Run: `bunx tsc --noEmit -p spacetimedb/tsconfig.json`

Expected: PASS.

If TypeScript rejects the generated tagged union shape for `operation`, keep the runtime behavior unchanged and verify the generated binding in `src/module_bindings/apply_text_operation_reducer.ts` after Task 2. The runtime value must remain one of these two shapes:

```ts
type TextOperationValue =
  | { tag: 'insert'; value: { position: bigint; text: string } }
  | { tag: 'delete'; value: { position: bigint; length: bigint } };
```

Then rerun: `bunx tsc --noEmit -p spacetimedb/tsconfig.json`

Expected: PASS.

- [ ] **Step 3: Commit backend reducer change**

Run:

```bash
git add spacetimedb/src/index.ts
git commit -m "Add realtime text operation reducer"
```

Expected: commit succeeds.

---

### Task 2: Regenerate SpacetimeDB Bindings

**Files:**
- Modify generated: `src/module_bindings/*`

- [ ] **Step 1: Regenerate bindings**

Run: `bun run spacetime:generate`

Expected: generated files include an `apply_text_operation` reducer binding and `space` rows include `revision`.

- [ ] **Step 2: Inspect generated reducer names**

Run: `git diff -- src/module_bindings/index.ts src/module_bindings/space_table.ts`

Expected characteristics:

```ts
__reducerSchema("apply_text_operation", ApplyTextOperationReducer)
revision: __t.u64()
```

The exact generated formatting can differ. Do not manually edit generated files.

- [ ] **Step 3: Commit regenerated bindings**

Run:

```bash
git add src/module_bindings
git commit -m "Regenerate realtime operation bindings"
```

Expected: commit succeeds.

---

### Task 3: Pure Text Operation Helpers

**Files:**
- Create: `src/textOperations.ts`
- Create: `src/textOperations.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `src/textOperations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  applyLocalOperations,
  createOperationsFromChange,
  replayOperations,
  type ClientTextOperation,
} from './textOperations';

describe('text operation helpers', () => {
  it('creates an insert operation for one typed character', () => {
    expect(createOperationsFromChange('helo', 'hello')).toEqual([
      { tag: 'insert', value: { position: 2n, text: 'l' } },
    ]);
  });

  it('creates a delete operation for removed text', () => {
    expect(createOperationsFromChange('hello', 'helo')).toEqual([
      { tag: 'delete', value: { position: 2n, length: 1n } },
    ]);
  });

  it('creates delete then insert for replacement text', () => {
    expect(createOperationsFromChange('hello world', 'hello there')).toEqual([
      { tag: 'delete', value: { position: 6n, length: 5n } },
      { tag: 'insert', value: { position: 6n, text: 'there' } },
    ]);
  });

  it('applies operations using UTF-16 indexes', () => {
    const ops: ClientTextOperation[] = [
      { tag: 'insert', value: { position: 2n, text: '!' } },
    ];

    expect(applyLocalOperations('😀a', ops)).toBe('😀!a');
  });

  it('replays pending operations on top of newer server text', () => {
    const pending: ClientTextOperation[] = [
      { tag: 'insert', value: { position: 5n, text: ' local' } },
    ];

    expect(replayOperations('hello remote', pending)).toBe('hello local remote');
  });
});
```

- [ ] **Step 2: Run helper tests to verify failure**

Run: `bunx vitest run src/textOperations.test.ts`

Expected: FAIL because `src/textOperations.ts` does not exist.

- [ ] **Step 3: Implement helper module**

Create `src/textOperations.ts`:

```ts
export type ClientTextOperation =
  | { tag: 'insert'; value: { position: bigint; text: string } }
  | { tag: 'delete'; value: { position: bigint; length: bigint } };

export function createOperationsFromChange(
  previousText: string,
  nextText: string
): ClientTextOperation[] {
  if (previousText === nextText) return [];

  let prefixLength = 0;
  while (
    prefixLength < previousText.length &&
    prefixLength < nextText.length &&
    previousText[prefixLength] === nextText[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < previousText.length - prefixLength &&
    suffixLength < nextText.length - prefixLength &&
    previousText[previousText.length - 1 - suffixLength] ===
      nextText[nextText.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const removedLength = previousText.length - prefixLength - suffixLength;
  const insertedText = nextText.slice(prefixLength, nextText.length - suffixLength);
  const operations: ClientTextOperation[] = [];

  if (removedLength > 0) {
    operations.push({
      tag: 'delete',
      value: { position: BigInt(prefixLength), length: BigInt(removedLength) },
    });
  }

  if (insertedText.length > 0) {
    operations.push({
      tag: 'insert',
      value: { position: BigInt(prefixLength), text: insertedText },
    });
  }

  return operations;
}

export function applyLocalOperation(
  text: string,
  operation: ClientTextOperation
): string {
  if (operation.tag === 'insert') {
    const position = Number(operation.value.position);
    return `${text.slice(0, position)}${operation.value.text}${text.slice(position)}`;
  }

  const position = Number(operation.value.position);
  const end = position + Number(operation.value.length);
  return `${text.slice(0, position)}${text.slice(end)}`;
}

export function applyLocalOperations(
  text: string,
  operations: ClientTextOperation[]
): string {
  return operations.reduce(applyLocalOperation, text);
}

export function replayOperations(
  serverText: string,
  pendingOperations: ClientTextOperation[]
): string {
  return applyLocalOperations(serverText, pendingOperations);
}
```

- [ ] **Step 4: Run helper tests to verify pass**

Run: `bunx vitest run src/textOperations.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit helper module**

Run:

```bash
git add src/textOperations.ts src/textOperations.test.ts
git commit -m "Add text operation helpers"
```

Expected: commit succeeds.

---

### Task 4: Client Operation Queue Tests

**Files:**
- Modify: `src/App.integration.test.tsx`

- [ ] **Step 1: Replace reducer mocks and space shape**

At the top of `src/App.integration.test.tsx`, replace the current mocks with operation-aware mocks:

```ts
const createSpaceMock = vi.fn(() => Promise.resolve());
const applyTextOperationMock = vi.fn(() => Promise.resolve());
let mockPathname = '/';
let mockSpaces: Array<{ id: string; text: string; revision: bigint }> = [];

vi.mock('./module_bindings', () => ({
  reducers: {
    createSpace: 'createSpace',
    applyTextOperation: 'applyTextOperation',
  },
  tables: {
    space: {
      where: vi.fn(() => 'spaceQuery'),
    },
  },
}));

vi.mock('spacetimedb/react', () => ({
  useSpacetimeDB: () => ({
    identity: { toHexString: () => 'abc123' },
    isActive: true,
  }),
  useReducer: (reducer: string) => {
    if (reducer === 'createSpace') return createSpaceMock;
    if (reducer === 'applyTextOperation') return applyTextOperationMock;
    throw new Error(`Unexpected reducer ${reducer}`);
  },
  useTable: () => [mockSpaces, false],
}));
```

In `beforeEach`, clear `applyTextOperationMock` instead of `updateSpaceTextMock`, and remove `resolveCreateSpace` setup because editing no longer waits for create.

- [ ] **Step 2: Replace save tests with operation tests**

Replace the old tests named `allows editing immediately after creating a space`, `saves textarea edits with reducer object syntax`, and `creates the space and retries once when saving finds no space` with these tests:

```ts
it('sends insert operations while typing immediately after creating a space', async () => {
  const user = userEvent.setup();

  render(<App />);

  await user.click(screen.getByRole('button', { name: /create space/i }));
  const editor = screen.getByRole('textbox', { name: /shared text editor/i });

  expect(editor).toBeEnabled();
  await user.type(editor, 'A');

  await waitFor(() => {
    expect(applyTextOperationMock).toHaveBeenCalledWith({
      id: expect.stringMatching(/^[A-Za-z0-9_-]{12}$/),
      baseRevision: 0n,
      operation: { tag: 'insert', value: { position: 0n, text: 'A' } },
    });
  });
});

it('sends delete operations for removed text', async () => {
  const user = userEvent.setup();
  mockPathname = '/abc123';
  mockSpaces = [{ id: 'abc123', text: 'abc', revision: 3n }];

  render(<App />);
  const editor = screen.getByRole('textbox', { name: /shared text editor/i });

  await user.click(editor);
  await user.keyboard('{Backspace}');

  await waitFor(() => {
    expect(applyTextOperationMock).toHaveBeenCalledWith({
      id: 'abc123',
      baseRevision: 3n,
      operation: { tag: 'delete', value: { position: 2n, length: 1n } },
    });
  });
});

it('does not overwrite local text while an operation is pending', async () => {
  const user = userEvent.setup();
  let resolveOperation: (() => void) | null = null;
  applyTextOperationMock.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        resolveOperation = resolve;
      })
  );
  mockPathname = '/abc123';
  mockSpaces = [{ id: 'abc123', text: 'hello', revision: 1n }];

  const { rerender } = render(<App />);
  const editor = screen.getByRole('textbox', { name: /shared text editor/i });

  await user.type(editor, '!');
  expect(editor).toHaveValue('hello!');

  mockSpaces = [{ id: 'abc123', text: 'hello', revision: 1n }];
  rerender(<App />);

  expect(editor).toHaveValue('hello!');
  resolveOperation?.();
});

it('replays pending text after a revision conflict', async () => {
  const user = userEvent.setup();
  applyTextOperationMock
    .mockRejectedValueOnce(new Error('SenderError: Revision conflict'))
    .mockResolvedValueOnce(undefined);
  mockPathname = '/abc123';
  mockSpaces = [{ id: 'abc123', text: 'hello', revision: 1n }];

  const { rerender } = render(<App />);
  const editor = screen.getByRole('textbox', { name: /shared text editor/i });

  await user.type(editor, '!');

  mockSpaces = [{ id: 'abc123', text: 'hello remote', revision: 2n }];
  rerender(<App />);

  await waitFor(() => {
    expect(editor).toHaveValue('hello! remote');
    expect(applyTextOperationMock).toHaveBeenLastCalledWith({
      id: 'abc123',
      baseRevision: 2n,
      operation: { tag: 'insert', value: { position: 5n, text: '!' } },
    });
  });
});
```

Keep the landing-page create test and direct URL create test, updating only the mock names and `mockSpaces` row shape.

- [ ] **Step 3: Run integration tests to verify failure**

Run: `bunx vitest run src/App.integration.test.tsx`

Expected: FAIL because `App.tsx` still calls `updateSpaceText` and has no operation queue.

- [ ] **Step 4: Commit failing tests only if your workflow allows red commits**

Default for this repository: do not commit failing tests. Leave them unstaged until Task 5 passes.

---

### Task 5: Client Operation Queue Implementation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.integration.test.tsx`

- [ ] **Step 1: Replace `App.tsx` sync logic**

Replace `src/App.tsx` with this implementation:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { reducers, tables } from './module_bindings';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import {
  createOperationsFromChange,
  replayOperations,
  type ClientTextOperation,
} from './textOperations';

const SPACE_ID_LENGTH = 12;
const SPACE_ID_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';

type SyncStatus = 'live' | 'syncing' | 'offline' | 'error';

function generateSpaceId() {
  const bytes = new Uint8Array(SPACE_ID_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(
    bytes,
    byte => SPACE_ID_CHARS[byte % SPACE_ID_CHARS.length]
  ).join('');
}

function getSpaceIdFromPath() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  return path || null;
}

function isRevisionConflict(error: unknown) {
  return error instanceof Error && error.message.includes('Revision conflict');
}

function App() {
  const { identity, isActive: connected } = useSpacetimeDB();
  const createSpace = useReducer(reducers.createSpace);
  const applyTextOperation = useReducer(reducers.applyTextOperation);
  const [spaceId, setSpaceId] = useState(() => getSpaceIdFromPath());
  const [localText, setLocalText] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('offline');
  const [queueVersion, setQueueVersion] = useState(0);
  const knownRevision = useRef(0n);
  const latestServerText = useRef('');
  const latestServerRevision = useRef(0n);
  const pendingOps = useRef<ClientTextOperation[]>([]);
  const sendInFlight = useRef(false);
  const waitingForConflictBaseline = useRef(false);
  const hasRequestedCreate = useRef<string | null>(null);

  const spaceQuery = useMemo(() => {
    return spaceId
      ? tables.space.where(row => row.id.eq(spaceId))
      : tables.space.where(row => row.id.eq('__unused__'));
  }, [spaceId]);

  const [spaces, spacesLoading] = useTable(spaceQuery);
  const space = spaceId ? spaces.find(row => row.id === spaceId) : undefined;
  const canEdit = Boolean(spaceId && identity);

  const markQueueChanged = () => setQueueVersion(version => version + 1);

  useEffect(() => {
    const onPopState = () => setSpaceId(getSpaceIdFromPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    pendingOps.current = [];
    sendInFlight.current = false;
    waitingForConflictBaseline.current = false;
    knownRevision.current = 0n;
    latestServerRevision.current = 0n;
    latestServerText.current = '';
    setLocalText('');
    markQueueChanged();
  }, [spaceId]);

  useEffect(() => {
    if (!connected || !identity || !spaceId || spacesLoading || space) return;
    if (hasRequestedCreate.current === spaceId) return;

    hasRequestedCreate.current = spaceId;
    createSpace({ id: spaceId }).catch(error => {
      console.error('Failed to create space:', error);
      hasRequestedCreate.current = null;
      setSyncStatus('error');
    });
  }, [connected, createSpace, identity, space, spaceId, spacesLoading]);

  useEffect(() => {
    if (!space) return;
    if (space.revision < latestServerRevision.current) return;

    latestServerText.current = space.text;
    latestServerRevision.current = space.revision;

    if (pendingOps.current.length === 0 && !sendInFlight.current) {
      knownRevision.current = space.revision;
      setLocalText(space.text);
      setSyncStatus(connected ? 'live' : 'offline');
      return;
    }

    if (waitingForConflictBaseline.current && space.revision > knownRevision.current) {
      knownRevision.current = space.revision;
      waitingForConflictBaseline.current = false;
      setLocalText(replayOperations(space.text, pendingOps.current));
      sendInFlight.current = false;
      markQueueChanged();
    }
  }, [connected, space]);

  useEffect(() => {
    if (!connected) {
      setSyncStatus('offline');
      return;
    }
    if (!spaceId || sendInFlight.current || waitingForConflictBaseline.current) return;
    const operation = pendingOps.current[0];
    if (!operation) {
      setSyncStatus('live');
      return;
    }

    sendInFlight.current = true;
    setSyncStatus('syncing');
    applyTextOperation({
      id: spaceId,
      baseRevision: knownRevision.current,
      operation,
    })
      .then(() => {
        pendingOps.current = pendingOps.current.slice(1);
        knownRevision.current += 1n;
        sendInFlight.current = false;
        markQueueChanged();
      })
      .catch(error => {
        sendInFlight.current = false;
        if (isRevisionConflict(error)) {
          if (latestServerRevision.current > knownRevision.current) {
            knownRevision.current = latestServerRevision.current;
            setLocalText(
              replayOperations(latestServerText.current, pendingOps.current)
            );
            markQueueChanged();
          } else {
            waitingForConflictBaseline.current = true;
            setSyncStatus('syncing');
          }
          return;
        }

        console.error('Failed to apply text operation:', error);
        setSyncStatus('error');
      });
  }, [applyTextOperation, connected, queueVersion, spaceId]);

  const createNewSpace = () => {
    const id = generateSpaceId();
    window.history.pushState(null, '', `/${id}`);
    setSpaceId(id);
  };

  const copyShareUrl = async () => {
    await navigator.clipboard.writeText(window.location.href);
  };

  const handleTextChange = (nextText: string) => {
    const operations = createOperationsFromChange(localText, nextText);
    setLocalText(nextText);
    if (operations.length === 0) return;

    pendingOps.current = [...pendingOps.current, ...operations];
    setSyncStatus(connected ? 'syncing' : 'offline');
    markQueueChanged();
  };

  if (!connected || !identity) {
    return (
      <main className="app-shell centered">
        <p className="eyebrow">LiveShare</p>
        <h1>Connecting...</h1>
      </main>
    );
  }

  if (!spaceId) {
    return (
      <main className="app-shell landing">
        <section className="hero-card">
          <p className="eyebrow">LiveShare</p>
          <h1>Share a URL. Edit text together.</h1>
          <p className="subtitle">
            Create a public text space, send the link, and everyone on the URL
            sees the same live document.
          </p>
          <button className="primary-action" onClick={createNewSpace}>
            Create Space
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell editor-page">
      <header className="editor-header">
        <div>
          <p className="eyebrow">Space</p>
          <h1>{spaceId}</h1>
        </div>
        <div className="header-actions">
          <span className={`save-status ${syncStatus}`}>{syncStatus}</span>
          <button onClick={copyShareUrl}>Copy Link</button>
        </div>
      </header>

      <textarea
        className="shared-editor"
        aria-label="shared text editor"
        value={localText}
        onChange={event => handleTextChange(event.target.value)}
        placeholder="Start typing here. Everyone with this link can edit."
        disabled={!canEdit}
      />
    </main>
  );
}

export default App;
```

- [ ] **Step 2: Run integration tests**

Run: `bunx vitest run src/App.integration.test.tsx src/textOperations.test.ts`

Expected: PASS.

If the delete test sends position `0n` because the caret starts at the beginning in jsdom, update the test to select the end before backspace:

```ts
editor.setSelectionRange(3, 3);
await user.keyboard('{Backspace}');
```

- [ ] **Step 3: Commit client operation queue**

Run:

```bash
git add src/App.tsx src/App.integration.test.tsx src/textOperations.ts src/textOperations.test.ts
git commit -m "Use realtime text operation queue"
```

Expected: commit succeeds.

---

### Task 6: Verification And Publish

**Files:**
- Modify: none expected unless verification exposes failures.

- [ ] **Step 1: Run frontend test suite**

Run: `bun run test`

Expected: PASS.

- [ ] **Step 2: Run production build**

Run: `bun run build`

Expected: PASS and Vite emits `dist/` assets.

- [ ] **Step 3: Run backend typecheck**

Run: `bunx tsc --noEmit -p spacetimedb/tsconfig.json`

Expected: PASS.

- [ ] **Step 4: Publish SpacetimeDB module**

Run: `spacetime publish liveshare-db --module-path spacetimedb`

Expected: publish succeeds without clearing production data.

If SpacetimeDB rejects the schema change because existing production rows do not have `revision`, stop and ask before using any destructive publish. Do not run `--clear-database` without explicit user approval.

- [ ] **Step 5: Check git status**

Run: `git status --short`

Expected: clean working tree except any intentionally ignored build output.

- [ ] **Step 6: Push verified commits**

Run: `git push`

Expected: `main` pushes to `origin/main`, triggering Cloudflare Pages redeploy.

---

### Task 7: Manual Production Smoke Test

**Files:**
- Modify: none unless smoke test exposes a bug.

- [ ] **Step 1: Wait for Cloudflare deployment**

Open the Cloudflare Pages deployment for the latest pushed commit or wait until `https://liveshare.my.id/` serves the new bundle.

- [ ] **Step 2: Test immediate typing**

In a browser, open `https://liveshare.my.id/`, click `Create Space`, and type quickly.

Expected: typed text stays visible and status changes between `syncing` and `live`; no `Space not found` error appears in the console.

- [ ] **Step 3: Test two tabs**

Copy the space URL into a second tab. Type in the first tab, then type in the second tab near a different part of the text.

Expected: both tabs converge to a combined document without either tab losing its local keystrokes.

- [ ] **Step 4: Report result**

Summarize verification commands, publish result, pushed commit range, and production smoke-test outcome to the user.
