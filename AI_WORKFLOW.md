# AI Workflow Note

## Tools I used

- **Claude Code (Claude Opus 5.5)** in the terminal, for almost all of the implementation work.
- **A ticket workflow I set up as a Claude Code skill.** It runs each feature through fixed phases: *understand → 3 design options → detailed plan → test-first build → review → local commit*. Separate agents did each phase (an intake agent, a designer, a builder and a reviewer), and I made every decision between phases.
- **Supporting skills:** test-driven development (a failing test before any code), "verification before completion" (no claim without the command output), and an over-engineering review ("ponytail") that looks for code to delete.
- **UI UX Pro Max** in a separate session for the visual restyle (typography, colour tokens, contrast). Its notes are in `design-system/collaborative-docs/MASTER.md`.
- **Playwright** (run by the agents) for browser tests and screenshots, and **Docker** for production-like memory tests.

## Where AI materially sped up the work

1. **Turning an open prompt into a scoped plan.** The intake agent split the brief into 15 testable requirements and raised the questions only I could answer: deploy target, auth model, upload types, conflict behaviour, permission levels. I answered about 20 of those in a few minutes instead of discovering them halfway through the build.
2. **Version-true dependencies.** Before any code was written, the designer checked every library against the actual npm releases and my Node version (22.21). For example, it confirmed Tiptap 3's StarterKit already includes underline and lists, and that `isomorphic-dompurify` 4.x would not install on Node 22.21. That avoided a class of "works in the docs, breaks on my machine" problems.
3. **Tests at volume.** The final suite is 85 Vitest/Supertest tests and 8 Playwright specs, more than I would have written by hand in the time. The bulk of them cover the permission matrix, sanitising and upload limits.
4. **Adversarial review I wouldn't have had time for.** The reviewer agent built zip bombs, crafted payloads and parallel-request scripts, and ran the Docker image at the deployed 256 MB memory limit.

## What AI-generated output I changed or rejected

**Design choices I rejected**

- **Two of the three architecture plans.** Plan B (npm workspaces, Tiptap JSON storage, zod, express-session) was too much setup for this scope. Plan C (`node:sqlite`, signed-cookie sessions) relied on an experimental API and had a logout that couldn't revoke a session. I chose Plan A, the simplest one that met every requirement.
- **`isomorphic-dompurify`**, rejected for the Node version mismatch above. `sanitize-html` with an explicit allow-list was used instead.
- **Over-reaching stretch scope.** For comments, the agent laid out doc-level comments, anchored comments and suggestion mode. I shipped doc-level comments first, then attempted anchored comments in a separate branch, only on the condition that it would be dropped if it failed review.
- **Proposals to work around the time limit.** I time-boxed the stretch features to one review round each, instead of the full multi-round process.

**Bugs in AI-written code that review caught and I sent back.** The first build passed all its own tests and still had these:

- **An infinite autosave loop after a save conflict.** Tiptap's `setEditable(false)` fires an update event by default, so a rejected save immediately scheduled another one, about once a second, forever. The fix was `setEditable(false, false)`, plus a test asserting no requests after the conflict banner.
- **Size limits that didn't agree.** Uploads allowed 2 MB, but saves allowed 1 MB, so an imported document could become unsaveable. Raising the save limit to fix that then let a crafted 4 MB save expand to 20 MB in the sanitiser and **crash the 256 MB server**. A later round found that a normal-looking 17 KB `.docx` could do the same.
  - It took five review rounds to settle on *measured* limits: 512 KB content, 2 MB request, 3 MB expanded `.docx`, and a Node heap cap.
  - That was the clearest lesson of the project: the agent's first "reasonable" numbers were guesses, and only measuring under the real memory limit gave numbers I could trust.
- **A partial update.** A rename sent together with invalid content changed the title before rejecting the request. Now everything is validated first, in a single transaction.
- **False claims in the README.** It claimed underline survived `.docx` import (it didn't) and that raw HTML was dropped (it wasn't, entirely). The code was fixed, and the docs corrected.

**AI process mistakes I caught**

- **A git-ignore pattern the agent added hid the entire browser test suite from the commit.** `e2e/` matched `tests/e2e/` at any depth. Review caught it before the commit.
- **One builder returned an empty report.** I didn't take "done" on trust: I re-ran the suites myself and had the reviewer verify each fix independently.
- **The reviewer ran `docker image prune -f` during cleanup.** That can delete unrelated untagged images on my machine. It was flagged to me so I could check for anything I'd lost.

## How I verified correctness, UX quality and reliability

- **Tests that fail first.** Every behavioural fix needed a test shown failing before the fix. When a builder skipped that step, the reviewer reverted each fix in a scratch copy and confirmed the matching test failed. Separately, one test turned out too lenient: it would still have passed with the save limit halved, so it was tightened.
- **An independent reviewer on every change.** It checks correctness, checks the libraries against their installed versions, re-runs the full suite against a baseline, and reviews for over-engineering. Its verdicts and findings are written down per round.
- **Production-like checks.** The Docker image was run locally at `--memory=256m`, including:
  - a restart, to confirm data persists on the volume;
  - single and parallel crafted saves;
  - `.docx` bombs;
  - a schema migration run on a copy of my real local database.
- **Security checks.** The server enforces every access rule, not the UI: 401 when logged out, 404 for strangers, 403 for non-owners. One shared sanitiser handles every save and import, and its tests include XSS payloads. Cookies are httpOnly and SameSite, and passwords are hashed with scrypt.
- **UX checks.**
  - Playwright runs the real flows with two users: format, reload, import, share, edit, the conflict banner, presence chips and comment permissions.
  - The agent captured screenshots and read them back.
  - [CONFIRM OR EDIT] I tested each feature by hand at `localhost:3000` with two browser sessions (Alice and Bob).
  - The visual design came from a dedicated UI tool, with measured contrast ratios.
- **My own calls stayed mine.** I made the stack, deploy target, auth model, conflict UX, size limits, scope cuts and every stretch decision. When the agents disagreed with each other, for example on how big the limits should be, I picked the measured option.

The working artefacts behind this note are the per-feature intake, options, plan and review files. I kept them out of the repository, but I can share them on request.
