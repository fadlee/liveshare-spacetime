import { describe, expect, it, vi } from 'vitest';
import * as module from './index';

vi.mock('spacetimedb/server', () => {
  class SenderError extends Error {}

  const t = {
    string: () => ({ primaryKey: () => ({}) }),
    u64: () => ({}),
    timestamp: () => ({}),
    identity: () => ({}),
    object: (_name: string, shape: unknown) => shape,
    enum: (_name: string, shape: unknown) => shape,
  };

  return {
    SenderError,
    t,
    table: (_options: unknown, columns: unknown) => columns,
    schema: () => ({
      reducer: (_params: unknown, fn: unknown) => fn,
      init: (fn: unknown) => fn,
    }),
  };
});

type SpaceRow = {
  id: string;
  text: string;
  revision: bigint;
  createdAt: unknown;
  updatedAt: unknown;
  updatedBy: unknown;
};

function createReducerContext(initialRows: SpaceRow[] = []) {
  const rows = new Map(initialRows.map(row => [row.id, row]));
  const ctx = {
    sender: { toHexString: () => 'sender' },
    timestamp: { microsSinceUnixEpoch: 1n },
    db: {
      space: {
        id: {
          find: (id: string) => rows.get(id),
          update: (row: SpaceRow) => rows.set(row.id, row),
        },
        insert: (row: SpaceRow) => {
          rows.set(row.id, row);
          return row;
        },
      },
    },
  };

  return { ctx, rows };
}

describe('space reducers', () => {
  it('auto-creates a missing space from the first insert operation', () => {
    const { ctx, rows } = createReducerContext();

    module.apply_text_operation(ctx as never, {
      id: 'abc123',
      baseRevision: 0n,
      operation: { tag: 'Insert', value: { position: 0n, text: 'Hi' } },
    });

    expect(rows.get('abc123')).toMatchObject({
      id: 'abc123',
      text: 'Hi',
      revision: 1n,
    });
  });

  it('applies delete operations at UTF-16 positions', () => {
    const { ctx, rows } = createReducerContext([
      {
        id: 'abc123',
        text: '😀!a',
        revision: 4n,
        createdAt: {},
        updatedAt: {},
        updatedBy: {},
      },
    ]);

    module.apply_text_operation(ctx as never, {
      id: 'abc123',
      baseRevision: 4n,
      operation: { tag: 'Delete', value: { position: 2n, length: 1n } },
    });

    expect(rows.get('abc123')).toMatchObject({
      text: '😀a',
      revision: 5n,
    });
  });

  it('rejects stale base revisions', () => {
    const { ctx } = createReducerContext([
      {
        id: 'abc123',
        text: 'hello',
        revision: 2n,
        createdAt: {},
        updatedAt: {},
        updatedBy: {},
      },
    ]);

    expect(() =>
      module.apply_text_operation(ctx as never, {
        id: 'abc123',
        baseRevision: 1n,
        operation: { tag: 'Insert', value: { position: 5n, text: '!' } },
      })
    ).toThrow('Revision conflict');
  });
});
