# Live Share Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the starter chat app with a public-by-link collaborative shared textarea where users create random spaces and edit text together at `/:spaceId`.

**Architecture:** Use one public SpacetimeDB `space` table as the persisted document source of truth. React derives landing/editor pages from `window.location.pathname`, subscribes only to the current space row, creates missing spaces on demand, and debounces whole-document updates through reducers.

**Tech Stack:** React 18, Vite, Vitest, Testing Library, SpacetimeDB TypeScript SDK 2.2.0, generated module bindings.

---

## File Structure

- Modify `spacetimedb/src/index.ts`: replace chat tables/reducers with the `space` table and `create_space` / `update_space_text` reducers.
- Modify `src/App.tsx`: replace chat UI with landing/editor page logic, random space creation, subscription handling, and debounced textarea saving.
- Modify `src/App.css`: replace chat layout styles with focused landing/editor styles.
- Modify `src/App.integration.test.tsx`: replace real DB integration test with component-level tests using mocked SpacetimeDB React hooks and generated binding references.
- Modify generated files under `src/module_bindings/`: regenerate after backend schema changes only; do not manually edit generated files.
- Modify `.gitignore`: add `.superpowers/` so visual companion artifacts are not committed.
- Optional docs update `README.md`: update quickstart wording if there is time after the MVP passes verification.

## Task 1: Backend Shared Space Schema

**Files:**
- Modify: `spacetimedb/src/index.ts`

- [ ] **Step 1: Replace chat schema with space schema**

Edit `spacetimedb/src/index.ts` to this complete content:

```typescript
import { schema, t, table, SenderError } from 'spacetimedb/server';

const MAX_SPACE_ID_LENGTH = 48;
const MAX_TEXT_LENGTH = 100_000;
const SPACE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const space = table(
  { name: 'space', public: true },
  {
    id: t.string().primaryKey(),
    text: t.string(),
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
    throw new SenderError('Space ID may only contain letters, numbers, hyphens, and underscores');
  }
}

function validateText(text: string) {
  if (text.length > MAX_TEXT_LENGTH) {
    throw new SenderError('Text is too long');
  }
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

    const existing = ctx.db.space.id.find(id);
    if (!existing) throw new SenderError('Space not found');

    ctx.db.space.id.update({
      ...existing,
      text,
      updatedAt: ctx.timestamp,
      updatedBy: ctx.sender,
    });
  }
);

export const init = spacetimedb.init(_ctx => {});
```

- [ ] **Step 2: Build the SpacetimeDB module**

Run: `npx tsc --noEmit -p spacetimedb/tsconfig.json`

Expected: command exits successfully with no TypeScript errors.

- [ ] **Step 3: Regenerate TypeScript bindings**

Run: `bun run spacetime:generate`

Expected: generated bindings in `src/module_bindings` contain `space`, `createSpace`, and `updateSpaceText`, and no longer contain chat reducers/tables.

If the command fails because `spacetime` is unavailable, run: `bun run generate`

Expected fallback: generated bindings still update to the new schema.

Do not manually edit generated binding files.

## Task 2: Client Shared Space UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Replace `src/App.tsx` with landing/editor implementation**

Use this complete content, adjusting generated binding names only if the regenerated files expose different accessor casing:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { reducers, tables } from './module_bindings';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';

const SAVE_DELAY_MS = 400;
const SPACE_ID_LENGTH = 12;
const SPACE_ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';

function generateSpaceId() {
  const bytes = new Uint8Array(SPACE_ID_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => SPACE_ID_CHARS[byte % SPACE_ID_CHARS.length]).join('');
}

function getSpaceIdFromPath() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  return path || null;
}

function App() {
  const { identity, isActive: connected } = useSpacetimeDB();
  const createSpace = useReducer(reducers.createSpace);
  const updateSpaceText = useReducer(reducers.updateSpaceText);
  const [spaceId, setSpaceId] = useState(() => getSpaceIdFromPath());
  const [localText, setLocalText] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const lastServerText = useRef('');
  const hasRequestedCreate = useRef<string | null>(null);

  const spaceQuery = useMemo(() => {
    return spaceId ? tables.space.where(row => row.id.eq(spaceId)) : tables.space.where(row => row.id.eq('__unused__'));
  }, [spaceId]);

  const [spaces, spacesLoading] = useTable(spaceQuery);
  const space = spaceId ? spaces.find(row => row.id === spaceId) : undefined;

  useEffect(() => {
    const onPopState = () => setSpaceId(getSpaceIdFromPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!space) return;
    if (space.text === lastServerText.current) return;
    lastServerText.current = space.text;
    setLocalText(space.text);
    setSaveStatus('saved');
  }, [space]);

  useEffect(() => {
    if (!connected || !identity || !spaceId || spacesLoading || space) return;
    if (hasRequestedCreate.current === spaceId) return;

    hasRequestedCreate.current = spaceId;
    createSpace({ id: spaceId }).catch(error => {
      console.error('Failed to create space:', error);
      hasRequestedCreate.current = null;
      setSaveStatus('error');
    });
  }, [connected, createSpace, identity, space, spaceId, spacesLoading]);

  useEffect(() => {
    if (!connected || !spaceId || !space) return;
    if (localText === lastServerText.current) return;

    setSaveStatus('saving');
    const timeout = window.setTimeout(() => {
      updateSpaceText({ id: spaceId, text: localText })
        .then(() => setSaveStatus('saved'))
        .catch(error => {
          console.error('Failed to save text:', error);
          setSaveStatus('error');
        });
    }, SAVE_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [connected, localText, space, spaceId, updateSpaceText]);

  const createNewSpace = () => {
    const id = generateSpaceId();
    window.history.pushState(null, '', `/${id}`);
    setSpaceId(id);
  };

  const copyShareUrl = async () => {
    await navigator.clipboard.writeText(window.location.href);
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
            Create a public text space, send the link, and everyone on the URL sees the same live document.
          </p>
          <button className="primary-action" onClick={createNewSpace}>Create Space</button>
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
          <span className={`save-status ${saveStatus}`}>{saveStatus === 'idle' ? 'Ready' : saveStatus}</span>
          <button onClick={copyShareUrl}>Copy Link</button>
        </div>
      </header>

      {!space && <p className="loading-note">Creating shared space...</p>}

      <textarea
        className="shared-editor"
        aria-label="shared text editor"
        value={localText}
        onChange={event => setLocalText(event.target.value)}
        placeholder="Start typing here. Everyone with this link can edit."
        disabled={!space}
      />
    </main>
  );
}

export default App;
```

- [ ] **Step 2: Replace `src/App.css` with shared text styles**

Use this complete content:

```css
.app-shell {
  min-height: 100vh;
  width: min(1120px, calc(100% - 32px));
  margin: 0 auto;
  padding: 32px 0;
}

.centered,
.landing {
  display: grid;
  place-items: center;
}

.hero-card {
  width: min(720px, 100%);
  padding: 48px;
  border: 1px solid var(--theme-color);
  border-radius: 28px;
  background: color-mix(in srgb, var(--textbox-color) 74%, transparent);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.12);
}

.eyebrow {
  margin: 0 0 8px;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--theme-color);
}

h1 {
  margin: 0;
  font-size: clamp(2rem, 7vw, 4.5rem);
  line-height: 0.95;
}

.subtitle {
  max-width: 56ch;
  margin: 24px 0;
  font-size: 1.1rem;
  line-height: 1.6;
}

button,
.primary-action {
  border: 0;
  border-radius: 999px;
  padding: 0.85rem 1.2rem;
  background: var(--theme-color);
  color: var(--theme-color-contrast);
  font-weight: 700;
  cursor: pointer;
}

button:hover,
.primary-action:hover {
  filter: brightness(1.08);
}

.editor-page {
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: 20px;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--theme-color);
}

.editor-header h1 {
  font-size: clamp(1.8rem, 5vw, 3rem);
  word-break: break-word;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.save-status {
  min-width: 72px;
  text-align: center;
  padding: 0.45rem 0.75rem;
  border-radius: 999px;
  background: var(--textbox-color);
  text-transform: capitalize;
}

.save-status.error {
  background: #7f1d1d;
  color: #fff;
}

.loading-note {
  margin: 0;
  color: var(--theme-color);
}

.shared-editor {
  width: 100%;
  min-height: 65vh;
  padding: 24px;
  border: 1px solid var(--theme-color);
  border-radius: 22px;
  background: var(--textbox-color);
  color: inherit;
  font: 1rem/1.65 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  resize: vertical;
  box-sizing: border-box;
}

.shared-editor:disabled {
  opacity: 0.7;
}

@media (max-width: 720px) {
  .app-shell {
    width: min(100% - 20px, 1120px);
    padding: 16px 0;
  }

  .hero-card {
    padding: 28px;
    border-radius: 20px;
  }

  .editor-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .header-actions {
    justify-content: flex-start;
  }

  .shared-editor {
    min-height: 70vh;
    padding: 16px;
  }
}
```

- [ ] **Step 3: Run TypeScript check**

Run: `bun run build`

Expected: if bindings were regenerated correctly, TypeScript compiles and Vite builds successfully.

If TypeScript reports generated accessor names differ from the plan, inspect `src/module_bindings/index.ts` and update only `src/App.tsx` imports/usages to match the generated names.

## Task 3: Client Tests

**Files:**
- Modify: `src/App.integration.test.tsx`

- [ ] **Step 1: Replace DB integration test with mocked app tests**

Use this complete content, adjusting reducer/table mock keys only if regenerated binding names differ:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const createSpaceMock = vi.fn(() => Promise.resolve());
const updateSpaceTextMock = vi.fn(() => Promise.resolve());
let mockPathname = '/';
let mockSpaces: Array<{ id: string; text: string }> = [];

vi.mock('./module_bindings', () => ({
  reducers: {
    createSpace: 'createSpace',
    updateSpaceText: 'updateSpaceText',
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
    if (reducer === 'updateSpaceText') return updateSpaceTextMock;
    throw new Error(`Unexpected reducer ${reducer}`);
  },
  useTable: () => [mockSpaces, false],
}));

Object.defineProperty(window, 'location', {
  value: {
    get pathname() {
      return mockPathname;
    },
    get href() {
      return `http://localhost:5173${mockPathname}`;
    },
  },
  writable: true,
});

describe('App', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createSpaceMock.mockClear();
    updateSpaceTextMock.mockClear();
    mockPathname = '/';
    mockSpaces = [];
    vi.spyOn(window.history, 'pushState').mockImplementation((_data, _unused, url) => {
      mockPathname = String(url);
    });
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        getRandomValues: (array: Uint8Array) => {
          array.fill(1);
          return array;
        },
      },
      configurable: true,
    });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(() => Promise.resolve()) },
    });
  });

  it('creates a random space from the landing page', async () => {
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /create space/i }));

    expect(window.history.pushState).toHaveBeenCalledWith(null, '', expect.stringMatching(/^\/[A-Za-z0-9_-]{12}$/));
    expect(screen.getByRole('textbox', { name: /shared text editor/i })).toBeDisabled();
  });

  it('creates a missing space when opening a shared URL', async () => {
    mockPathname = '/abc123';

    render(<App />);

    await waitFor(() => expect(createSpaceMock).toHaveBeenCalledWith({ id: 'abc123' }));
  });

  it('saves textarea edits with reducer object syntax', async () => {
    mockPathname = '/abc123';
    mockSpaces = [{ id: 'abc123', text: 'Initial text' }];

    render(<App />);

    const editor = screen.getByRole('textbox', { name: /shared text editor/i });

    await userEvent.clear(editor);
    await userEvent.type(editor, 'Shared update');
    vi.advanceTimersByTime(400);

    await waitFor(() => {
      expect(updateSpaceTextMock).toHaveBeenLastCalledWith({ id: 'abc123', text: 'Shared update' });
    });
  });
});
```

- [ ] **Step 2: Run app tests**

Run: `bun run test`

Expected: all tests pass.

If fake timers conflict with `userEvent`, use `const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });` in each test and call `await user.click/type/clear` instead of `userEvent.click/type/clear`.

## Task 4: Ignore Visual Companion Artifacts

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add `.superpowers/` to `.gitignore`**

Append this line:

```gitignore
.superpowers/
```

- [ ] **Step 2: Verify ignored artifacts are not staged candidates**

Run: `git status --short --ignored`

Expected: `.superpowers/` appears as ignored (`!! .superpowers/`) or does not appear in normal untracked files.

## Task 5: Final Verification

**Files:**
- Review: all modified files

- [ ] **Step 1: Run full build**

Run: `bun run build`

Expected: TypeScript and Vite build pass.

- [ ] **Step 2: Run test suite**

Run: `bun run test`

Expected: all Vitest tests pass.

- [ ] **Step 3: Check working tree**

Run: `git status --short`

Expected: modified source, regenerated bindings, docs, and `.gitignore` only. `.env.local`, `spacetime.local.json`, and `.superpowers/` must not be staged or committed.

- [ ] **Step 4: Optional manual smoke test**

Run local SpacetimeDB and publish the module:

```bash
spacetime start
spacetime publish liveshare-db --clear-database -y --module-path spacetimedb
bun run dev
```

Expected: opening `/`, creating a space, and opening the same `/:spaceId` in another browser tab shows live text updates.

If local publish command syntax differs on this machine, use the project's `spacetime.json` and `AGENTS.md` command guidance instead.

## Self-Review Notes

- Spec coverage: public-by-link spaces, random create flow, `/:spaceId` on-demand creation, whole-document last-write-wins updates, validation, status UI, regenerated bindings, and test replacement are all mapped to tasks.
- Placeholder scan: no deferred implementation placeholders remain; every code-changing task includes concrete code or a concrete generated-file instruction.
- Type consistency: reducer names use SpacetimeDB export names `create_space` / `update_space_text` and client generated accessors `createSpace` / `updateSpaceText`, matching the repository's snake_case-to-camelCase pattern.

## Commit Guidance

Do not commit unless the user explicitly asks. If commits are requested later, use small commits after verification, and never include `.env.local`, `spacetime.local.json`, or `.superpowers/`.
