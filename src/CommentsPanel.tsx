import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import { api } from './api.ts';
import { findAnchors, removeCommentMark } from './commentMark.ts';
import type { Comment } from './api.ts';

export function CommentsPanel({ docId, editor }: { docId: number; editor: Editor | null }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');

  const load = () => api<Comment[]>(`/documents/${docId}/comments`).then(setComments, (e: Error) => setError(e.message));
  useEffect(() => void load(), [docId]);

  const anchors = useEditorState({ editor, selector: ({ editor: ed }) => (ed ? findAnchors(ed.state.doc) : {}) }) ?? {};

  // Every action reloads the list so it also shows what others added meanwhile.
  async function run(path: string, init: RequestInit) {
    try {
      const result = await api<Comment | undefined>(`/documents/${docId}/comments${path}`, init);
      setError('');
      await load();
      return result ?? true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  // With text selected the comment is anchored: post it, then highlight the selection with the returned id
  // (the editor update triggers the normal autosave). Without a selection it is a document-level comment.
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const { from, to } = editor?.state.selection ?? { from: 0, to: 0 };
    const anchored = !!editor && editor.isEditable && from !== to;
    const created = await run('', { method: 'POST', body: JSON.stringify({ body, anchored }) });
    if (!created) return;
    if (anchored && typeof created === 'object') {
      editor.chain().setTextSelection({ from, to }).setMark('comment', { commentId: String(created.id) }).setTextSelection(to).run();
    }
    setBody('');
  }

  // Resolving or deleting takes the highlight off the text; reopening does not put it back.
  async function change(c: Comment, path: string, init: RequestInit) {
    if (await run(path, init) && editor?.isEditable) removeCommentMark(editor, c.id);
  }

  function show(id: number) {
    const a = anchors[String(id)];
    if (a && editor) editor.chain().focus().setTextSelection({ from: a.from, to: a.to }).scrollIntoView().run();
  }

  return (
    <section aria-labelledby="comments-heading" className="comments">
      <h2 id="comments-heading">Comments</h2>
      <form onSubmit={add}>
        <label>
          Add a comment <textarea value={body} maxLength={2000} rows={2} onChange={(e) => setBody(e.target.value)} />
        </label>
        <button type="submit" className="primary">Comment</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {comments.length === 0 ? (
        <p className="hint">No comments yet.</p>
      ) : (
        <ul>
          {comments.map((c) => (
            <li key={c.id} className={c.resolved ? 'resolved' : undefined}>
              <p className="hint">
                {c.author.name} · {new Date(c.createdAt).toLocaleString()}
                {c.resolved && ' · Resolved'}
              </p>
              {c.anchored && !c.resolved && (
                anchors[String(c.id)] ? (
                  <button type="button" className="quote" onClick={() => show(c.id)}>
                    {anchors[String(c.id)].text}
                  </button>
                ) : (
                  <p className="hint">text removed</p>
                )
              )}
              <p className="comment-body">{c.body}</p>
              {c.canModify && (
                <div className="actions">
                  <button type="button" onClick={() => change(c, `/${c.id}`, { method: 'PATCH', body: JSON.stringify({ resolved: !c.resolved }) })}>
                    {c.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                  <button type="button" className="danger" aria-label="Delete comment" onClick={() => change(c, `/${c.id}`, { method: 'DELETE' })}>
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
