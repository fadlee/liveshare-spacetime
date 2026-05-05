import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { reducers, tables } from './module_bindings';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';

const SAVE_DELAY_MS = 400;
const SPACE_ID_LENGTH = 12;
const SPACE_ID_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';

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

function App() {
  const { identity, isActive: connected } = useSpacetimeDB();
  const createSpace = useReducer(reducers.createSpace);
  const updateSpaceText = useReducer(reducers.updateSpaceText);
  const [spaceId, setSpaceId] = useState(() => getSpaceIdFromPath());
  const [localText, setLocalText] = useState('');
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [createdSpaceId, setCreatedSpaceId] = useState<string | null>(null);
  const [pendingCreateSpaceId, setPendingCreateSpaceId] = useState<
    string | null
  >(null);
  const lastServerText = useRef('');
  const hasRequestedCreate = useRef<string | null>(null);

  const spaceQuery = useMemo(() => {
    return spaceId
      ? tables.space.where(row => row.id.eq(spaceId))
      : tables.space.where(row => row.id.eq('__unused__'));
  }, [spaceId]);

  const [spaces, spacesLoading] = useTable(spaceQuery);
  const space = spaceId ? spaces.find(row => row.id === spaceId) : undefined;
  const canEdit = Boolean(space || (spaceId && createdSpaceId === spaceId));

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
    if (createdSpaceId === spaceId) setPendingCreateSpaceId(spaceId);
    createSpace({ id: spaceId })
      .then(() => setPendingCreateSpaceId(null))
      .catch(error => {
        console.error('Failed to create space:', error);
        hasRequestedCreate.current = null;
        setPendingCreateSpaceId(null);
        setSaveStatus('error');
      });
  }, [
    connected,
    createSpace,
    createdSpaceId,
    identity,
    space,
    spaceId,
    spacesLoading,
  ]);

  useEffect(() => {
    if (!connected || !spaceId || !canEdit) return;
    if (pendingCreateSpaceId === spaceId) return;
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
  }, [
    canEdit,
    connected,
    localText,
    pendingCreateSpaceId,
    spaceId,
    updateSpaceText,
  ]);

  const createNewSpace = () => {
    const id = generateSpaceId();
    window.history.pushState(null, '', `/${id}`);
    setCreatedSpaceId(id);
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
          <span className={`save-status ${saveStatus}`}>
            {saveStatus === 'idle' ? 'Ready' : saveStatus}
          </span>
          <button onClick={copyShareUrl}>Copy Link</button>
        </div>
      </header>

      {!canEdit && <p className="loading-note">Creating shared space...</p>}

      <textarea
        className="shared-editor"
        aria-label="shared text editor"
        value={localText}
        onChange={event => setLocalText(event.target.value)}
        placeholder="Start typing here. Everyone with this link can edit."
        disabled={!canEdit}
      />
    </main>
  );
}

export default App;
