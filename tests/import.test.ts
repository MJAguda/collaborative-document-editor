import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { readFileSync } from 'node:fs';
import { loginAs, setup } from './helpers.ts';
import type { Agent } from './helpers.ts';

let app: Express;
let alice: Agent;
beforeEach(async () => {
  ({ app } = setup());
  alice = await loginAs(app, 'alice@example.com');
});

const ownedCount = async () => (await alice.get('/api/documents')).body.owned.length;

describe('POST /api/documents/import', () => {
  it('rejects an import whose HTML exceeds the import limit with 413 and creates nothing', async () => {
    const res = await alice.post('/api/documents/import').attach('file', Buffer.from('x'.repeat(600 * 1024)), 'big.txt');
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'The imported document is larger than 512 KB' });
    expect(await ownedCount()).toBe(0);
  });

  it('creates a new owned document from a .md file', async () => {
    const res = await alice.post('/api/documents/import').attach('file', readFileSync(new URL('./fixtures/sample.md', import.meta.url)), 'sample.md');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'sample', isOwner: true, version: 1 });
    expect(res.body.content).toContain('<h1>Imported heading</h1>');
    expect(res.body.content).not.toContain('script');
    expect(await ownedCount()).toBe(1);
  });

  it('creates a document from a .docx file', async () => {
    const res = await alice.post('/api/documents/import').attach('file', readFileSync(new URL('./fixtures/sample.docx', import.meta.url)), 'sample.docx');
    expect(res.status).toBe(201);
    expect(res.body.content).toContain('<h2>Docx heading</h2>');
  });

  it.each([
    ['report.pdf', Buffer.from('%PDF-1.4'), 400, 'Unsupported file type. Supported: .txt, .md, .docx'],
    ['empty.txt', Buffer.alloc(0), 400, 'The file is empty'],
    ['big.txt', Buffer.alloc(2 * 1024 * 1024 + 1, 97), 413, 'File is larger than 2 MB'],
  ])('rejects %s and creates no document', async (name, buffer, status, error) => {
    const res = await alice.post('/api/documents/import').attach('file', buffer, name);
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error });
    expect(await ownedCount()).toBe(0);
  });

  it('keeps an import under the cap saveable after the editor rewrites its lists and links', async () => {
    const md = Array.from({ length: 13500 }, (_, i) => `- [${i}](http://e/)`).join('\n');
    const res = await alice.post('/api/documents/import').attach('file', Buffer.from(md), 'links.md');
    expect(res.status).toBe(201);
    const rewritten = res.body.content
      .replaceAll('<li>', '<li><p>')
      .replaceAll('</li>', '</p></li>')
      .replaceAll('<a href', '<a target="_blank" rel="noopener noreferrer nofollow" href');
    const body = JSON.stringify({ content: rewritten, version: res.body.version });
    expect(body.length).toBeGreaterThan(1_300_000); // short links grow ~2.7x the 512 KB import cap, so the JSON limit needs 4x headroom
    await alice.patch(`/api/documents/${res.body.id}`).set('Content-Type', 'application/json').send(body).expect(200);
  });

  it.each([
    ['a truncated body', 'multipart/form-data; boundary=XX', '--XX\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n\r\nhello'],
    ['a missing boundary', 'multipart/form-data', 'garbage'],
  ])('maps %s to a 400, not a 500', async (_name, type, body) => {
    const res = await alice.post('/api/documents/import').set('Content-Type', type).send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid upload' });
    expect(await ownedCount()).toBe(0);
  });

  it('rejects a request without a file', async () => {
    await alice.post('/api/documents/import').field('other', 'x').expect(400, { error: 'Choose a file to upload' });
  });

  it('requires login', async () => {
    await request(app).post('/api/documents/import').attach('file', Buffer.from('hi'), 'a.txt').expect(401);
  });
});
