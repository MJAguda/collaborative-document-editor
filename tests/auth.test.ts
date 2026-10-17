import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { SEED_PASSWORD } from '../server/db.ts';
import type { DB } from '../server/db.ts';
import { loginAs, setup } from './helpers.ts';

let app: Express;
let db: DB;
beforeEach(() => {
  ({ app, db } = setup());
});

describe('auth', () => {
  it('logs in a seeded user, sets an httpOnly cookie and returns the user from /api/me', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/api/login').send({ email: 'Alice@Example.com', password: SEED_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: expect.any(Number), email: 'alice@example.com', name: 'Alice' });
    expect(res.headers['set-cookie'][0]).toMatch(/^sid=[\w-]{43}; .*HttpOnly; SameSite=Lax/);
    const me = await agent.get('/api/me').expect(200);
    expect(me.body.name).toBe('Alice');
  });

  it('rejects a wrong password with 401 and sets no cookie', async () => {
    const res = await request(app).post('/api/login').send({ email: 'alice@example.com', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid email or password' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it.each([{}, { email: 'alice@example.com' }, { email: 1, password: 'x' }])('rejects body %j with 400', async (body) => {
    const res = await request(app).post('/api/login').send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Email and password are required' });
  });

  it('returns 401 from /api/me without a session or with an unknown token', async () => {
    await request(app).get('/api/me').expect(401, { error: 'Please log in' });
    await request(app).get('/api/me').set('Cookie', 'sid=forged').expect(401);
  });

  it('logout deletes the session server-side', async () => {
    const login = await request(app).post('/api/login').send({ email: 'bob@example.com', password: SEED_PASSWORD });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    await request(app).post('/api/logout').set('Cookie', cookie).expect(204);
    await request(app).get('/api/me').set('Cookie', cookie).expect(401);
  });

  it('stores scrypt hashes, never the plain password', () => {
    const rows = db.prepare('SELECT email, password_hash FROM users ORDER BY id').all() as { email: string; password_hash: string }[];
    expect(rows.map((r) => r.email)).toEqual(['alice@example.com', 'bob@example.com', 'carol@example.com']);
    for (const r of rows) expect(r.password_hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
  });
});

describe('errors', () => {
  it('unknown /api route returns JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('malformed JSON returns 400 JSON without a stack trace', async () => {
    const res = await request(app).post('/api/login').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Request body is not valid JSON' });
  });

  it('an unexpected server error returns a generic JSON 500', async () => {
    const agent = await loginAs(app, 'alice@example.com');
    db.close();
    const res = await agent.get('/api/me');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(res.text).not.toContain('at ');
  });
});
