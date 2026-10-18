import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from './api.ts';
import type { Comment } from './api.ts';

export function CommentsPanel({ docId }: { docId: number }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');

  const load = () => api<Comment[]>(`/documents/${docId}/comments`).then(setComments, (e: Error) => setError(e.message));
  useEffect(() => void load(), [docId]);

  // Every action reloads the list so it also shows what others added meanwhile.
  async function run(path: string, init: RequestInit) {
    try {
      await api(`/documents/${docId}/comments${path}`, init);
      setError('');
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (await run('', { method: 'POST', body: JSON.stringify({ body }) })) setBody('');
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
              <p className="comment-body">{c.body}</p>
              {c.canModify && (
                <div className="actions">
                  <button type="button" onClick={() => run(`/${c.id}`, { method: 'PATCH', body: JSON.stringify({ resolved: !c.resolved }) })}>
                    {c.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                  <button type="button" className="danger" aria-label="Delete comment" onClick={() => run(`/${c.id}`, { method: 'DELETE' })}>
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
