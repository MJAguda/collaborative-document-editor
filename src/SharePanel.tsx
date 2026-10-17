import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from './api.ts';
import type { Share } from './api.ts';

export function SharePanel({ docId, initial }: { docId: number; initial: Share[] }) {
  const [shares, setShares] = useState(initial);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  async function grant(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const share = await api<Share>(`/documents/${docId}/shares`, { method: 'POST', body: JSON.stringify({ email }) });
      setShares([...shares, share]);
      setEmail('');
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function revoke(userId: number) {
    try {
      await api(`/documents/${docId}/shares/${userId}`, { method: 'DELETE' });
      setShares(shares.filter((s) => s.userId !== userId));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section aria-labelledby="share-heading" className="share">
      <h2 id="share-heading">Sharing</h2>
      <form onSubmit={grant}>
        <label>
          Share with (email) <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <button type="submit" className="primary">Share</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {shares.length === 0 ? (
        <p className="hint">Not shared with anyone yet.</p>
      ) : (
        <ul>
          {shares.map((s) => (
            <li key={s.userId}>
              {s.name} ({s.email}){' '}
              <button type="button" aria-label={`Remove ${s.name}`} onClick={() => revoke(s.userId)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">People you share with can view and edit. Only you can rename, share or delete.</p>
    </section>
  );
}
