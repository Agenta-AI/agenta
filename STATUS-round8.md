# Round 8 status

Branch: `feat/session-durable-approvals`

Round 8 fixes the browser-visible source/continuation identity mismatch. Session records now retain
their `turn_id`; replay associates a paused source execution with the new execution that continues
it, and the source message carries that continuation's running or terminal lifecycle. Approval
retirement is scoped to the interaction IDs that the continuation inherited.

## Browser proof

Use the same desktop and mobile routes, agent, and durable-approval setup as the Round 7 re-check.
Reload each page before starting so the browser loads this head.

### 1. Held message waits for the continuation terminal record

1. In one desktop tab, send a prompt that asks the agent to run a Bash command that waits briefly
   before printing a unique marker, so the approval continuation remains visibly in flight.
2. While the approval card is pending, type and send a second, uniquely identifiable message.
3. Confirm the second message appears in `1 queued message · waits for your answer` and does not
   start a user turn.
4. Click **Approve**. While the Bash activity is running, confirm the queued card and its text remain
   visible and no Stop/steer request is sent for the queued text.
5. Wait for the Bash output and the continuation's terminal `done` record. Only then confirm the
   queued text starts one normal user turn, the queued chip clears, and the Bash result is not
   `INTERRUPTED_BY_USER`.
6. Keep the page open for another 30 seconds and confirm the queued text is not sent a second time.

### 2. A non-answering tab retires the approval card

1. Open the same pending-approval session in desktop tabs A and B.
2. In tab B, click **Approve** and note the interaction ID, source turn ID, and continuation turn ID
   in the Network response/record stream.
3. Do not click anything in tab A. Confirm tab A receives continuation records whose `turn_id`
   differs from the source turn, including the `interaction_response` when present.
4. On the first continuation record, confirm tab A removes the live Approve/Deny controls rather
   than leaving `Needs your approval` actionable.
5. Wait for the continuation output and terminal record. Confirm tab A renders the output and the
   approval card remains retired. Repeat once with mobile answering and desktop observing.

### 3. The desktop dock closes on continuation completion

1. In one desktop tab, create a pending Bash approval and click **Approve**.
2. While the continuation runs, confirm the card may show `Answered, waiting for the agent`.
3. Inspect the session records and identify the terminal `done` or `error` record on the new
   continuation `turn_id`, not the paused source `turn_id`.
4. Confirm the dock closes when that terminal record arrives. It must not remain visible for the
   extra 60 seconds seen in Round 7.
5. Repeat with a second tab answering the gate. Confirm the observing tab also closes the dock when
   its interaction-row snapshot reaches `responded`/`resolved`, even before a terminal record.

### 4. Recoverable copy is scoped to one interaction

1. Create approval interaction X and force its response endpoint onto the recoverable path used by
   the Round 7 card test.
2. Answer X and confirm its card says `Answer saved, retry needed`.
3. In the same tab, advance to a later approval interaction Y with a different interaction ID.
4. Confirm Y opens with ordinary `Needs your approval` copy and live buttons. It must not inherit
   X's recoverable text, answered state, disabled buttons, or error text.
5. Answer Y on a normal continuation and confirm it uses `Answered, waiting for the agent` only
   while its own continuation is active, then closes on Y's terminal record.

## Automated verification

- `@agenta/chat`: 655 passed.
- `@agenta/oss`: 430 passed, 1 skipped.
- `@agenta/entities`: 1,480 unit tests passed; 31 integration tests skipped because the required
  API/auth integration environment was not configured.
- `@agenta/mobile`: 147 passed.
- `@agenta/playground`: 267 passed.
- Chat, OSS, entities, mobile, and playground typechecks passed.
- Monorepo frontend lint passed (four pre-existing mobile hook warnings remain).
- No API files changed, so the dedicated-DB API sessions suite and Ruff were not applicable.
