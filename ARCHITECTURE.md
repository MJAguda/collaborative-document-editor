# Architecture

```
browser (React + Tiptap) --/api (JSON, cookie)--> Express 5 --> SQLite (better-sqlite3)
                         <--static dist/client---- Express
```

## What I prioritised
- Working end-to-end flows, because the ticket is judged on whether a user can create, edit, import, share and reopen a document.
- Server-side access control, because the UI can be bypassed; every route checks ownership or share on the server.
- XSS safety, because shared documents render another user's HTML, which makes XSS the main real risk.
- Tests on the permission matrix, because a leak between users is the costliest bug here and the cheapest to catch with Supertest.
- A one-image deploy, because a single image plus one volume is the smallest setup a reviewer can open and run.

## Data model
Five tables (the fifth, `comments`, is below): `users` (scrypt hashes), `sessions` (random token, user, created_at), `documents` (owner, title, HTML content, `version`, `updated_at`, `updated_by`), `shares` (document, user). `version` makes saves optimistic: a stale version returns 409, and `updated_by` names who changed it. `comments` (document with ON DELETE CASCADE, author, plain-text body 1-2000 chars, `resolved`, `created_at`) is a document-level thread, deliberately not anchored to text so it never touches the sanitiser, autosave or the 409 flow. Its routes sit on the documents router under the same `:id` access check (401/404 unchanged); resolve and delete are limited to the author or the owner (403), and a comment id from another document is 404.

## Decisions and trade-offs
- HTML content passed through one `sanitize-html` allow-list on every save and import, instead of Tiptap JSON: simpler import (md/docx produce HTML) at the cost of trusting one sanitiser.
- Own `sessions` table instead of JWT/express-session: logout revokes server-side and there is no signing secret to manage.
- better-sqlite3 on a Fly volume instead of hosted Postgres: zero extra services, but a single instance.
- Node type stripping runs the TypeScript server directly; `tsc` only type-checks, so there is no server build.
- No access returns 404 (ids cannot be probed); not-owner returns 403.
- Hash routing (`#/doc/1`) instead of a router library.
- Presence by heartbeat polling, not WebSockets/SSE: the open editor POSTs `/api/documents/:id/presence` every 10 s and the server keeps `docId -> userId -> lastSeen` in memory (no table), treating a viewer as gone after 25 s or on an explicit DELETE (sent on unmount/pagehide with `keepalive`). Polling needs no long-lived connections (Fly can still stop an idle machine) and is easy to test with a fake clock. The response also carries the doc version and last editor, which drives the "saved changes" notice. Limits: ~10 s lag, single instance only, state lost on restart, one request per open editor per 10 s. Access reuses the document 404/401 rules and is re-checked per viewer on every call, so a revoked user vanishes at once. This is awareness, not co-editing: last save still wins with 409 detection.

## Security notes
httpOnly SameSite=Lax cookie (Secure in production), scrypt password hashes, HTML allow-list, JSON error handler (no stack traces), a 512 KB cap on converted imports and a 2 MB JSON body limit for saves (the editor re-serialises lists and links, so an import under 512 KB can grow about 3.5x when saved; a document that is saveable must stay saveable; the limits are this low for memory: sanitising a crafted 4 MB save of `&` stored 20 MB and OOM-killed the 256 MB VM), 2 MB upload limit, and a 3 MB cap on the uncompressed size of a `.docx` (read from the zip central directory before mammoth runs; mammoth needs ~40-50x the XML in RAM, and 4.9 MB of ordinary XML OOM-killed the 256 MB VM; a forged header could still pass, which is acceptable for this scope), and `NODE_OPTIONS=--max-old-space-size=128` in the Dockerfile runtime stage (so it applies on Fly) to make V8 collect earlier: it mitigates but does not eliminate OOM from several crafted parallel 2 MB saves; one request is safe). `npm audit`: 3 moderate findings in sprintf-js via argparse, which only mammoth's CLI uses; not reachable from the server, so not "fixed" (the forced fix downgrades mammoth to 0.3.29).

## Testing
Vitest + Supertest against in-memory SQLite cover sanitising, import, auth, CRUD, conflicts, sharing and the 403/404 matrix, plus a restart-persistence test on a file DB. Playwright covers editing/autosave/reload, upload, and two-user sharing and presence.

## Left out / next steps
Real-time collaboration (Yjs + Tiptap Collaboration), viewer role, sign-up and password reset, attachments, CSRF tokens if embedded cross-site, Postgres for multi-instance.
