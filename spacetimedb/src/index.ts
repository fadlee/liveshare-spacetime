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
