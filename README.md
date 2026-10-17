# Collaborative Document Editor

A small full-stack document editor: log in as a seeded user, create and rename documents, edit rich text with autosave, import `.txt`/`.md`/`.docx` files, and share documents with other users. React + Tiptap on the client, Express 5 + SQLite on the server.

**Live demo:** `https://<your-app>.fly.dev` (fill in after deploying, see "Deploy").

## Demo accounts
`alice@example.com`, `bob@example.com`, `carol@example.com`; password `demo1234` for all (seeded on first start; there is no sign-up). To switch user: Log out and log in as another account (or use a second browser profile).

## Features
- Create documents; the owner can rename them (1-200 characters).
- Rich text: bold, italic, underline, headings H1-H3, bulleted and numbered lists (shortcuts Ctrl/Cmd+B/I/U).
- Autosave 1 second after typing stops, with a visible Saved / Saving / Error status.
- Import a file as a new document; "My documents" and "Shared with me" lists with owner badges.
- Sharing by email.
- Presence: "<Name> is viewing" chips in the editor header, and a "<Name> saved changes. Reload" notice when someone else saved a newer version (shown before you hit a 409). It is polling, so expect up to ~10 s lag; presence is in memory, so it needs a single server instance (as deployed) and resets on restart.

## Supported uploads
`.txt`, `.md`, `.docx`, max 2 MB (a converted document must be under 512 KB, and a `.docx` must expand to under 3 MB). Each file becomes a new document. Kept: headings, bold/italic/underline, lists, links. Dropped: images, tables, colours, fonts, and unsafe HTML (scripts, styles, event handlers).

## Sharing rules
The owner grants access by email. Shared users can view and edit. Only the owner renames, shares, revokes and deletes (others get 403; users without access get 404). If two people edit at once, the later save gets a "This document was changed by <name>" banner and must reload.

## Run locally
Node >= 22.18.

```bash
npm install
npm run dev                    # API on :3000, client on http://localhost:5173 (proxy)
npm run build && npm start     # everything on http://localhost:3000
```
Data is stored in `data/app.db` (`DB_PATH` overrides). `.npmrc` sets `ignore-scripts=true`: better-sqlite3 ships prebuilt binaries, so no compiler or `node-gyp` run is needed.

## Tests
```bash
npm test             # Vitest + Supertest, in-memory DB
npm run typecheck    # tsc, no emit
npm run test:e2e     # Playwright 1.63.0; run `npx playwright install chromium` on a fresh machine
```
The E2E run starts its own server on :3100 with `DB_PATH=:memory:`.

## Deploy (Fly.io)
```bash
fly auth login
fly launch --no-deploy --copy-config
fly volumes create data --size 1 --region iad
fly deploy --ha=false
```
One machine only, because SQLite lives on one volume; data persists across deploys.

## Project layout
- `server/` Express API (`content.ts` sanitising/import, `db.ts`, `auth.ts`, `documents.ts`, `app.ts`, `index.ts`)
- `src/` React client; `tests/` Vitest suites, fixtures, and `tests/e2e/` Playwright specs
- `Dockerfile`, `fly.toml` deployment

See [ARCHITECTURE.md](ARCHITECTURE.md) for design decisions.

## Known limitations
No real-time co-editing (last save wins, with 409 conflict detection); editor role only (no viewer role); seeded users only; no login rate limiting; edits typed in the last second before navigating away can be lost. `.docx` zip-bomb protection is best effort: the size check reads the sizes declared in the zip, then mammoth converts in memory, so an ordinary large `.docx` is rejected above 3 MB expanded (a 17 KB file that expands to 4.9 MB killed the 256 MB VM; a forged header could still slip past the check). Crafted parallel API saves (several 2 MB bodies of `&` at once) are mitigated by `--max-old-space-size=128`, not eliminated. `npm audit` reports 3 moderate findings (sprintf-js via argparse, a mammoth CLI-only dependency); they are not reachable from the server, so they are left as is.
