# API reference

All endpoints except register/login require the `collabspace_session` cookie.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create account and default workspace |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Clear session |
| GET/POST | `/api/workspaces` | List or create workspaces |
| GET | `/api/workspaces/:workspaceId/pages` | List workspace pages |
| GET | `/api/workspaces/:workspaceId/members` | List members with their roles |
| POST | `/api/workspaces/:workspaceId/members` | Invite an existing account (owner only) |
| PATCH/DELETE | `/api/workspaces/:workspaceId/members/:membershipId` | Change role / remove member (owner only) |
| POST | `/api/pages` | Create page in a workspace |
| GET/PATCH | `/api/pages/:pageId` | Read page / update title |
| GET | `/api/pages/:pageId/ticket` | Mint the room ticket for the collaborative socket |
| GET/POST | `/api/pages/:pageId/comments` | List / add comments |
| GET/POST | `/api/pages/:pageId/versions` | List / create manual snapshots (list omits bodies) |
| GET | `/api/pages/:pageId/versions/:versionId` | Read one snapshot, including its body, for restore |

Membership changes take effect immediately for new sessions, and within 15 seconds for sockets that
are already open — see the re-check below. `/api/workspaces/:workspaceId/members*` answers 403 for
non-owners, 404 for an unknown account or workspace, and 409 when the person is already a member.
The last owner of a workspace cannot be demoted or removed.

## Collaborative WebSocket

`ws://localhost:1234/:pageId?ticket=…` — one socket per page, Yjs sync plus awareness.

* Every handshake verifies a signed room ticket (`aud: collabspace-room`, 12-hour expiry) that is
  bound to the page and carries the member's role. A missing, foreign or expired ticket closes the
  socket with `1008`, and the client stops reconnecting instead of looping.
* `OWNER` and `EDITOR` mutations are applied; `COMMENTER` and `VIEWER` receive document state but
  their `SyncStep2`/`Update` frames are discarded, so read-only members cannot write.
* Every 15 seconds each room re-reads its members' roles from the database. A member who has been
  removed (or whose page has been deleted) is closed with `1008 Access revoked`; an editor who has
  been demoted to a reading role is closed with `1008 Editing rights revoked`, because their open
  socket still holds the ticket's old role.
* Binary frames use the lib0 varint encoding that y-websocket expects; frames from an instance's own
  clients are never echoed back to it.
* With `REDIS_URL` set, document and awareness updates are published on `collabspace:room-events`, so
  any number of WebSocket processes can serve the same page. Without it the server runs singletons.
