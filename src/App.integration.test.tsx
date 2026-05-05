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
    vi.useRealTimers();
    createSpaceMock.mockClear();
    updateSpaceTextMock.mockClear();
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

  it('allows editing immediately after creating a space', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: /create space/i }));

    const editor = screen.getByRole('textbox', {
      name: /shared text editor/i,
    });
    expect(editor).toBeEnabled();

    await user.type(editor, 'First draft');

    await waitFor(() => {
      expect(updateSpaceTextMock).toHaveBeenLastCalledWith({
        id: expect.stringMatching(/^[A-Za-z0-9_-]{12}$/),
        text: 'First draft',
      });
    });
  });

  it('creates a missing space when opening a shared URL', async () => {
    mockPathname = '/abc123';

    render(<App />);

    await waitFor(() =>
      expect(createSpaceMock).toHaveBeenCalledWith({ id: 'abc123' })
    );
  });

  it('saves textarea edits with reducer object syntax', async () => {
    const user = userEvent.setup();
    mockPathname = '/abc123';
    mockSpaces = [{ id: 'abc123', text: 'Initial text' }];

    render(<App />);
    const editor = screen.getByRole('textbox', { name: /shared text editor/i });

    await user.clear(editor);
    await user.type(editor, 'Shared update');

    await waitFor(() => {
      expect(updateSpaceTextMock).toHaveBeenLastCalledWith({
        id: 'abc123',
        text: 'Shared update',
      });
    });
  });
});
