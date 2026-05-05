import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

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
    vi.useRealTimers();
    createSpaceMock.mockClear();
    applyTextOperationMock.mockClear();
    mockPathname = '/';
    mockSpaces = [];
    vi.spyOn(window.history, 'pushState').mockImplementation(
      (_data, _unused, url) => {
        mockPathname = String(url);
      }
    );
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        getRandomValues: (array: Uint8Array) => {
          array.fill(1);
          return array;
        },
      },
      configurable: true,
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => Promise.resolve()) },
      configurable: true,
    });
  });

  it('creates a random space from the landing page', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: /create space/i }));

    expect(window.history.pushState).toHaveBeenCalledWith(
      null,
      '',
      expect.stringMatching(/^\/[A-Za-z0-9_-]{12}$/)
    );
    expect(
      screen.getByRole('textbox', { name: /shared text editor/i })
    ).toBeEnabled();
  });

  it('creates a missing space when opening a shared URL', async () => {
    mockPathname = '/abc123';

    render(<App />);

    await waitFor(() =>
      expect(createSpaceMock).toHaveBeenCalledWith({ id: 'abc123' })
    );
  });

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
        operation: { tag: 'Insert', value: { position: 0n, text: 'A' } },
      });
    });
  });

  it('sends delete operations for removed text', async () => {
    const user = userEvent.setup();
    mockPathname = '/abc123';
    mockSpaces = [{ id: 'abc123', text: 'abc', revision: 3n }];

    render(<App />);
    const editor = screen.getByRole('textbox', {
      name: /shared text editor/i,
    }) as HTMLTextAreaElement;

    await user.click(editor);
    editor.setSelectionRange(3, 3);
    await user.keyboard('{Backspace}');

    await waitFor(() => {
      expect(applyTextOperationMock).toHaveBeenCalledWith({
        id: 'abc123',
        baseRevision: 3n,
        operation: { tag: 'Delete', value: { position: 2n, length: 1n } },
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
    await act(async () => {
      resolveOperation?.();
    });
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
        operation: { tag: 'Insert', value: { position: 5n, text: '!' } },
      });
    });
  });
});
