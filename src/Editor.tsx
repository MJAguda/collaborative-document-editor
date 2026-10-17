import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { Editor as TiptapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { api, ApiError } from './api.ts';
import type { Doc } from './api.ts';
import { SharePanel } from './SharePanel.tsx';

type Presence = { viewers: { id: number; name: string }[]; version: number; updatedBy: string };

// Heartbeat interval; ?presenceMs= lets the e2e test poll faster (never below 0.5 s).
const PRESENCE_MS = Math.max(500, Number(new URLSearchParams(location.search).get('presenceMs')) || 10_000);

type Status = 'Saved' | 'Unsaved changes' | 'Saving…' | 'Error saving';

const TOOLS: { label: string; text: string; mark: [string, Record<string, unknown>?]; run: (e: TiptapEditor) => boolean }[] = [
  { label: 'Bold', text: 'B', mark: ['bold'], run: (e) => e.chain().focus().toggleBold().run() },
  { label: 'Italic', text: 'I', mark: ['italic'], run: (e) => e.chain().focus().toggleItalic().run() },
  { label: 'Underline', text: 'U', mark: ['underline'], run: (e) => e.chain().focus().toggleUnderline().run() },
  { label: 'Heading 1', text: 'H1', mark: ['heading', { level: 1 }], run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: 'Heading 2', text: 'H2', mark: ['heading', { level: 2 }], run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: 'Heading 3', text: 'H3', mark: ['heading', { level: 3 }], run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: 'Bulleted list', text: '• List', mark: ['bulletList'], run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: 'Numbered list', text: '1. List', mark: ['orderedList'], run: (e) => e.chain().focus().toggleOrderedList().run() },
];

export function Editor({ id }: { id: number }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Doc>(`/documents/${id}`).then(setDoc, (e: Error) => setError(e.message));
  }, [id]);
  if (error) return <p role="alert">{error}</p>;
  if (!doc) return <p>Loading…</p>;
  return <DocEditor doc={doc} />;
}

function DocEditor({ doc }: { doc: Doc }) {
  const [title, setTitle] = useState(doc.title);
  const [status, setStatus] = useState<Status>('Saved');
  const [message, setMessage] = useState('');
  const [conflictBy, setConflictBy] = useState('');
  const savedTitle = useRef(doc.title);
  const version = useRef(doc.version);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saving = useRef(false);
  const [viewers, setViewers] = useState<Presence['viewers']>([]);
  const [changedBy, setChangedBy] = useState('');

  // Heartbeat: tell the server I am here, learn who else is and whether someone saved a newer version.
  useEffect(() => {
    const beat = () =>
      api<Presence>(`/documents/${doc.id}/presence`, { method: 'POST' }).then((p) => {
        setViewers(p.viewers);
        if (!saving.current && p.version > version.current) setChangedBy(p.updatedBy);
      }, () => {}); // best effort: a missed beat just means a stale chip for a few seconds
    const leave = () => void fetch(`/api/documents/${doc.id}/presence`, { method: 'DELETE', keepalive: true }).catch(() => {});
    beat();
    const t = setInterval(beat, PRESENCE_MS);
    addEventListener('pagehide', leave);
    return () => {
      clearInterval(t);
      removeEventListener('pagehide', leave);
      leave();
    };
  }, [doc.id]);

  async function save(ed: TiptapEditor) {
    if (saving.current) {
      timer.current = setTimeout(() => save(ed), 300);
      return;
    }
    saving.current = true;
    setStatus('Saving…');
    try {
      const saved = await api<Doc>(`/documents/${doc.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: ed.getHTML(), version: version.current }),
      });
      version.current = saved.version;
      setMessage('');
      setStatus((s) => (s === 'Saving…' ? 'Saved' : s));
    } catch (e) {
      setStatus('Error saving');
      if (e instanceof ApiError && e.status === 409) {
        clearTimeout(timer.current);
        ed.setEditable(false, false); // false: no update event, so no new save is scheduled
        setConflictBy(String(e.body.updatedBy ?? 'another user'));
      } else {
        setMessage((e as Error).message);
      }
    } finally {
      saving.current = false;
    }
  }

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } })],
    content: doc.content,
    onUpdate: ({ editor: ed }) => {
      setStatus('Unsaved changes');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => save(ed), 1000);
    },
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  const active = useEditorState({
    editor,
    selector: ({ editor: ed }) => TOOLS.map((t) => ed?.isActive(...t.mark) ?? false),
  });

  async function rename() {
    if (title === savedTitle.current) return;
    try {
      const saved = await api<Doc>(`/documents/${doc.id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
      savedTitle.current = saved.title;
      setTitle(saved.title);
      setMessage('');
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  async function remove() {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    try {
      await api(`/documents/${doc.id}`, { method: 'DELETE' });
      location.hash = '#/';
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  return (
    <article className="editor">
      <div className="doc-header">
        {doc.isOwner ? (
          <input
            aria-label="Title"
            className="title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        ) : (
          <h1 className="title">{doc.title}</h1>
        )}
        <span className="badge">{doc.isOwner ? 'Owned by you' : `Shared by ${doc.owner.name}`}</span>
        {viewers.map((v) => (
          <span key={v.id} className="badge viewer">
            {v.name} is viewing
          </span>
        ))}
        <span role="status" className="status">
          {status}
        </span>
        {doc.isOwner && (
          <button type="button" className="danger" onClick={remove}>
            Delete
          </button>
        )}
      </div>
      {message && <p role="alert">{message}</p>}
      {conflictBy && (
        <div role="alert" className="banner">
          This document was changed by {conflictBy}. Reload to get the latest version.{' '}
          <button type="button" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      )}
      {changedBy && !conflictBy && (
        <div aria-live="polite" className="banner">
          {changedBy} saved changes.{' '}
          <button type="button" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      )}
      <div className="toolbar" role="toolbar" aria-label="Formatting">
        {TOOLS.map((t, i) => (
          <button
            key={t.label}
            type="button"
            aria-label={t.label}
            aria-pressed={active?.[i] ?? false}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor && t.run(editor)}
          >
            {t.text}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} className="content" />
      {doc.isOwner && <SharePanel docId={doc.id} initial={doc.shares} />}
    </article>
  );
}
