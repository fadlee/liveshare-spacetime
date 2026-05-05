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

    if (
      waitingForConflictBaseline.current &&
      space.revision > knownRevision.current
    ) {
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
    if (!spaceId || sendInFlight.current || waitingForConflictBaseline.current) {
      return;
    }
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
