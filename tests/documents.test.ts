import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { createDoc, loginAs, setup } from './helpers.ts';
import type { Agent } from './helpers.ts';

let app: Express;
let alice: Agent;
beforeEach(async () => {
  ({ app } = setup());
  alice = await loginAs(app, 'alice@example.com');
});

const FORMATTED =
  '<h2>Agenda</h2><p><strong>bold</strong> <em>italic</em> <u>underlined</u></p>' +
  '<ul><li><p>one</p></li></ul><ol><li><p>first</p></li></ol>';

describe('documents', () => {
  it('requires login', async () => {
    await request(app).get('/api/documents').expect(401);
    await request(app).post('/api/documents').send({}).expect(401);
  });

  it('creates an empty document owned by the caller, with a default title', async () => {
    const res = await alice.post('/api/documents').send({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Untitled document', content: '', version: 1, isOwner: true, owner: { name: 'Alice' }, shares: [] });
    const list = await alice.get('/api/documents').expect(200);
    expect(list.body.owned).toEqual([{ id: res.body.id, title: 'Untitled document', updatedAt: expect.any(String) }]);
    expect(list.body.shared).toEqual([]);
  });

  it('renames (trimmed) and the new title survives a re-read', async () => {
    const doc = await createDoc(alice);
    await alice.patch(`/api/documents/${doc.id}`).send({ title: '  Meeting notes ' }).expect(200);
    const res = await alice.get(`/api/documents/${doc.id}`).expect(200);
    expect(res.body.title).toBe('Meeting notes');
  });

  it.each(['', '   ', 'x'.repeat(201), 42])('rejects title %j with 400 on rename and create', async (title) => {
    const doc = await createDoc(alice);
    const res = await alice.patch(`/api/documents/${doc.id}`).send({ title });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Title must be 1-200 characters' });
    await alice.post('/api/documents').send({ title }).expect(400);
  });

  it('saves content with the current version and preserves formatting', async () => {
    const doc = await createDoc(alice);
    const res = await alice.patch(`/api/documents/${doc.id}`).send({ content: FORMATTED, version: 1 });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    const reread = await alice.get(`/api/documents/${doc.id}`).expect(200);
    expect(reread.body.content).toBe(FORMATTED);
  });

  it('sanitises content on save', async () => {
    const doc = await createDoc(alice);
    await alice.patch(`/api/documents/${doc.id}`).send({ content: '<p onclick="x()">a</p><script>alert(1)</script>', version: 1 }).expect(200);
    const res = await alice.get(`/api/documents/${doc.id}`);
    expect(res.body.content).toBe('<p>a</p>');
  });

  it('returns 409 with the last editor name for a stale version and keeps the newer content', async () => {
    const doc = await createDoc(alice);
    await alice.patch(`/api/documents/${doc.id}`).send({ content: '<p>new</p>', version: 1 }).expect(200);
    const res = await alice.patch(`/api/documents/${doc.id}`).send({ content: '<p>old</p>', version: 1 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'This document was changed by Alice.', updatedBy: 'Alice', version: 2 });
    expect((await alice.get(`/api/documents/${doc.id}`)).body.content).toBe('<p>new</p>');
  });

  it.each([
    [{}, 'Nothing to update'],
    [{ content: '<p>x</p>' }, 'content must be a string and version an integer'],
    [{ content: 5, version: 1 }, 'content must be a string and version an integer'],
  ])('rejects PATCH body %j with 400', async (body, error) => {
    const doc = await createDoc(alice);
    const res = await alice.patch(`/api/documents/${doc.id}`).send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error });
  });

  it('PATCH with title and an invalid content leaves the title unchanged', async () => {
    const doc = await createDoc(alice, 'Original');
    await alice.patch(`/api/documents/${doc.id}`).send({ title: 'Changed', content: 5, version: 1 }).expect(400);
    expect((await alice.get(`/api/documents/${doc.id}`)).body.title).toBe('Original');
  });

  it('PATCH with title and a stale version returns 409 and leaves the title unchanged', async () => {
    const doc = await createDoc(alice, 'Original');
    await alice.patch(`/api/documents/${doc.id}`).send({ content: '<p>new</p>', version: 1 }).expect(200);
    await alice.patch(`/api/documents/${doc.id}`).send({ title: 'Changed', content: '<p>old</p>', version: 1 }).expect(409);
    expect((await alice.get(`/api/documents/${doc.id}`)).body.title).toBe('Original');
  });

  it('PATCH with title and current content updates both', async () => {
    const doc = await createDoc(alice, 'Original');
    const res = await alice.patch(`/api/documents/${doc.id}`).send({ title: 'Changed', content: '<p>x</p>', version: 1 }).expect(200);
    expect(res.body).toMatchObject({ title: 'Changed', content: '<p>x</p>', version: 2 });
  });

  it('maps an unsupported request charset to a 4xx (415), not 500', async () => {
    const res = await alice.post('/api/documents').set('Content-Type', 'application/json; charset=latin-9').send('{}');
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: 'Invalid request' });
  });

  it('rejects a body over 2 MB with JSON 413', async () => {
    const doc = await createDoc(alice);
    const res = await alice.patch(`/api/documents/${doc.id}`).send({ content: 'x'.repeat(2_300_000), version: 1 });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Request is too large' });
  });

  it('keeps a missing client build a logged 500, not a silent 4xx', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'empty-dist-'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await request(createApp(openDb(':memory:'), dir)).get('/');
      expect(res.status).toBe(500);
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
      rmSync(dir, { recursive: true });
    }
  });

  it('returns 404 for a missing or non-numeric id', async () => {
    await alice.get('/api/documents/99999').expect(404, { error: 'Document not found' });
    await alice.get('/api/documents/abc').expect(404);
  });

  it('owner deletes a document', async () => {
    const doc = await createDoc(alice);
    await alice.delete(`/api/documents/${doc.id}`).expect(204);
    await alice.get(`/api/documents/${doc.id}`).expect(404);
  });

  it('documents survive a server restart (file database)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cde-'));
    try {
      const first = setup(join(dir, 'app.db'));
      const agent = await loginAs(first.app, 'alice@example.com');
      const doc = await createDoc(agent, 'Persistent');
      await agent.patch(`/api/documents/${doc.id}`).send({ content: FORMATTED, version: 1 }).expect(200);
      first.db.close();

      const second = setup(join(dir, 'app.db'));
      const again = await loginAs(second.app, 'alice@example.com');
      const res = await again.get(`/api/documents/${doc.id}`).expect(200);
      expect(res.body).toMatchObject({ title: 'Persistent', content: FORMATTED, version: 2 });
      second.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
