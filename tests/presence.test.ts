import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openDb } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { createPresence } from '../server/presence.ts';
import { createDoc, loginAs } from './helpers.ts';
import type { Agent } from './helpers.ts';

let now: number;
let app: Express;
let alice: Agent;
let bob: Agent;
let docId: number;
let bobId: number;
const url = () => `/api/documents/${docId}/presence`;

beforeEach(async () => {
  now = 1_000_000;
  const db = openDb(':memory:');
  app = createApp(db, undefined, createPresence(() => now));
  alice = await loginAs(app, 'alice@example.com');
  bob = await loginAs(app, 'bob@example.com');
  docId = (await createDoc(alice, 'Team plan')).id;
  bobId = (await alice.post(`/api/documents/${docId}/shares`).send({ email: 'bob@example.com' })).body.userId;
});

describe('presence', () => {
  it('two viewers see each other, never themselves', async () => {
    expect((await alice.post(url())).body.viewers).toEqual([]);
    const res = await bob.post(url());
    expect(res.status).toBe(200);
    expect(res.body.viewers).toEqual([{ id: expect.any(Number), name: 'Alice' }]);
    expect((await alice.post(url())).body.viewers).toEqual([{ id: bobId, name: 'Bob' }]);
  });

  it('reports version and who saved last', async () => {
    await bob.patch(`/api/documents/${docId}`).send({ content: '<p>hi</p>', version: 1 }).expect(200);
    expect((await alice.post(url())).body).toMatchObject({ version: 2, updatedBy: 'Bob' });
  });

  it('drops a viewer after the timeout', async () => {
    await bob.post(url());
    now += 24_000;
    expect((await alice.post(url())).body.viewers).toHaveLength(1);
    now += 2_000; // 26 s since Bob's last heartbeat
    expect((await alice.post(url())).body.viewers).toEqual([]);
  });

  it('leave removes the viewer immediately', async () => {
    await bob.post(url());
    await bob.delete(url()).expect(204);
    expect((await alice.post(url())).body.viewers).toEqual([]);
  });

  it('404 for a stranger and a missing document, 401 when logged out', async () => {
    const carol = await loginAs(app, 'carol@example.com');
    expect((await carol.post(url())).status).toBe(404);
    expect((await carol.delete(url())).status).toBe(404);
    expect((await bob.post('/api/documents/9999/presence')).status).toBe(404);
    expect((await bob.delete('/api/documents/9999/presence')).status).toBe(404);
    expect((await request(app).post(url())).status).toBe(401);
    expect((await request(app).delete(url())).status).toBe(401);
  });

  it('a revoked user gets 404 and disappears from the list', async () => {
    await bob.post(url());
    await alice.delete(`/api/documents/${docId}/shares/${bobId}`).expect(204);
    expect((await alice.post(url())).body.viewers).toEqual([]);
    expect((await bob.post(url())).status).toBe(404);
  });
});

describe('createPresence', () => {
  it('prunes expired entries of other documents', () => {
    const p = createPresence(() => now);
    p.touch(1, { id: 1, name: 'A' });
    p.touch(2, { id: 2, name: 'B' });
    now += 26_000;
    p.touch(3, { id: 3, name: 'C' });
    expect(p.size()).toBe(1);
  });
});
