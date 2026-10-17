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
Four tables: `users` (scrypt hashes), `sessions` (random token, user, created_at), `documents` (owner, title, HTML content, `version`, `updated_at`, `updated_by`), `shares` (document, user). `version` makes saves optimistic: a stale version returns 409, and `updated_by` names who changed it.

## Decisions and trade-offs
- HTML content passed through one `sanitize-html` allow-list on every save and import, instead of Tiptap JSON: simpler import (md/docx produce HTML) at the cost of trusting one sanitiser.
- Own `sessions` table instead of JWT/express-session: logout revokes server-side and there is no signing secret to manage.
- better-sqlite3 on a Fly volume instead of hosted Postgres: zero extra services, but a single instance.
- Node type stripping runs the TypeScript server directly; `tsc` only type-checks, so there is no server build.
- No access returns 404 (ids cannot be probed); not-owner returns 403.
- Hash routing (`#/doc/1`) instead of a router library.

## Security notes
httpOnly SameSite=Lax cookie (Secure in production), scrypt password hashes, HTML allow-list, JSON error handler (no stack traces), a 512 KB cap on converted imports and a 2 MB JSON body limit for saves (the editor re-serialises lists and links, so an import under 512 KB can grow about 3.5x when saved; a document that is saveable must stay saveable; the limits are this low for memory: sanitising a crafted 4 MB save of `&` stored 20 MB and OOM-killed the 256 MB VM), 2 MB upload limit, and a 3 MB cap on the uncompressed size of a `.docx` (read from the zip central directory before mammoth runs; mammoth needs ~40-50x the XML in RAM, and 4.9 MB of ordinary XML OOM-killed the 256 MB VM; a forged header could still pass, which is acceptable for this scope), and `NODE_OPTIONS=--max-old-space-size=128` in the Dockerfile runtime stage (so it applies on Fly) to make V8 collect earlier: it mitigates but does not eliminate OOM from several crafted parallel 2 MB saves; one request is safe). `npm audit`: 3 moderate findings in sprintf-js via argparse, which only mammoth's CLI uses; not reachable from the server, so not "fixed" (the forced fix downgrades mammoth to 0.3.29).

## Testing
Vitest + Supertest against in-memory SQLite cover sanitising, import, auth, CRUD, conflicts, sharing and the 403/404 matrix, plus a restart-persistence test on a file DB. Playwright covers editing/autosave/reload, upload, and two-user sharing.

## Left out / next steps
Real-time collaboration (Yjs + Tiptap Collaboration), viewer role, sign-up and password reset, attachments, CSRF tokens if embedded cross-site, Postgres for multi-instance.
