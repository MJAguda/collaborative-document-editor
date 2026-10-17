import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from './api.ts';
import type { User } from './api.ts';

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [error, setError] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      const body = JSON.stringify({ email: form.get('email'), password: form.get('password') });
      onLogin(await api<User>('/login', { method: 'POST', body }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="page login" onSubmit={submit}>
      <h1>Collaborative Docs</h1>
      <label>
        Email <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        Password <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <button type="submit" className="primary">Log in</button>
      {error && <p role="alert">{error}</p>}
      <p className="hint">Demo accounts: alice@example.com, bob@example.com, carol@example.com (password: demo1234)</p>
    </form>
  );
}
