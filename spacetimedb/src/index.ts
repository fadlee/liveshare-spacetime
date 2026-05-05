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
  | { tag: 'Insert'; value: { position: bigint; text: string } }
  | { tag: 'Delete'; value: { position: bigint; length: bigint } }
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
  if (position > BigInt(text.length)) {
    throw new SenderError('Operation position is invalid');
  }
}

function applyOperation(text: string, operation: TextOperationValue) {
  if (operation.tag === 'Insert' || operation.tag === 'insert') {
    validatePosition(operation.value.position, text);
    const position = Number(operation.value.position);
    return `${text.slice(0, position)}${operation.value.text}${text.slice(position)}`;
  }

  validatePosition(operation.value.position, text);
  const end = operation.value.position + operation.value.length;
  if (end > BigInt(text.length)) {
    throw new SenderError('Delete range is invalid');
  }

  const startIndex = Number(operation.value.position);
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
