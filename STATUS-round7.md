# Round 7 status

Branch: `feat/session-durable-approvals`

Implemented as seven buildable commits after `5700408966`:

1. Cross-reader interaction events bypass the general refetch throttle, then refetch and reconcile
   settled rows into mounted transcripts.
2. Held messages remain visible during gates; recoverable Sends retry the durable continuation.
3. A terminal server transcript clears the desktop approval dock even if the row cache is stale.
4. Approval response and recovery state is scoped to the interaction that produced it.
5. Initial and background transcript hydration replay against fresh interaction rows.
6. Dispatcher and inline router fallback share bounded reference resolution (latest turn, then stream).
7. Replayed terminal records release the held queue after a completed continuation.

## Browser re-check

- Open one pending approval in two desktop tabs. Answer in tab B. Tab A must leave the actionable
  "Needs your approval" state within one second without a second click, then clear after the
  continuation's terminal record.
- Repeat with mobile answering and desktop observing. The desktop result must match the two-desktop
  case.
- While a gate is open, send a message. A visible `1 queued message · waits for your answer` card
  must appear immediately on desktop and mobile.
- Force a recoverable approval response, then Send. The Send must redeliver the saved continuation,
  keep the typed message visible in the held queue, and must not start a competing fresh turn or
  create a `continuation_resumed` failure bubble.
- After that continuation writes its terminal record, the approval dock must close and the held
  message must leave the queue and run exactly once as the next turn.
- After any recoverable interaction, start a new approval whose continuation succeeds. The new card
  must show ordinary pending/answered copy, never inherited "retry needed" copy.
- Reload a session whose interaction row is `responded` or `resolved`. No actionable approval card
  may reappear.
- Exercise a legacy/reference-less gate through the inline fallback composition. The continuation
  must resolve the newest turn's workflow reference (or the stream fallback) and invoke normally.

## Automated verification

- `@agenta/chat`: 648 passed.
- `@agenta/oss`: 429 passed, 1 skipped.
- `@agenta/entities`: 1,480 unit tests passed; 31 integration tests skipped because the required
  API/auth environment was not configured.
- `@agenta/mobile`: 147 passed.
- `@agenta/sessions`: 71 passed.
- Chat, OSS, entities, and mobile typechecks passed.
- Monorepo frontend lint passed (four pre-existing mobile hook warnings remain).
- API sessions: 706 passed.
- Ruff 0.15.12 format check: 1,491 files formatted; Ruff check passed.
