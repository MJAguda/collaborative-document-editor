import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDoc, loginAs, setup } from './helpers.ts';
import type { Agent } from './helpers.ts';

let t: ReturnType<typeof setup>;
let alice: Agent, bob: Agent, carol: Agent;
let docId: number;

const post = (a: Agent, id: number, body: unknown) => a.post(`/api/documents/${id}/comments`).send({ body });

beforeEach(async () => {
  t = setup();
  alice = await loginAs(t.app, 'alice@example.com');
  bob = await loginAs(t.app, 'bob@example.com');
  carol = await loginAs(t.app, 'carol@example.com');
  docId = (await createDoc(alice)).id;
  await alice.post(`/api/documents/${docId}/shares`).send({ email: 'bob@example.com' }).expect(201);
});

describe('comments', () => {
  it('owner and shared user can post and list; response shape and canModify', async () => {
    const a = await post(alice, docId, '  First  ').expect(201);
    expect(a.body).toMatchObject({ body: 'First', resolved: false, author: { name: 'Alice' }, canModify: true });
    expect(typeof a.body.id).toBe('number');
    expect(typeof a.body.createdAt).toBe('string');
    await post(bob, docId, 'Second').expect(201);
    const list = await bob.get(`/api/documents/${docId}/comments`).expect(200);
    expect(list.body.map((c: { body: string }) => c.body)).toEqual(['First', 'Second']);
    expect(list.body.map((c: { canModify: boolean }) => c.canModify)).toEqual([false, true]);
  });

  it('does not change the document version', async () => {
    const before = (await alice.get(`/api/documents/${docId}`)).body.version;
    await post(bob, docId, 'hi').expect(201);
    expect((await alice.get(`/api/documents/${docId}`)).body.version).toBe(before);
  });

  it('401 logged out, 404 stranger, on every route', async () => {
    const c = (await post(alice, docId, 'x')).body;
    const out = request(t.app);
    const base = `/api/documents/${docId}/comments`;
    await out.get(base).expect(401);
    await out.post(base).send({ body: 'x' }).expect(401);
    await out.patch(`${base}/${c.id}`).send({ resolved: true }).expect(401);
    await out.delete(`${base}/${c.id}`).expect(401);
    await carol.get(base).expect(404);
    await post(carol, docId, 'x').expect(404);
    await carol.patch(`${base}/${c.id}`).send({ resolved: true }).expect(404);
    await carol.delete(`${base}/${c.id}`).expect(404);
  });

  it('author or owner can resolve and delete; a third user with access gets 403', async () => {
    await alice.post(`/api/documents/${docId}/shares`).send({ email: 'carol@example.com' }).expect(201);
    const base = `/api/documents/${docId}/comments`;
    const byBob = (await post(bob, docId, 'bob says')).body;
    await carol.patch(`${base}/${byBob.id}`).send({ resolved: true }).expect(403);
    await carol.delete(`${base}/${byBob.id}`).expect(403);
    const r = await alice.patch(`${base}/${byBob.id}`).send({ resolved: true }).expect(200); // owner
    expect(r.body.resolved).toBe(true);
    const un = await bob.patch(`${base}/${byBob.id}`).send({ resolved: false }).expect(200); // author
    expect(un.body.resolved).toBe(false);
    const byAlice = (await post(alice, docId, 'alice says')).body;
    await bob.patch(`${base}/${byAlice.id}`).send({ resolved: true }).expect(403);
    await bob.delete(`${base}/${byAlice.id}`).expect(403);
    await bob.delete(`${base}/${byBob.id}`).expect(204);
    await alice.delete(`${base}/${byAlice.id}`).expect(204);
    expect((await alice.get(base)).body).toEqual([]);
  });

  it('a commentId from another document is 404', async () => {
    const other = (await createDoc(alice, 'Other')).id;
    const c = (await post(alice, other, 'elsewhere')).body;
    const base = `/api/documents/${docId}/comments/${c.id}`;
    await alice.patch(base).send({ resolved: true }).expect(404);
    await alice.delete(base).expect(404);
    await alice.delete(`/api/documents/${docId}/comments/abc`).expect(404);
    expect((await alice.get(`/api/documents/${other}/comments`)).body).toHaveLength(1);
  });

  it('validates body and resolved with 400', async () => {
    for (const bad of ['', '   ', 'x'.repeat(2001), 5, null, undefined]) await post(alice, docId, bad).expect(400);
    await post(alice, docId, 'x'.repeat(2000)).expect(201);
    const c = (await post(alice, docId, 'ok')).body;
    const url = `/api/documents/${docId}/comments/${c.id}`;
    await alice.patch(url).send({}).expect(400);
    await alice.patch(url).send({ resolved: 'yes' }).expect(400);
  });

  it('stores markup as plain text', async () => {
    const res = await post(alice, docId, '<img src=x onerror=alert(1)>').expect(201);
    expect(res.body.body).toBe('<img src=x onerror=alert(1)>');
  });

  it('deleting the document deletes its comments', async () => {
    await post(alice, docId, 'bye').expect(201);
    await alice.delete(`/api/documents/${docId}`).expect(204);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM comments').get()).toEqual({ n: 0 });
  });

  it('revoking a share removes access to the comments', async () => {
    await bob.get(`/api/documents/${docId}/comments`).expect(200);
    await alice.delete(`/api/documents/${docId}/shares/${(await bob.get('/api/me')).body.id}`).expect(204);
    await bob.get(`/api/documents/${docId}/comments`).expect(404);
    await post(bob, docId, 'x').expect(404);
  });
});
