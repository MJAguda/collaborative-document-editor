import { Router } from 'express';
import type { RequestHandler } from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DB } from './db.ts';

export type SessionUser = { id: number; email: string; name: string };

const COOKIE = 'sid';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, 'hex'), 64), Buffer.from(hash, 'hex'));
}

export function requireUser(db: DB): RequestHandler {
  const find = db.prepare(
    `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.created_at > ?`,
  );
  return (req, res, next) => {
    const token = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    const user = token ? (find.get(token, Date.now() - SESSION_MS) as SessionUser | undefined) : undefined;
    if (!user) {
      res.status(401).json({ error: 'Please log in' });
      return;
    }
    res.locals.user = user;
    res.locals.token = token;
    next();
  };
}

export function authRouter(db: DB): Router {
  const router = Router();

  router.post('/login', (req, res) => {
    const { email, password } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }
    const row = db
      .prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?')
      .get(email.trim().toLowerCase()) as (SessionUser & { password_hash: string }) | undefined;
    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, row.id, Date.now());
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_MS,
      path: '/',
    });
    res.json({ id: row.id, email: row.email, name: row.name });
  });

  router.get('/me', requireUser(db), (_req, res) => {
    res.json(res.locals.user);
  });

  router.post('/logout', requireUser(db), (_req, res) => {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(res.locals.token);
    res.clearCookie(COOKIE, { path: '/' });
    res.status(204).end();
  });

  return router;
}
