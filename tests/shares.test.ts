import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createDoc, loginAs, setup } from './helpers.ts';
import type { Agent } from './helpers.ts';

let app: Express;
let alice: Agent;
let bob: Agent;
let carol: Agent;
let docId: number;
let bobId: number;

beforeEach(async () => {
  ({ app } = setup());
  alice = await loginAs(app, 'alice@example.com');
  bob = await loginAs(app, 'bob@example.com');
  carol = await loginAs(app, 'carol@example.com');
  docId = (await createDoc(alice, 'Team plan')).id;
  const res = await alice.post(`/api/documents/${docId}/shares`).send({ email: 'BOB@example.com' });
  expect(res.status).toBe(201);
  expect(res.body).toEqual({ userId: expect.any(Number), email: 'bob@example.com', name: 'Bob' });
  bobId = res.body.userId;
});

describe('sharing', () => {
  it('lists the document as owned for Alice and shared (with owner name) for Bob', async () => {
    const a = (await alice.get('/api/documents')).body;
    const b = (await bob.get('/api/documents')).body;
    expect(a.owned.map((d: { id: number }) => d.id)).toEqual([docId]);
    expect(a.shared).toEqual([]);
    expect(b.owned).toEqual([]);
    expect(b.shared).toEqual([{ id: docId, title: 'Team plan', updatedAt: expect.any(String), ownerName: 'Alice' }]);
  });

  it('shows the share list to the owner only', async () => {
    expect((await alice.get(`/api/documents/${docId}`)).body.shares).toEqual([{ userId: bobId, email: 'bob@example.com', name: 'Bob' }]);
    const asBob = (await bob.get(`/api/documents/${docId}`)).body;
    expect(asBob).toMatchObject({ isOwner: false, owner: { name: 'Alice' }, shares: [] });
  });

  it('lets the shared editor save content, and the owner then gets 409 naming Bob', async () => {
    await bob.patch(`/api/documents/${docId}`).send({ content: '<p>by bob</p>', version: 1 }).expect(200);
    const res = await alice.patch(`/api/documents/${docId}`).send({ content: '<p>by alice</p>', version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.updatedBy).toBe('Bob');
  });

  it('forbids the shared editor from renaming, sharing, revoking or deleting (403)', async () => {
    const forbidden = { error: 'Only the owner can do this' };
    await bob.patch(`/api/documents/${docId}`).send({ title: 'Mine now' }).expect(403, forbidden);
    await bob.post(`/api/documents/${docId}/shares`).send({ email: 'carol@example.com' }).expect(403, forbidden);
    await bob.delete(`/api/documents/${docId}/shares/${bobId}`).expect(403, forbidden);
    await bob.delete(`/api/documents/${docId}`).expect(403, forbidden);
  });

  it('hides the document from a user without access (404 for read, write, share, delete)', async () => {
    const notFound = { error: 'Document not found' };
    await carol.get(`/api/documents/${docId}`).expect(404, notFound);
    await carol.patch(`/api/documents/${docId}`).send({ content: '<p>x</p>', version: 1 }).expect(404, notFound);
    await carol.post(`/api/documents/${docId}/shares`).send({ email: 'carol@example.com' }).expect(404, notFound);
    await carol.delete(`/api/documents/${docId}`).expect(404, notFound);
    expect((await carol.get('/api/documents')).body).toEqual({ owned: [], shared: [] });
  });

  it.each([
    [{ email: 'alice@example.com' }, 400, 'You already own this document'],
    [{ email: 'nobody@example.com' }, 404, 'No user with that email'],
    [{ email: 'bob@example.com' }, 409, 'Already shared with this user'],
    [{}, 400, 'Email is required'],
  ])('rejects share body %j with %i', async (body, status, error) => {
    const res = await alice.post(`/api/documents/${docId}/shares`).send(body);
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error });
  });

  it('revoking removes access', async () => {
    await alice.delete(`/api/documents/${docId}/shares/${bobId}`).expect(204);
    await bob.get(`/api/documents/${docId}`).expect(404);
    expect((await bob.get('/api/documents')).body.shared).toEqual([]);
    await alice.delete(`/api/documents/${docId}/shares/${bobId}`).expect(404, { error: 'Not shared with this user' });
  });

  it('deleting a shared document removes it for the recipient', async () => {
    await alice.delete(`/api/documents/${docId}`).expect(204);
    expect((await bob.get('/api/documents')).body.shared).toEqual([]);
  });
});
