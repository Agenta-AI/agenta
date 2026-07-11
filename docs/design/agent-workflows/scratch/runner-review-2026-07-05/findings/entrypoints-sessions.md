# Runner review — entrypoints + sessions (server.ts, cli.ts, entry.ts, apiBase.ts, version.ts, responder.ts, protocol.ts, sessions/*)

Reviewer scope: HTTP/CLI entrypoints, the streaming responder, the wire-contract types
(mechanical quality only), and the sessions subsystem (alive/auth/contract/interactions/persist).
Read-only review. Other reviewers cover `engines/`, `tools/`, `tracing/`, and contract *design*.

## How it actually works (verified)

**Two entrypoints, meant to share one contract.** `src/server.ts` runs a bare `node:http`
server on `:8765` (`GET /health`, `POST /run|/stream`, `POST /kill`); `src/cli.ts` reads one
JSON request from stdin and writes one result to stdout, with an optional `--stream` NDJSON
mode. Both call `runSandboxAgent` directly (`engines/sandbox_agent.ts`) — there is exactly one
engine, selected internally by harness, not by an engine selector. Both export a testable seam
(`createAgentServer(run)` / `runCli(raw, stream, io)`) that tests use with a fake engine.

**Auth on the HTTP path is optional and off by default.** `AGENTA_RUNNER_TOKEN` unset (the
default) means `/run`/`/stream`/`/kill` accept any caller reachable on the loopback bind; set,
every request must present a matching bearer via `Authorization: Bearer` or
`X-Agenta-Runner-Token`, checked in constant time (`timingSafeEqual`). `/health` is always
open (no secrets in the payload). The CLI has no auth concept — stdin is trusted by
construction (subprocess transport).

**Streaming (`runAndStream`) branches into two behaviorally different modes** based on
whether `request.sessionId` is non-empty (`isSessionOwned`):
- **Non-session runs**: `res.on("close", ...)` aborts the engine when the client disconnects.
  Events stream live; nothing is persisted server-side beyond the HTTP response itself.
- **Session-owned runs**: the run survives client disconnect (abort is never wired). The
  runner (a) starts an alive-lock heartbeat watchdog (`sessions/alive.ts`) that keeps a Redis
  lock + `session_streams` row live on a 30s interval and periodically refreshes the bearer
  credential; (b) fire-and-forgets `cancelStaleInteractions` for the new turn; (c)
  fire-and-forgets `persistSandboxId`; (d) wraps the live emitter in a persisting emitter
  (`sessions/persist.ts`) that POSTs every event to `/sessions/records/ingest`, coalescing
  the `*_delta` families into one durable event per message/thought. All of this authenticates
  "as the invoke caller" using a bearer pulled out of `request.telemetry.exporters.otlp.headers`
  — there is no separate session-auth token type; `sessions/auth.ts` just re-mints a fresh-TTL
  copy of the same credential via `/access/permissions/check`.

**`sessions/contract.ts`** is a hand-mirrored copy of the Python Redis contract (TTLs, key
names, the release-if-owner Lua script, `CONCURRENCY_CAP`, `validateSessionId`), pinned by a
golden-fixture test. The runner itself never touches Redis directly — everything routes
through the API's HTTP endpoints (heartbeat, records/ingest, interactions), so this file is
really just shared vocabulary + a validator, most of which (see findings) is not called from
runner code.

**`responder.ts`** turns ACP permission gates and client-tool pauses into verdicts using a
shared `decide()` ladder (out of scope — `permission-plan.ts`) plus two separate stores:
`ConversationDecisions` for consume-once allow/deny replay, and a FIFO-per-key store for
client-tool browser outputs (explicitly separated so a literal `"allow"`/`"deny"` output string
can't be misread as a permission decision). This module is well-isolated and its cold-replay
key derivation (`approvedCallKey`/`canonicalJson`) is careful about non-JSON values.

## Strengths — keep this

- The `createAgentServer(run)` / `runCli(raw, stream, io)` testing seams are genuinely good:
  both entrypoints are unit-tested end-to-end with a fake engine, no live harness needed.
- The shutdown handler for the HTTP server (`registerShutdownHandler`) is well-designed where
  it exists: idempotent against repeated signals, bounded so it can never hang, injectable for
  tests, and actually tested (signal → cleanup → exit, cleanup-rejects still exits, no
  double-cleanup).
- The `Authorization: Bearer` header parser deliberately avoids `/^Bearer\s+(.+)$/` (polynomial
  ReDoS) in favor of a fixed-prefix check + `slice/trim` — a real, documented threat-modeling
  decision, not an accident.
- `responder.ts`'s separation of permission decisions from client-tool outputs (and the FIFO
  list for duplicate identical calls) is a deliberate fix for a real collision class, and it's
  covered by tests for the duplicate-call case.
- The persistence chain (`sessions/persist.ts`) correctly serializes writes per-session via a
  promise-chain tail, is fire-and-forget mid-run but drained before teardown, and swallows
  failures without ever blocking or throwing into the run.
- `PermissionMode`/`ToolPermission`/`AgentEvent`/`RenderHint` are properly modeled as
  discriminated unions/string-literal unions in `protocol.ts` — where the authors did this, it's
  done well.

## Findings

### 1. [HIGH] `cli.ts` has zero process-lifecycle hardening — the CLI transport can leak Daytona sandboxes on kill
**File:** `src/cli.ts` (whole file); compare `src/server.ts:378-430`.

`server.ts` installs `registerShutdownHandler()` (destroys in-flight sandboxes on
SIGTERM/SIGINT) plus `unhandledRejection`/`uncaughtException` handlers, specifically because
"a shutdown handler... Without this, `docker stop` kills the process while the per-run
`finally`... is still waiting... so the sandbox it created is never deleted and leaks (a
Daytona credit-burner)." `cli.ts` has none of this: no signal handler, no
`destroyInFlightSandboxes()` call, no `unhandledRejection`/`uncaughtException` handler. The CLI
is exactly the transport the SDK uses "when `AGENTA_RUNNER_INTERNAL_URL` is unset" (README) —
i.e., whenever the subprocess model is in play. If the Python caller kills the subprocess
(timeout, SIGTERM, SIGKILL) while a Daytona-backed run is in flight, the sandbox created by
that run is never torn down — the identical leak class `server.ts`'s handler exists to close,
just on the other entrypoint.
**Recommendation:** register the same signal + unhandled-rejection/exception handlers in
`cli.ts`'s entrypoint guard (share the implementation — see finding 7). SIGKILL obviously can't
be caught, but SIGTERM (the normal "give up on this subprocess" signal) can and today isn't.
**Horizon:** short (ships next week; this is the same class of bug the team already fixed once
on the other transport).

### 2. [HIGH] Shutdown handler doesn't stop accepting new connections before sweeping — a request that races the signal still leaks its sandbox
**File:** `src/server.ts:378-430`.

`registerShutdownHandler` calls `onCleanup()` (`destroyInFlightSandboxes`, a one-time sweep of
whatever is in `inFlightSandboxes` *at that instant*) and then `exit(0)`. It never calls
`server.close()` (the server instance isn't even threaded into the handler). During the
window between the signal arriving and `process.exit(0)` actually firing (bounded by the
`destroyInFlightSandboxes` timeout, up to 5s), the HTTP server keeps accepting and starting new
`/run`/`/stream` requests. A request that starts a Daytona sandbox *after* the sweep already
ran is added to `inFlightSandboxes` but is never destroyed before `process.exit(0)` — the exact
leak this mechanism exists to prevent, just via a slightly different race. This matters most on
rolling deploys/redeploys, which is exactly when SIGTERM fires under normal operation (not just
crash scenarios).
**Recommendation:** on signal, first stop the server from accepting new connections
(`server.close()`), *then* sweep in-flight sandboxes, *then* exit. Thread the `Server` instance
into `registerShutdownHandler` (or return a closer from `createAgentServer` and call both from
the entrypoint block).
**Horizon:** short.

### 3. [HIGH] `apiBaseFromRequest` mutates `process.env.AGENTA_API_URL` globally from per-request, caller-supplied data
**File:** `src/server.ts:127-134, 228-232`.

```ts
const requestApiBase = apiBaseFromRequest(request);
if (requestApiBase && !process.env.AGENTA_API_URL) {
  process.env.AGENTA_API_URL = requestApiBase;
  ...
}
```
This derives an API base URL from the *run request's own* `telemetry.exporters.otlp.endpoint`
field (arbitrary string, caller-controlled) and, the first time it fires in the process's
lifetime, pins it into `process.env.AGENTA_API_URL` — global mutable state read by every
subsequent request via `apiBase()` (`src/apiBase.ts`), used to build the URLs for heartbeat,
persist, interactions, and credential refresh, all of which carry live bearer tokens in the
`Authorization` header. In a shared runner process serving concurrent sessions (the normal
production shape — one sidecar, many `/run` calls), whichever request happens to be first to
hit this code path with an unset `AGENTA_API_URL` permanently decides where *every other
session's* authenticated session-coordination calls go, for the life of the process. In the
common deployment (`AGENTA_API_INTERNAL_URL` set via compose/k8s) this branch never fires
because `apiBase()` prefers that var first — but the mutation targets `AGENTA_API_URL`
specifically as a fallback-only knob, meaning it's exactly the path that *would* fire in a
misconfigured or "internal URL not set" deployment, and once it fires once, it's baked in.
There is no test covering this function or this mutation at all.
**Recommendation:** don't mutate `process.env` from per-request data. If a request-derived
fallback is needed, thread it explicitly through the call chain (or cache it per-session, not
globally) instead of writing to global process state that every other concurrent request also
reads.
**Horizon:** short — this is a live correctness/credential-routing risk, not hypothetical, in
any deployment shape where `AGENTA_API_INTERNAL_URL` isn't set.

### 4. [HIGH] The two entrypoints diverge on error shape for the same failure (malformed JSON + streaming requested)
**File:** `src/server.ts:323-332` vs `src/cli.ts:55-62`.

`cli.ts`'s invalid-JSON handling produces a stream-shaped record when `stream` is true:
`write(stream ? JSON.stringify({ kind: "result", result: failure }) + "\n" : ...)`. `server.ts`
checks for invalid JSON *before* it looks at `wantsStream`, and on failure always calls
`send(res, 400, {...})` — a flat, non-NDJSON JSON body with `content-type: application/json`,
regardless of whether the caller sent `Accept: application/x-ndjson`. So: a caller that always
expects NDJSON on the stream path (which is what "the live agent always requests," per the
comment at `server.ts:342-345`) gets a *different response shape* for malformed input than it
would from the CLI transport for the identical input — and a caller line-parsing NDJSON that
gets a bare 400 JSON body has to special-case that. This is the one config both entrypoints are
supposed to keep "actually shared" and it's exactly where they've drifted.
**Recommendation:** for the streaming path, emit the same `{kind:"result", result: {ok:false,
error}}` NDJSON line (with a 200 or 400 status, pick one deliberately) that the CLI produces,
instead of branching to a differently-shaped error body before checking `Accept`.
**Horizon:** short (this is exactly the kind of drift a golden-fixture-style test should pin,
similar to the wire-contract test).

### 5. [MEDIUM] No request body size limit on `POST /run`/`/stream`
**File:** `src/server.ts:285-291` (`readBody`), `src/cli.ts:87-93` (`readStdin`, less of a
concern since it's a trusted subprocess pipe).

`readBody` accumulates every chunk into an array and concatenates with no cap. A `/run` request
legitimately carries full conversation history plus any image/file attachments as base64 —
that can be large even in good faith, and there is no `Content-Length` pre-check or streaming
cap that would turn an oversized body into a clean `413` before it's fully buffered in memory.
Combined with finding 15 (no concurrency cap), a handful of large concurrent requests can
exhaust the process's memory.
**Recommendation:** enforce a configurable max body size (check `Content-Length` up front where
present, and abort the read if actual bytes exceed it while streaming) and return `413` instead
of buffering unbounded.
**Horizon:** short-medium (low likelihood given the loopback trust boundary, but cheap to add
and this is exactly the kind of thing that's much harder to retrofit under load next week).

### 6. [MEDIUM] `POST /kill` tears down every in-flight sandbox process-wide, not just the caller's
**File:** `src/server.ts:303-312`, `src/engines/sandbox_agent.ts:160-174`.

`destroyInFlightSandboxes()` iterates `inFlightSandboxes` (a single process-wide `Set`) and
destroys all of them — there is no session/run-scoped selector. The `/kill` endpoint's own
comment frames this as intentional ("lets the orphan sweeper force a process-wide teardown
out-of-band. Always ok.") but if one sidecar process ever serves more than one concurrent
session (which the whole alive/persist/heartbeat design assumes it does), a single `/kill` call
— triggered for one orphaned session — takes down every other session's live sandbox on that
replica too. Worth confirming this is genuinely intended for the deployment topology (e.g., if
each replica is expected to host exactly one active run at a time, this is fine and the comment
is accurate; if replicas are shared across concurrent sessions, this is a blast-radius bug).
**Recommendation:** confirm the intended concurrency-per-replica model; if replicas are shared,
scope `/kill` to a `sessionId`/sandbox id instead of sweeping the whole process.
**Horizon:** medium (cross-cutting with `engines/` — flagging here since the HTTP surface for it
lives in this reviewer's scope).

### 7. [MEDIUM] `server.ts` and `cli.ts` reimplement the same wire-handling logic instead of sharing it
**File:** `src/server.ts:181-274, 285-291, 323-348` vs `src/cli.ts:47-93`.

Both files independently: parse raw JSON with the same try/catch-and-produce-an-error-result
pattern; wrap the engine's `EmitEvent` to build NDJSON event lines; write exactly one terminal
`{kind:"result"}` line with `events` stripped to `[]`; and read an input stream chunk-by-chunk
into a `Buffer`. `AGENTS.md` frames the two entrypoints as sharing "the same contract," but the
actual code for producing that contract's wire shapes is copy-pasted, not shared — which is
precisely how finding 4 happened, and will happen again on the next change to either the error
path or the streaming envelope. `RunAgent` itself is even declared twice with two different
signatures (server.ts's carries a `signal` parameter; cli.ts's doesn't), so a future change to
one won't even fail to compile in the other.
**Recommendation:** extract a shared module (e.g. `src/streamProtocol.ts`) owning: JSON-parse
with the standard error result, the NDJSON record writer/emit wrapper, and the "terminal result
strips events" rule. Both entrypoints call into it; behavior differences (e.g., HTTP status
codes, session coordination) stay local to each entrypoint.
**Horizon:** medium (worth doing before more streaming-path features land on either side).

### 8. [MEDIUM] `sessions/persist.ts`'s `record_index` claim ("monotonic per session") doesn't match the implementation ("monotonic per turn")
**File:** `src/sessions/persist.ts:108-125`.

The doc comment says the returned counter is built "so record_index increments monotonically
**per session**." But `buildPersistingEmitter(sessionId, ...)` is called fresh once per
`runAndStream` invocation (i.e., once per **turn**, from `server.ts:247`), and `eventIndex`
starts at `0` inside that closure every time. A session with N turns will POST records with
`record_index` values `0,1,2,...` **for every turn**, not a value that keeps climbing across
the session's lifetime. If the ingest endpoint or any downstream consumer treats
`(session_id, record_index)` as an ordering or uniqueness key scoped to the whole session
(plausible, given the comment's own framing), turn 2's `record_index=0` collides with turn 1's.
Verifying the API-side (Python) contract for `/sessions/records/ingest` is out of this
reviewer's scope, but the runner-side comment and implementation disagree with each other
regardless of what the API does with it, which is itself worth fixing.
**Recommendation:** either rename the comment to say "monotonic per turn" (if that's genuinely
what the ingest endpoint expects — e.g., it's scoped by `(session_id, turn_id, record_index)`),
or seed `eventIndex` from a per-session cursor if cross-turn uniqueness is actually required.
**Horizon:** short — cheap to check against the API contract, and wrong in one direction or the
other today.

### 9. [MEDIUM] `protocol.ts`: several fields with a known, finite, documented value set are typed as bare `string`
**File:** `src/protocol.ts:369-424` (`harness`, `sandbox`, `provider`, `connection.mode`,
`deployment`, `credentialMode`), `:29-33` (`ChatMessage.role`).

The doc comments spell out the exact allowed values — `harness?: string;` is commented
`"pi_core" | "pi_agenta" | "claude"`; `sandbox?: string;` is commented `"local" | "daytona"`;
`deployment?: string;` is commented `"direct" | "azure" | "bedrock" | "vertex" | "custom"` — but
none of these are actually typed as unions, unlike `PermissionMode`/`ToolPermission` a few lines
above them, which *are* proper string-literal unions. This is an inconsistency within the same
file, not a blanket "everything should be a union" complaint: the authors clearly know how to do
this (and did, for the permission types) and just didn't apply it here. The practical cost is
every consumer of `request.harness`/`request.sandbox`/etc. gets `string` and has to
re-establish the invariant with runtime checks or comments instead of the compiler catching a
typo (`"clause"` instead of `"claude"`) at the call site. `version.ts`'s `HARNESSES` constant
(`["pi_core", "claude", "pi_agenta"] as const`) is *right there* as a ready-made literal union
source (`(typeof HARNESSES)[number]`) but `AgentRunRequest.harness` doesn't use it.
**Recommendation:** introduce literal unions for these fields (deriving from `version.ts`'s
`HARNESSES`/`ENGINES` where applicable), or — if forward-compat with an as-yet-unknown value is
a deliberate requirement — use the `SomeUnion | (string & {})` pattern to keep autocomplete
without losing openness. `ChatMessage.role` similarly could be
`"user" | "assistant" | "system" | "tool"`.
**Horizon:** medium (mechanical cleanup; touches the mirrored Python wire only if you also
change the shape, which you wouldn't here — purely a TS-side tightening).

### 10. [LOW/MEDIUM] `SESSION_ID_PATTERN`/`validateSessionId` exist but are never called from runner code
**File:** `src/sessions/contract.ts:83-89`.

`validateSessionId` is exported, has its own dedicated tests
(`tests/unit/session-redis-contract.test.ts:149-159`), and encodes a real invariant (max 128
chars, `[a-zA-Z0-9_-]` only — explicitly rejecting `"path/injection"` and `"has space"` in its
own test). But grepping the whole `src/` tree, nothing calls it: `server.ts` never validates
`request.sessionId` before using it to build URLs (`persistSandboxId` does
`encodeURIComponent(sessionId)`, which defuses URL-injection but not oversized/garbage ids) or
before handing it to the alive watchdog / persist chain / interactions calls. Either this
validation is meant to happen runner-side at the `/run` boundary (in which case it's a real gap
— a malformed `sessionId` flows all the way into heartbeat/persist/interactions calls before
anything downstream might reject it) or it's enforced API-side only and this function is dead
code that should be removed (or documented as "kept for parity/tests only").
**Recommendation:** either call `validateSessionId` at the top of the session-owned path in
`runAndStream` (reject cleanly, e.g. treat as a non-session run or 400) or delete the unused
export and its "guards against injection" framing if the API is solely responsible.
**Horizon:** short to confirm intent; the fix itself is small either way.

### 11. [LOW] `server.ts:195` non-null-asserts `sessionId` outside the guard that makes it safe, then re-guards it anyway
**File:** `src/server.ts:194-201`.

```ts
const sessionOwned = isSessionOwned(request);
const sessionId = request.sessionId!;
const turnId = resolveTurnId(request);
...
`[sessions] stream sessionOwned=${sessionOwned} sessionId=${sessionId ?? "-"} ...`
```
`sessionId` is force-unwrapped to `string` via `!`, then two lines later defended against
`undefined`/falsy with `?? "-"` as if it might still be missing — which, per the type, it can't
be, but per reality (an empty/whitespace `sessionId` makes `isSessionOwned` false while
`request.sessionId` is still `""` or `"   "`, not `undefined`) it demonstrates the assertion was
never really justified. It happens to be harmless today because the actual session-owned logic
below is gated on `sessionOwned`, not on `sessionId` truthiness directly. But the `!` plus the
immediate defensive `??` is a tell that the author didn't trust their own assertion — a future
edit that reads `sessionId` outside the `if (sessionOwned)` block (e.g., adding it to another
log line) inherits a lie the type system can no longer catch.
**Recommendation:** type it as `request.sessionId?.trim()` (or compute it only inside the
`if (sessionOwned)` block where it's actually used) instead of asserting non-null and then
re-guarding.
**Horizon:** short, trivial.

### 12. [LOW] Top-level catch-all in the HTTP listener returns the raw stack trace in the response body
**File:** `src/server.ts:351-355`.

```ts
} catch (err) {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  return send(res, 500, { ok: false, error: message });
}
```
This is distinct from the `AgentRunResult.error` field (which is part of the documented
contract and expected to carry rich detail back to the Python side) — this is the outer
listener's defensive catch for anything unexpected in request handling itself (e.g. a
`JSON.stringify` failure in `send()`, or a thrown error from `isAuthorized`). Returning
`err.stack` here leaks internal file paths and call structure over the wire. Bounded today by
the loopback bind + optional token, so not urgent, but "don't put stack traces in HTTP
responses" is a cheap habit to fix before this ships more broadly.
**Recommendation:** log `err.stack` to stderr, return `err.message` (or a generic message) in
the response body.
**Horizon:** short, trivial.

### 13. [LOW] `runAndStream` mixes session-coordination orchestration with response streaming in one ~90-line function
**File:** `src/server.ts:181-274`.

The function does, at one abstraction level: write HTTP headers, decide session ownership,
build an abort controller, wire disconnect handling, log a diagnostic, and then — at a much
lower level — infer an API base from telemetry headers and mutate `process.env` (finding 3),
start a watchdog, fire two best-effort side calls, build a persisting emitter, invoke the
engine, flush persistence, release the watchdog, and write the terminal record. It's readable
today because it's well-commented, but any of the "session-owned" branch's five side effects
(watchdog, stale-interaction cancel, sandbox-id persist, persisting emitter, credential
plumbing) is a plausible spot for the next bug, and none of them are independently testable
without going through the whole HTTP request.
**Recommendation:** extract a `beginSessionCoordination(request)` / `endSessionCoordination()`
pair (or a small class) that owns the watchdog + persistence + best-effort side calls, so
`runAndStream` itself reads as "stream the run, optionally coordinated."
**Horizon:** medium.

### 14. [LOW] Session-coordination `fetch` calls have no timeout — a hung API stalls the run's teardown
**File:** `src/sessions/alive.ts:54-87`, `src/sessions/persist.ts:36-73`,
`src/sessions/interactions.ts:52-119`, `src/sessions/auth.ts:18-35`.

None of these `fetch` calls pass an `AbortSignal`/timeout. They're individually swallowed on
error (fine), but `runAndStream`'s `finally` path does `await flushPersist()` before releasing
the alive lock — if the API is up but slow/hanging (not erroring), `drainPersist` can block on
an in-flight `postEvent` for however long the runtime's default fetch timeout is (undici's
default is on the order of minutes, not seconds), holding the HTTP response open and the alive
lock un-released for that whole window.
**Recommendation:** give these calls an explicit short timeout (a few seconds) via
`AbortSignal.timeout(...)`, consistent with the "never blocks the turn" framing already used in
the comments.
**Horizon:** medium.

### 15. [LOW] No concurrency cap/backpressure on `/run`, despite one being defined in the mirrored contract
**File:** `src/sessions/contract.ts:77` (`CONCURRENCY_CAP = 1000`), `src/server.ts` (whole
request listener).

`CONCURRENCY_CAP` is asserted against in a golden-fixture test
(`tests/unit/session-redis-contract.test.ts:144`) but is never read by any runner code path —
presumably it's enforced API-side (out of scope here), but the runner itself will start
executing any number of concurrent `/run`/`/stream` requests with no local queue or rejection,
each of which may spin up a real sandbox/subprocess. Combined with finding 5 (unbounded body
size), a burst of concurrent requests has no local circuit breaker.
**Recommendation:** at minimum, log/monitor concurrent in-flight count; consider a soft local
cap that returns 429 rather than accepting unbounded parallel runs on one sidecar process.
**Horizon:** long (this is a capacity-planning/backpressure feature, not a pre-launch fix).

### 16. [LOW] `GET /health` never checks reachability of its own dependencies
**File:** `src/version.ts:27-35`, `src/server.ts:299-301`.

`runnerInfo()` always returns `status: "ok"` — it reports the runner's own identity/version but
never probes whether the API (`apiBase()`) or Redis-backed coordination it depends on for
session-owned runs is reachable. An orchestrator's liveness/readiness probe (Kubernetes,
Compose healthcheck) can't distinguish "sidecar is up and fully functional" from "sidecar is up
but every session-owned run will 401/timeout against a dead API." Not necessarily wrong for a
liveness probe (a "don't restart me" signal, separate from an API dependency), but worth being
deliberate about which one this is meant to be.
**Recommendation:** if this is meant to double as a readiness probe, add an optional
dependency check (or a separate `/ready`); if it's meant purely as liveness, say so in the
comment so a future reader doesn't wire it to the wrong Kubernetes probe type.
**Horizon:** long.

## Top 10

1. **[HIGH]** `cli.ts` has no signal/shutdown handling at all — the subprocess transport can
   leak Daytona sandboxes on kill, the same bug class `server.ts` already fixed for itself.
   (`src/cli.ts`)
2. **[HIGH]** The HTTP shutdown handler sweeps in-flight sandboxes without first stopping new
   connections (`server.close()`), so a request racing the SIGTERM still leaks its sandbox.
   (`src/server.ts:378-430`)
3. **[HIGH]** `apiBaseFromRequest` mutates global `process.env.AGENTA_API_URL` from
   caller-supplied, per-request data, first-write-wins, untested — a real credential-routing
   risk in any deployment where `AGENTA_API_INTERNAL_URL` isn't set. (`src/server.ts:127-134,
   228-232`)
4. **[HIGH]** Server vs. CLI diverge on error shape for malformed JSON while streaming is
   requested — the "same contract" claim is untrue exactly where it matters most.
   (`src/server.ts:323-348` vs `src/cli.ts:55-62`)
5. **[MEDIUM]** No request body size cap on `/run`/`/stream` — unbounded memory buffering, no
   413. (`src/server.ts:285-291`)
6. **[MEDIUM]** `/kill` tears down every in-flight sandbox process-wide, not scoped to a
   session — confirm this matches the intended per-replica concurrency model.
   (`src/server.ts:303-312`)
7. **[MEDIUM]** `server.ts`/`cli.ts` duplicate the JSON-parse/NDJSON-assembly logic instead of
   sharing it — the root cause behind finding 4 and future drift. (`src/server.ts` +
   `src/cli.ts`)
8. **[MEDIUM]** `persist.ts`'s "record_index increments monotonically per session" comment
   doesn't match the per-turn-reset implementation — verify against the ingest endpoint's
   actual key. (`src/sessions/persist.ts:108-125`)
9. **[MEDIUM]** `protocol.ts` leaves `harness`/`sandbox`/`provider`/`connection.mode`/
   `deployment`/`credentialMode` as bare `string` despite documented finite value sets, while
   `PermissionMode`/`ToolPermission` right next to them are proper unions. (`src/protocol.ts`)
10. **[LOW/MEDIUM]** `validateSessionId` is fully built and tested but never called from any
    runner code path — confirm intent (dead code vs. missing boundary check).
    (`src/sessions/contract.ts:83-89`)
