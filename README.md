# CollabSpace

A real-time collaborative workspace internship project built with Next.js, TipTap, Yjs, PostgreSQL, Prisma, Redis, and WebSockets.

## Features
- Email/password registration and login with HTTP-only signed session cookies.
- Workspaces with owner/editor/commenter/viewer roles, owner-only invites, role changes and removal.
- Two page types: TipTap rich-text documents and Excalidraw boards, both on the same Yjs room.
- Live collaboration over an authenticated WebSocket: presence avatars, remote cursors on documents
  and peer selection on boards, with reconnect handling and a connection status chip.
- Comments, manual snapshots and restore for both page types.
- PostgreSQL holds identity, membership, page metadata, comments, snapshots and the binary Yjs state.
- Redis pub/sub fans updates out between WebSocket replicas, so one page can be served by several
  processes.
- Docker Compose for PostgreSQL and Redis; Vitest unit tests for CRDT convergence, board sync,
  snapshot restore and the Redis frame codec.

## Requirements
- Node.js 20.9+
- npm
- Docker Desktop (or local PostgreSQL and Redis)

## Run locally (Windows PowerShell)
1. Extract the project and open the folder in VS Code.
2. Install dependencies:
   ```powershell
   npm install
   ```
3. Create your environment file:
   ```powershell
   Copy-Item .env.example .env
   ```
4. Start infrastructure:
   ```powershell
   docker compose up -d
   ```
5. Generate Prisma client and create tables:
   ```powershell
   npx prisma generate
   npx prisma migrate dev --name init
   ```
6. Seed the demo account:
   ```powershell
   npm run db:seed
   ```
7. Open terminal 1 and start Next.js:
   ```powershell
   npm run dev
   ```
8. Open terminal 2 and start the Yjs WebSocket server:
   ```powershell
   npm run ws
   ```
9. Visit http://localhost:3000.

Demo credentials (after seeding): `demo@collabspace.dev` / `Demo1234!`

## Important architecture notes
- The browser connects to the standalone Yjs WebSocket service at `NEXT_PUBLIC_WS_URL`. Every
  handshake presents a signed room ticket bound to one page and one role; without it the socket
  closes with `1008` and the client stops reconnecting.
- Yjs binary state is persisted to PostgreSQL (`YjsState` per page) on a 1.5 second debounce, when a
  room goes idle, and on process shutdown. Verified by restarting the WebSocket service and reloading
  the page: the content comes back from the database.
- With `REDIS_URL` set, document updates and awareness frames are published on `collabspace:room-events`
  so several WebSocket processes can serve the same page at once. Each process ignores its own frames.
  Verified with two replicas on ports 1234/1235: an edit made in a browser on one replica reached a
  peer on the other in under 200 ms, and the same run with `REDIS_URL` empty delivered nothing.
- Known limitation: rooms load state from PostgreSQL when they are created, with no replay of earlier
  frames. If a room is created on a second replica within the first replica's 1.5 second save window,
  the newest edits are not in that load; connected clients converge them on their next sync.
- Room tickets fix a role at handshake time, so each room re-reads member roles from the database
  every 15 seconds. Removals close the socket with `1008 Access revoked`; losing edit rights closes it
  with `1008 Editing rights revoked`, which forces the client to come back through the app for a ticket
  that matches its current role.
- Manual snapshots store board scenes and ProseMirror JSON in PostgreSQL, and `GET /api/pages/:pageId/versions/:versionId`
  feeds the restore path for both page types. Restore replaces live content and is not undoable.

## Scripts
- `npm run dev` — Next.js development server
- `npm run ws` — Yjs WebSocket server
- `npm run db:generate` — Prisma client
- `npm run db:migrate` — Prisma migration
- `npm run db:seed` — demo account
- `npm test` — CRDT convergence test

## Suggested validation before demo
- Register two accounts in separate browser profiles.
- Create a workspace and a page.
- Connect both browsers to the same page room and type concurrently.
- Verify text converges, comments persist after refresh, and snapshots appear in history.
- Test viewer/commenter/editor permissions using seeded membership records or an invite/member management endpoint.

## Deliverables roadmap
1. ~~Add workspace invitations and member role management.~~ done, with owner-only invite, role
   change and removal in the dashboard.
2. ~~Add WebSocket authentication and per-room authorization.~~ done with signed room tickets and the
   15 second live-role re-check.
3. ~~Add Yjs persistence~~ done as binary Yjs state in PostgreSQL, flushed on debounce, idle and shutdown.
4. ~~Add Redis-backed cross-instance fanout and test with multiple WS replicas.~~ done and tested
   against replicas on 1234/1235.
5. ~~Add version restore with confirmation and audit logging.~~ restore is done, with a confirmation
   step for both documents and boards. Audit logging is not implemented.
6. Add Playwright multi-browser E2E tests, load tests, architecture diagram, API reference, and final
   presentation. The API reference and architecture diagram exist in `docs/`; Playwright is not set up.

## Security checklist before deployment
- Replace `AUTH_SECRET` with a cryptographically random secret.
- Add rate limiting to authentication and comment endpoints.
- Add CSRF/origin validation to mutation endpoints.
- ~~Add authenticated WebSocket upgrade and room-level permission checks.~~ done; the upgrade requires a
  signed room ticket and live sockets are re-authorized against the database.
- ~~Add durable Yjs persistence and Redis pub/sub before horizontal scaling.~~ done; PostgreSQL holds the
  binary document state and Redis carries updates between replicas.
- Configure HTTPS/WSS, database backups, logging, and monitoring.
