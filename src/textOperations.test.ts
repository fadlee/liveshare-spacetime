import { describe, expect, it } from 'vitest';
import {
  applyLocalOperations,
  createOperationsFromChange,
  replayOperations,
  type ClientTextOperation,
} from './textOperations';

describe('text operation helpers', () => {
  it('creates an insert operation for one typed character', () => {
    expect(createOperationsFromChange('heo', 'helo')).toEqual([
      { tag: 'Insert', value: { position: 2n, text: 'l' } },
    ]);
  });

  it('creates a delete operation for removed text', () => {
    expect(createOperationsFromChange('helo', 'heo')).toEqual([
      { tag: 'Delete', value: { position: 2n, length: 1n } },
    ]);
  });

  it('creates delete then insert for replacement text', () => {
    expect(createOperationsFromChange('hello world', 'hello there')).toEqual([
      { tag: 'Delete', value: { position: 6n, length: 5n } },
      { tag: 'Insert', value: { position: 6n, text: 'there' } },
    ]);
  });

  it('applies operations using UTF-16 indexes', () => {
    const ops: ClientTextOperation[] = [
      { tag: 'Insert', value: { position: 2n, text: '!' } },
    ];

    expect(applyLocalOperations('😀a', ops)).toBe('😀!a');
  });

  it('replays pending operations on top of newer server text', () => {
    const pending: ClientTextOperation[] = [
      { tag: 'Insert', value: { position: 5n, text: ' local' } },
    ];

    expect(replayOperations('hello remote', pending)).toBe(
      'hello local remote'
    );
  });
});
