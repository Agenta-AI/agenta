# Slice: single-turn admission

Status: built and verified live on 2026-09-02. Branch `feat/session-single-turn-admission`.
Not pushed, no pull request.

This slice makes one invariant true: **at most one execution runs per session, decided in one
place.** A second message sent while a turn is running is refused before anything is destroyed.
That is the `on_busy: reject` policy. Queue and steer are not in this slice.

Closes [#6417](https://github.com/Agenta-AI/agenta/issues/6417),
[#5539](https://github.com/Agenta-AI/agenta/issues/5539), and
[#5538](https://github.com/Agenta-AI/agenta/issues/5538).

---

## What happens today, and why

A user sends a second message while the agent is still answering the first. Both turns die and
the session stays locked for about thirty minutes. Every step below is **verified** in code.

1. A desktop Send does not go through the session coordination endpoint. It goes to the workflow
   invoke path, `POST /services/agent/v0/invoke`
   (`web/packages/agenta-playground/src/state/execution/agentRequest.ts:400`). The only caller of
   `commandSessionStream` in the web tree is Stop.
2. The runner mints its own turn id for that request
   (`services/runner/src/server.ts:189`).
3. The runner starts the turn's alive watchdog **before** it touches any sandbox
   (`services/runner/src/server.ts:519` versus the run at `:621`). That watchdog's first heartbeat
   is an atomic `nx` acquire of the session's `alive` lock in the API
   (`api/oss/src/core/sessions/streams/service.py:513`).
4. The second turn loses that acquire, because a different turn holds `running`
   (`api/oss/src/core/sessions/streams/service.py:534`). The API answers `is_current_turn: false`.
   **The arbiter was already correct.**
5. The runner read that answer only as "abort this run later"
   (`services/runner/src/sessions/alive.ts:217`), then carried on into the keepalive pool, found
   the first turn's environment busy, and **destroyed it**:
   the `evict (supersede-busy)` branch, now at
   `services/runner/src/lifecycle/session-coordinator.ts:1343` and no longer reachable by a live
   turn. The first turn lost its sandbox mid-answer.
6. The second turn then aborted on its own watchdog signal. Both turns were dead, and the session
   read as alive under a dead turn's lock until the lease expired.

So the fix is not a new subsystem. It is reading an answer the platform already gives, before
acting on the session.

---

## What changed

Five commits on `feat/session-single-turn-admission`.

### 1. The runner reads the admission answer (`7675eb0dc7`)

| File | Change |
|---|---|
| `services/runner/src/sessions/admission.ts` | New. Holds the stable code `session_turn_in_use` and the one line the user reads. The decision is not made here; this is only how the runner reports it. |
| `services/runner/src/sessions/alive.ts:190` | `startAliveWatchdog` now returns `admitted`, the FIRST beat's answer. A later `is_current_turn: false` is a Stop or steer and still travels the `onInterrupted` to abort path. |
| `services/runner/src/server.ts:534` | A refused turn stops at the edge and returns. |
| `services/runner/src/lifecycle/session-coordinator.ts:1320` | A `busy` pool entry is refused, never evicted. A `destroyed` entry still evicts and cold-starts. |
| `services/runner/src/engines/sandbox_agent/errors.ts:69` | `session_turn_in_use` added to `RunErrorCode`. |

The refusal in `server.ts` sits above three things it must not do, and this ordering is the
point:

- `cancelStaleInteractions` (`server.ts:573`) cancels the session's unanswered approval gates. A
  refused turn running it would cancel the **live** turn's approval card.
- The persisting emitter (`server.ts:587`) would write the refused message into the durable
  transcript, so it would come back on reload as a message the user never sent.
- `run()` (`server.ts:621`) is what reaches the keepalive pool.

The refusal streams as an `error` event carrying the code, then a failed terminal result. That is
the path every runner failure already takes to the browser, so no new transport is involved.

The coordinator change is a backstop, not the fix. The heartbeat fails open on a network or HTTP
error, which is deliberate and unchanged: a transient API blip refusing every message would be a
worse outage than the bug. In that window two turns can be admitted, and a `busy` pool entry is
the more specific truth on this box, so the coordinator refuses rather than destroying.

### 2. The browser keeps the user's text (`bdd7116520`)

A naive refusal is worse than the bug for the person typing. The composer clears synchronously on
submit (`web/packages/agenta-ui/src/RichChatInput/assets/submit.ts:31`), so without this change
their text is simply gone.

| File | Change |
|---|---|
| `web/packages/agenta-chat/src/model/error.ts` | The refusal constants, `isSessionBusyRefusal`, and a stable class on the parsed error. |
| `web/packages/agenta-chat/src/hooks/useAgentChatQueue.ts:98` | Remembers the message handed to `sendQueued` and hands it back once through `takeLastSent`. |
| `web/oss/src/components/AgentChatSlice/AgentConversation.tsx:433` | Puts that text back in the composer on a refusal. |
| `web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx:204` | The bubble says "Message not sent" rather than "The agent run failed", and offers no retry. |

The message is **not** re-queued. The queue releases on a settled `"error"` status
(`useAgentChatQueue.ts:68`, and the release effect below it), which for a refusal would re-send and be refused again in a tight
loop. The user decides when to send again.

The refusal message text is the contract between the runner and the browser. It is produced once,
in `services/runner/src/sessions/admission.ts`, and reaches the browser verbatim: the SDK's
`sanitize_runner_error` passes a clean one-line error through unchanged
(`sdks/python/agenta/sdk/agents/utils/wire.py:60`) and the Vercel egress puts it on the stream as
`errorText` with the code beside it
(`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:954`). The two constants must stay
byte-identical.

Mobile shares the queue hook and the error model, so it gets the refusal class. It has its own
composer and its own copy of the error effect, so it does not get the text restore. See the open
questions.

### 3. The client learns which execution it is watching (`ce0f1e12da`)

Added on request from the Stop guard lane, which found that no first-party client can send
`expected_execution_id` on the public Cancel: the runner mints the turn id per execution
(`services/runner/src/server.ts:189`) and never tells anyone, so a Stop can only mean "whatever
is running now", never "the turn I was watching".

**The `start` frame cannot carry it.** It is built and sent by the SDK's Vercel egress before the
runner replies at all: the `start` yield is the first statement of the projection
(`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:459-464`), and the runner is not
consulted until the loop below it. Putting the id there would mean moving the mint out of the
runner and threading a new correlation id through the normalizer, the response models and the
routing layer for **every** workflow, not just agent ones. That is a much larger change than the
problem needs.

The earliest frame that can carry it is the one right after:

| File | Change |
|---|---|
| `services/runner/src/protocol.ts:479` | New `{type: "turn", turnId}` agent event. |
| `services/runner/src/server.ts:579` | Emitted as the first event of a session-owned run, immediately after admission, through `liveEmit` and never the persisting emitter. It is transport correlation, not conversation, and must not become a session record. |
| `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:361` and `:653` | Forwarded unchanged as `data-agent-turn`, in both the live and dev-twin projections. |

A missing, empty or non-string id emits no part, so a client is never handed a guard value that
names nothing. A refused turn emits none either: it runs nothing, so there is nothing to stop.

Verified live on the stack below. The frame arrives third, after `start` and `start-step` and
before any content:

```
["start", "start-step", "data-agent-turn", "data-agent-status"]
```

and its id is the one holding the session's alive lock, cross-checked against the runner log:

```
data-agent-turn  turnId=e741e416-6789-4679-b050-e205d549f73f
[sessions/alive] heartbeat OK session=be8d2daa-… turn=e741e416-6789-4679-b050-e205d549f73f running=true
```

The Stop guard lane adds the browser half on its own branch. Nothing here consumes the frame yet.

### 4. API tests only (`8b1a45e5a6`)

No API code changed. Three cases now pin the answers the runner depends on, in
`api/oss/tests/pytest/unit/sessions/test_heartbeat_is_current_turn.py`.

---

## Approvals still resume

This is the case a naive "is anything alive on this session?" gate breaks, and it was checked
before the design was chosen.

A turn parked awaiting approval still holds `alive`, which is what makes the session
reattachable, but its turn-end beat released `running`
(`api/oss/src/core/sessions/streams/service.py:590`). The approval resume arrives as a new turn.
The heartbeat sees stale `alive` with **no** `running` owner, treats it as a legitimate handover,
tombstones the parked turn and admits the resume
(`api/oss/src/core/sessions/streams/service.py:536-561`).

So `running` is the discriminator, not `alive`. Both cases are now tested, at the API and end to
end at the runner.

---

## Tests

| Suite | Command | Result |
|---|---|---|
| Runner unit | `cd services/runner && pnpm test` | 2639 passed, 4 failed |
| Chat package | `cd web/packages/agenta-chat && pnpm test` | 626 passed |
| SDK agents unit | `pytest oss/tests/pytest/unit/agents/` | 1198 passed, 4 skipped |
| API sessions unit | `pytest unit/sessions/` | 328 passed, 41 skipped |
| Web lint | `cd web && pnpm lint-fix` | 25 tasks, 0 errors |
| Web typecheck | `tsc --noEmit` on `@agenta/oss` and `@agenta/chat` | clean |

The four runner failures are **pre-existing**, all in
`tests/unit/gateway-run-turn-composition.test.ts`. Confirmed by stashing this slice's changes and
re-running: the same four fail on the branch tip.

The 11 collection errors in the API run are an artifact of borrowing the live tree's virtual
environment, which resolves `agenta` from `/home/mahmoud/code/agenta-2/sdks/python` rather than
from this worktree. They are import errors in unrelated files.

New tests:

- `services/runner/tests/unit/session-admission.test.ts` (7 tests). A real runner HTTP server
  driven over a socket against a fake platform API. Covers: a refused turn never calls `run()`,
  the error event carries the code, no interaction sweep or attachment claim happens, the end
  beat names the refused turn, an admitted turn proceeds, a resume-shaped request is admitted,
  and an unreachable platform fails open.
- `services/runner/tests/unit/session-alive-interrupt.test.ts` (+4). `admitted` semantics: first
  beat only, fail-open, and a later interruption does not un-admit.
- `services/runner/tests/unit/session-keepalive-dispatch.test.ts` (+1, 1 rewritten). A busy entry
  refuses with no eviction and no cold acquire; a destroyed entry still evicts.
- `services/runner/tests/unit/session-steer-mount-loss.test.ts` (3 rewritten). These pinned the
  old supersede outcome. They now pin the refusal, and one new case asserts the live turn's
  environment is never torn down.
- `web/packages/agenta-chat/tests/unit/model/error.test.ts` (+4).
- `web/packages/agenta-chat/tests/unit/hooks/useAgentChatQueue.test.ts` (+4).
- `api/oss/tests/pytest/unit/sessions/test_heartbeat_is_current_turn.py` (+3).
- `services/runner/tests/unit/session-admission.test.ts` (+3, the turn-id frame): it arrives
  first, it is the id the alive lock was acquired under, and a refused turn emits none.
- `sdks/python/oss/tests/pytest/unit/agents/adapters/test_vercel_stream_conformance.py` (+3): the
  egress forwards the id verbatim exactly once in both projections, before any content, and a
  frame with no usable id emits no part.

One rewritten test was found to be passing for the wrong reason. The `destroyed`-entry case in
`session-keepalive-dispatch.test.ts` called `pool.destroyAll`, which clears the map, so the
assertion ran against a `miss` rather than a `destroyed` entry. The runner typecheck caught the
argument-type error that exposed it. It now marks the entry directly, because every public route
that destroys a session also removes it.

---

## Live verification

### The stack

A standalone EE dev stack built from this worktree, at **http://144.76.237.122:8680**.

The brief named `hosting/docker-compose/ee/.env.ee.dev.local` as the base env file. That file is
from 30 July and is missing `AGENTA_SERVICES_INTERNAL_KEY`, so compose refuses to start. The env
file was rebased on `.env.ee.dev.toolkit.local` (29 August), which is the one Mahmoud's own stack
runs, with every port, the project name and the env-file pointer changed. The four
`agenta-ee-dev-*:latest` images were 15 minutes old, so `--build` was skipped as the brief
directed; dev mode bind-mounts the source, so the containers run this worktree's code.

Two deployment notes worth keeping. First, the stale env file: compose fails immediately with
`required variable AGENTA_SERVICES_INTERNAL_KEY is missing a value`, which names the problem
clearly. Second, the web container 502s indefinitely if you have also run `pnpm install` in this
worktree's `web/` from the host, as this slice did for lint and tests. The host install runs as
uid 1000 and the container as uid 10001, so the container's own install and the api-client
`prepare` build cannot overwrite those paths and the entrypoint retries forever. The log looks
like a slow install; the real line is `[EACCES] ... .bin/tsc` thousands of lines up. Fix with
`chmod -R a+rwX web/` in the worktree and restart the container, then poll `/w` rather than `/`,
because `/` 308-redirects there and the first compile takes a few minutes.

Sandbox provider: `local`. Harness: `pi_core`. Model: `gpt-5.6-luna` on the QA OpenAI key, added
to the stack's own vault.

### The scenario

Driver: `verify_admission.py`, wire level, asserting on SSE frame types and never on model prose.
It is kept at
`/tmp/claude-1000/-home-mahmoud-code-agenta-2/7c724667-82cd-41a6-ba0b-e47bc96b4f67/scratchpad/verify_admission.py`.

1. Turn A starts on a fresh session and runs `sleep 40 && echo DONE_A` as a shell tool.
2. Fifteen seconds in, turn B sends "What is 2 + 2?" to the same session.
3. After A settles, turn C sends a third message.

The agent config sets `runner.permissions.default` to `allow`, so the long tool runs instead of
parking on an approval card. The first attempt without it proved nothing: the tool parked, turn A
ended after eleven seconds, and the two turns never overlapped.

### Results

| Turn | HTTP | Duration | Outcome |
|---|---|---|---|
| A, long turn | 200 | 50.3 s | finished, `finishReason: stop`, reply "Finished.", ran its tool |
| B, second send | 200 | **0.18 s** | refused, no assistant text, no tool call |
| C, after | 200 | 2.0 s | ran, reply "READY" |

Turn B's error frames, verbatim:

```json
{"code": "session_turn_in_use", "errorText": "This session is already running a turn. Your message was not sent. Wait for the reply, or stop the turn, then send again."}
{"type": "error", "errorText": "This session is already running a turn. Your message was not sent. Wait for the reply, or stop the turn, then send again."}
```

Runner log for session `081a1fe7-9961-4a0e-bdb1-177a59a8bfd6`, in order:

```
[sessions] stream sessionOwned=true sessionId=081a1fe7-… turnId=444d272b-… cred=present
[sessions/alive] heartbeat OK session=081a1fe7-… turn=444d272b-… running=true
[keepalive] miss key=01a063ea-…:081a1fe7-…; cold
[keepalive] reserve key=01a063ea-…:081a1fe7-… poolSize=2
[sessions] stream sessionOwned=true sessionId=081a1fe7-… turnId=0e4a90c0-… cred=present
[sessions/alive] heartbeat OK session=081a1fe7-… turn=0e4a90c0-… running=true INTERRUPTED
[sessions] admission REFUSED session=081a1fe7-… turn=0e4a90c0-…; another turn owns this session. No pool resolve, no eviction.
[sessions/alive] heartbeat OK session=081a1fe7-… turn=0e4a90c0-… running=false
[sessions/alive] heartbeat OK session=081a1fe7-… turn=444d272b-… running=true
[sandbox-agent] complete OK session=081a1fe7-… turn=0
[keepalive] park key=01a063ea-…:081a1fe7-… ttl=60000ms state=idle (re-park) poolSize=1
[sessions] stream sessionOwned=true sessionId=081a1fe7-… turnId=42fa2fa0-… cred=present
[keepalive] hit-continue key=01a063ea-…:081a1fe7-…
[sandbox-agent] complete OK session=081a1fe7-… turn=1
```

Three things to read from that log:

- There is **no** `evict (supersede-…)` line. The refused turn touched the pool not at all.
- Turn A ran to `complete OK` and then `park … state=idle`, so it kept its sandbox.
- Turn C got `hit-continue`, which means it continued the **warm** session A parked. The warm
  sandbox and the native harness session survived the second send. That is the constraint this
  slice was bound by, checked rather than assumed.

The stack is left running. Teardown:

```bash
cd /home/mahmoud/code/agenta-2-worktrees/slice-admission
bash ./hosting/docker-compose/run.sh --license ee --dev --env-file .env.ee.dev.admission --down
```

Add `--nuke` to drop the volumes as well. That stack has its own Postgres on port 5441 and shares
nothing with the other stacks on the box.

### Not verified

The browser behaviour was **not** verified in a browser. The composer restore, the "Message not
sent" bubble and the mobile path are covered by unit tests and a typecheck only. The web app on
this stack is serving (`/w` answers 200), so a UI pass is available and is worth doing before
this ships. Reproducing the refusal by hand needs two browser tabs on one session, or one tab
plus a curl invoke while a turn runs.

---

## What is left for queue and steer

Refusing needs no storage. Queue and steer both do, and that is the whole reason they are not in
this slice.

- **Queue** needs a durable pending-input store, because a saved message has to survive the turn
  it is waiting on and a browser reload. The client-side queue in `useAgentChatQueue` is a
  per-tab convenience; it is lost on reload and invisible to any other reader of the session.
- **Steer** needs the same store plus a decision that this slice deliberately does not make: is
  steer reject-with-message, keeping the turn and the warm session, or interrupt-and-restart? The
  RFC (`rfc.md:125`) says interrupt-and-restart, which reverses the ruling of 2026-07-22 without
  saying so, and interrupt-and-restart is the shape that loses warm state today.
- **The 409 shape.** The API's `_start_turn` already raises `SessionTurnInUse` and the router
  already maps it to 409 (`api/oss/src/apis/fastapi/sessions/router.py:192`). This slice does not
  route Send through that endpoint, because the runner's own heartbeat already performs the same
  atomic acquire one step earlier and the invoke path does not otherwise touch the API. If Send
  ever moves onto the coordination endpoint, the refusal should become the 409 and the runner's
  edge check becomes a second line of defence.
- **The watchdog** is untouched by this slice and remains the highest-value next change. It
  bounds every hang rather than only the double send.

---

## Open questions for Mahmoud

1. **Should the refused message be queued instead of handed back to the composer?**
   *Recommendation: keep handing it back for now.* Queueing reads better, but the queue
   auto-releases on a settled error status, so a refusal would re-send and be refused in a loop
   until the running turn ends. Fixing that needs a refusal-aware release gate, which is queue
   work, not admission work.

2. **Should mobile also restore the text?** Today it gets the refusal class but not the restore,
   because its composer and its error effect are separate files from desktop's.
   *Recommendation: yes, in a follow-up.* The precedent already exists at
   `web/mobile/src/features/chat/Composer.tsx:98`, which puts text back and shows a composer-level
   rejection strip. It is a few lines, but it is a second host to QA and this slice is already
   wide.

3. **Is the composer-level rejection strip a better home for this than a red transcript bubble?**
   Mobile already has one. A refusal is a fact about the message the user just typed, not about
   the conversation. *Recommendation: move it there once someone looks at it in a browser.* The
   current bubble is honest but it sits in the transcript, which is where run failures live.

4. **Is the fail-open on an unreachable API still the right default?** It is unchanged from
   today, and the coordinator's busy check backs it up on a single runner.
   *Recommendation: keep it.* Refusing every message during an API blip would be a worse outage
   than the bug this closes, and with one runner the local check catches the real overlap.

5. **Should `--build` have been skipped?** The brief said to skip it if the images were under
   three hours old, and they were fifteen minutes old. The live results therefore depend on dev
   mode bind-mounting this worktree's source, which the runner log confirms it did (the
   `admission REFUSED` line only exists in this branch). *Recommendation: no action.* Flagged only
   so the evidence is auditable.
