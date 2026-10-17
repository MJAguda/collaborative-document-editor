import { useEffect, useState } from 'react';
import { api } from './api.ts';
import type { User } from './api.ts';
import { Login } from './Login.tsx';
import { DocList } from './DocList.tsx';
import { Editor } from './Editor.tsx';

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [hash, setHash] = useState(location.hash);

  useEffect(() => {
    api<User>('/me').then(setUser, () => setUser(null));
    const onHash = () => setHash(location.hash);
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  async function logout() {
    await api('/logout', { method: 'POST' }).catch(() => {}); // expired session: still sign out locally
    location.hash = '';
    setUser(null);
  }

  if (user === undefined) return <p className="page">Loading…</p>;
  if (user === null) return <Login onLogin={setUser} />;

  const docId = /^#\/doc\/(\d+)$/.exec(hash)?.[1];
  return (
    <>
      <header className="topbar">
        <a href="#/" className="brand">
          Documents
        </a>
        <span className="user">
          Signed in as <strong>{user.name}</strong> ({user.email})
        </span>
        <button type="button" onClick={logout}>
          Log out
        </button>
      </header>
      <main className="page">{docId ? <Editor key={docId} id={Number(docId)} /> : <DocList />}</main>
    </>
  );
}
