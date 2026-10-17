import { Router } from 'express';
import type { RequestHandler } from 'express';
import multer, { MulterError } from 'multer';
import type { DB } from './db.ts';
import type { SessionUser } from './auth.ts';
import { ImportError, importFile, MAX_UPLOAD_BYTES, sanitize } from './content.ts';

type DocRow = {
  id: number;
  owner_id: number;
  title: string;
  content: string;
  version: number;
  updated_at: string;
  updated_by: number;
  owner_name: string;
};

declare global {
  namespace Express {
    interface Locals {
      user: SessionUser;
      doc: DocRow;
    }
  }
}

const TITLE_ERROR = 'Title must be 1-200 characters';

function cleanTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title.length >= 1 && title.length <= 200 ? title : null;
}

export function documentsRouter(db: DB): Router {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  // busboy parse errors (truncated body, no boundary) are the client's fault: 400, not 500.
  const single = upload.single('file');
  const uploadFile: RequestHandler = (req, res, next) =>
    single(req, res, (e) => next(e && !(e instanceof MulterError) ? new ImportError(400, 'Invalid upload') : e));

  const findAccessible = (docId: number, userId: number) =>
    db
      .prepare(
        `SELECT d.*, u.name AS owner_name FROM documents d JOIN users u ON u.id = d.owner_id
         WHERE d.id = ? AND (d.owner_id = ? OR EXISTS
           (SELECT 1 FROM shares s WHERE s.document_id = d.id AND s.user_id = ?))`,
      )
      .get(docId, userId, userId) as DocRow | undefined;

  const toJson = (row: DocRow, userId: number) => {
    const isOwner = row.owner_id === userId;
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      version: row.version,
      updatedAt: row.updated_at,
      owner: { id: row.owner_id, name: row.owner_name },
      isOwner,
      shares: isOwner
        ? db
            .prepare(
              `SELECT u.id AS userId, u.email, u.name FROM shares s JOIN users u ON u.id = s.user_id
               WHERE s.document_id = ? ORDER BY u.name`,
            )
            .all(row.id)
        : [],
    };
  };

  const insert = (ownerId: number, title: string, content: string) => {
    const result = db
      .prepare('INSERT INTO documents (owner_id, title, content, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)')
      .run(ownerId, title, content, new Date().toISOString(), ownerId);
    return toJson(findAccessible(Number(result.lastInsertRowid), ownerId)!, ownerId);
  };

  const ownerOnly: RequestHandler = (_req, res, next) => {
    if (res.locals.doc.owner_id !== res.locals.user.id) {
      res.status(403).json({ error: 'Only the owner can do this' });
      return;
    }
    next();
  };

  // No access (or no such id) -> 404, so strangers cannot probe which ids exist.
  router.param('id', (_req, res, next, raw: string) => {
    const row = /^\d+$/.test(raw) ? findAccessible(Number(raw), res.locals.user.id) : undefined;
    if (!row) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.locals.doc = row;
    next();
  });

  router.get('/', (_req, res) => {
    const userId = res.locals.user.id;
    const owned = db
      .prepare('SELECT id, title, updated_at AS updatedAt FROM documents WHERE owner_id = ? ORDER BY updated_at DESC, id DESC')
      .all(userId);
    const shared = db
      .prepare(
        `SELECT d.id, d.title, d.updated_at AS updatedAt, u.name AS ownerName
         FROM shares s JOIN documents d ON d.id = s.document_id JOIN users u ON u.id = d.owner_id
         WHERE s.user_id = ? ORDER BY d.updated_at DESC, d.id DESC`,
      )
      .all(userId);
    res.json({ owned, shared });
  });

  router.post('/', (req, res) => {
    const raw = (req.body ?? {}).title;
    const title = raw === undefined ? 'Untitled document' : cleanTitle(raw);
    if (!title) {
      res.status(400).json({ error: TITLE_ERROR });
      return;
    }
    res.status(201).json(insert(res.locals.user.id, title, ''));
  });

  router.post('/import', uploadFile, async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Choose a file to upload' });
      return;
    }
    const { title, html } = await importFile(req.file.originalname, req.file.buffer);
    res.status(201).json(insert(res.locals.user.id, title, html));
  });

  router.get('/:id', (_req, res) => {
    res.json(toJson(res.locals.doc, res.locals.user.id));
  });

  router.patch('/:id', (req, res) => {
    const user = res.locals.user;
    const row = res.locals.doc;
    const { title, content, version } = (req.body ?? {}) as Record<string, unknown>;
    if (title === undefined && content === undefined) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }
    let cleanedTitle: string | null = null;
    if (title !== undefined) {
      if (row.owner_id !== user.id) {
        res.status(403).json({ error: 'Only the owner can do this' });
        return;
      }
      cleanedTitle = cleanTitle(title);
      if (!cleanedTitle) {
        res.status(400).json({ error: TITLE_ERROR });
        return;
      }
    }
    if (content !== undefined && (typeof content !== 'string' || !Number.isInteger(version))) {
      res.status(400).json({ error: 'content must be a string and version an integer' });
      return;
    }
    // Content first: on a stale version nothing is written, so a 409 never leaves a renamed title behind.
    const write = db.transaction((): boolean => {
      if (content !== undefined) {
        const result = db
          .prepare(
            `UPDATE documents SET content = ?, version = version + 1, updated_at = ?, updated_by = ?
             WHERE id = ? AND version = ?`,
          )
          .run(sanitize(content as string), new Date().toISOString(), user.id, row.id, version);
        if (result.changes === 0) return false;
      }
      if (cleanedTitle) db.prepare('UPDATE documents SET title = ? WHERE id = ?').run(cleanedTitle, row.id);
      return true;
    });
    if (!write()) {
      const current = db
        .prepare('SELECT d.version, u.name FROM documents d JOIN users u ON u.id = d.updated_by WHERE d.id = ?')
        .get(row.id) as { version: number; name: string };
      res.status(409).json({
        error: `This document was changed by ${current.name}.`,
        updatedBy: current.name,
        version: current.version,
      });
      return;
    }
    res.json(toJson(findAccessible(row.id, user.id)!, user.id));
  });

  router.delete('/:id', ownerOnly, (_req, res) => {
    db.prepare('DELETE FROM documents WHERE id = ?').run(res.locals.doc.id);
    res.status(204).end();
  });

  router.post('/:id/shares', ownerOnly, (req, res) => {
    const row = res.locals.doc;
    const email = (req.body ?? {}).email;
    if (typeof email !== 'string' || !email.trim()) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }
    const target = db
      .prepare('SELECT id AS userId, email, name FROM users WHERE email = ?')
      .get(email.trim().toLowerCase()) as { userId: number; email: string; name: string } | undefined;
    if (!target) {
      res.status(404).json({ error: 'No user with that email' });
      return;
    }
    if (target.userId === row.owner_id) {
      res.status(400).json({ error: 'You already own this document' });
      return;
    }
    const result = db.prepare('INSERT OR IGNORE INTO shares (document_id, user_id) VALUES (?, ?)').run(row.id, target.userId);
    if (result.changes === 0) {
      res.status(409).json({ error: 'Already shared with this user' });
      return;
    }
    res.status(201).json(target);
  });

  router.delete('/:id/shares/:userId', ownerOnly, (req, res) => {
    const result = db
      .prepare('DELETE FROM shares WHERE document_id = ? AND user_id = ?')
      .run(res.locals.doc.id, Number(req.params.userId));
    if (result.changes === 0) {
      res.status(404).json({ error: 'Not shared with this user' });
      return;
    }
    res.status(204).end();
  });

  return router;
}
