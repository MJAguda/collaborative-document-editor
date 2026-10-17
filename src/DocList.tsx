import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { api } from './api.ts';
import type { Doc, DocLists } from './api.ts';

export function DocList() {
  const [lists, setLists] = useState<DocLists | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<DocLists>('/documents').then(setLists, (e: Error) => setError(e.message));
  }, []);

  async function open(request: Promise<Doc>) {
    try {
      location.hash = `#/doc/${(await request).id}`;
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    open(api<Doc>('/documents/import', { method: 'POST', body: form }));
  }

  return (
    <>
      <div className="actions">
        <button type="button" className="primary" onClick={() => open(api<Doc>('/documents', { method: 'POST', body: '{}' }))}>
          New document
        </button>
        <label className="upload">
          Import a file
          <input type="file" accept=".txt,.md,.docx" onChange={upload} />
        </label>
        <span className="hint">Supported: .txt, .md, .docx (max 2 MB). Each file becomes a new document.</span>
      </div>
      {error && <p role="alert">{error}</p>}
      {lists && (
        <>
          <section aria-labelledby="owned-heading">
            <h2 id="owned-heading">My documents</h2>
            {lists.owned.length === 0 ? (
              <p className="hint">No documents yet.</p>
            ) : (
              <ul className="doc-list">
                {lists.owned.map((d) => (
                  <li key={d.id}>
                    <a href={`#/doc/${d.id}`}>{d.title}</a>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="shared-heading">
            <h2 id="shared-heading">Shared with me</h2>
            {lists.shared.length === 0 ? (
              <p className="hint">Nothing shared with you yet.</p>
            ) : (
              <ul className="doc-list">
                {lists.shared.map((d) => (
                  <li key={d.id}>
                    <a href={`#/doc/${d.id}`}>{d.title}</a> <span className="badge">Shared by {d.ownerName}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
