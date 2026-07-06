# TS idioms & code-organization review — services/runner

Reviewer scope: code-level quality and file/module organization across all of `services/runner/src/`
(~10.6k lines, 46 files), plus `package.json` / `tsconfig.json` / `vitest.config.ts` hygiene.
Architecture, engine correctness, security, tracing semantics, and tests are other reviewers' lanes;
where a finding brushes those, it is framed strictly as a code-quality issue.

Date: 2026-07-05. Baseline: branch `gitbutler/workspace`.

---

## Strengths — keep this

This does not read like "a Python dev's first TypeScript". Credit where due:

1. **Discriminated unions are used where they matter.** `AgentEvent` (protocol.ts:303),
   `Verdict` (permission-plan.ts:60), `RenderHint` (protocol.ts:293), `StreamRecord`
   (protocol.ts:520), and `BuildRunPlanResult` (run-plan.ts:129) are exactly the Lars-Grammel
   shape: tagged unions at boundaries, exhaustively narrowable. `BuildRunPlanResult`
   (`{ok:true,plan}|{ok:false,error}`) is a proper result type instead of exceptions-as-control-flow.
2. **The dependency-injection seam pattern is consistent and disciplined.** `SandboxAgentDeps`
   (sandbox_agent.ts:247), `SignMountDeps`/`MountStorageDeps` (mount.ts), `BuildRunPlanDeps`
   (run-plan.ts:132), `createAgentServer(run)` / `runCli(raw, {run})` — every side-effecting module
   takes `deps = {}` with production defaults. This is the "make the core a library" idea applied
   at function granularity, and it is why the test suite runs without a live harness.
3. **Small single-purpose modules already exist where the code was refactored recently.**
   `pause.ts` (46 lines, one class), `spec-schema.ts` (one accessor + one walk, with a doc comment
   explaining the exact duplication it killed), `client-tool-relay.ts` (pure types), `entry.ts`
   (one function). The newer the file, the better the granularity — the trend line is right.
4. **Untrusted-input paranoia in the deep utilities.** `deepSet`/`deepMerge`/`resolveCtxToken`
   (direct.ts:52-158) reject `__proto__`/`constructor`/`prototype` and traverse own-keys only; the
   one `hasOwnProperty` dance in the codebase (direct.ts:143,154) is *justified*, not a Python-ism.
   `canonicalJson` (responder.ts:91) correctly rejects non-plain objects instead of collapsing them.
5. **Node idioms done right in the entrypoints:** `timingSafeEqual` for the token check with a
   written ReDoS analysis (server.ts:71-75), `isEntrypoint()` instead of a `require.main` hack,
   `unhandledRejection`/`uncaughtException` handlers installed only under the entrypoint guard,
   signal-handler idempotency (server.ts:388), `interval.unref()` so the watchdog can't hold the
   process open.
6. **Conditional-spread respect for optional properties** (`...(signal ? { signal } : {})`,
   relay.ts:154 `...(value.reason === undefined ? {} : {reason})`) — the codebase already mostly
   writes in the style `exactOptionalPropertyTypes` demands, which makes enabling it cheap.
7. **Comment quality is exceptional.** Nearly every non-obvious decision carries the *why* and the
   incident/finding ID (F-024, F-030, #4831…). This is a maintainability asset most codebases never have.
8. **The wire contract is compile-time pinned** (protocol.ts + golden fixtures + a TS key guard that
   fails `tsc` on drift). That is a real contract, not a convention.

The gaps below are mostly (a) the untyped ACP/SDK seam bleeding `any` inward, (b) missing validation
at the IO edges, (c) copy-paste helpers that have already started to diverge, and (d) a few big files
the refactor wave hasn't reached yet.

---

## Offenders table — `any` / `as` casts / non-null `!` per file (top 10)

Counts: explicit `: any` + `<any>` + `any[]` sites; `as` type assertions (excluding `as const`,
import aliases); non-null `!`.

| file | `any` sites | `as` casts | `!` | note |
|---|---:|---:|---:|---|
| tracing/otel.ts | 30 | 5 | 0 | every event/msg param is `any`; the single worst cluster |
| engines/sandbox_agent/acp-interactions.ts | 10 | 3 | 0 | `req: any`, `toolCall: any` throughout |
| engines/sandbox_agent/pi-assets.ts | 4 | 8 | 0 | `sandbox: any` + `(err as Error)` ×6 |
| engines/sandbox_agent/daytona.ts | 6 | 4 | 0 | `sandbox: any`, cookie-jar fetch `input: any` |
| engines/sandbox_agent.ts | 3 | 5 | 1* | `sandbox: any`, `session.onEvent((event: any))`, `(raced as any)?.stopReason` |
| engines/sandbox_agent/model.ts | 4 | 3 | 0 | `session: any`, `(o: any)`, `(c: any)` |
| engines/sandbox_agent/usage.ts | 4 | 0 | 0 | `sandbox: any`, `promptResult: any` |
| extensions/agenta.ts | 2 | 5 | 0 | `parameters: … as any`, `registerTool({...} as any)` |
| engines/sandbox_agent/provider.ts | 3 | 3 | 0 | `create: … as any`, `logMode as any` |
| server.ts | 0 | 3 | 1 | `JSON.parse(raw) as AgentRunRequest`, `request.sessionId!` |

Totals across src: **~68 `: any` sites, 12 `as any`, ~68 other `as` casts, 1 non-null `!`**
(sandbox_agent.ts:870 `(raced as any)` counted under `as any`). The single `!` (server.ts:195) is
also the riskiest one — see finding 8. For strict-mode TS written fast, one `!` in 10k lines is
genuinely good; the `any` mass is concentrated on one seam (the sandbox-agent/ACP SDK) and is
therefore fixable in one move (finding 2).

---

## Findings

### 1. No validation at the IO boundaries — `JSON.parse(...) as T` everywhere (HIGH, short)

The `/run` request body — the single most important input in the service, carrying secrets, tool
specs, and permission policy — is parsed and *cast*, never validated:

- server.ts:326 — `request = raw.trim() ? (JSON.parse(raw) as AgentRunRequest) : {};`
- cli.ts:57 — same cast on stdin.
- extensions/agenta.ts:249 — `specs = JSON.parse(raw)` into `ResolvedToolSpec[]` from an env var
  (no shape check at all; a malformed spec array crashes `registerTool` deep inside Pi).
- tools/relay.ts:419 — `JSON.parse(raw) as RelayRequest` (a file written by the sandbox child —
  an *untrusted* boundary per the module's own doc comment). `parsePermissionRelayResponse` shows
  the team knows how to hand-validate; the execute-request path just casts.
- mount.ts:76-87 — sign response cast to an inline shape; guarded by four field checks, decent but
  hand-rolled.
- sessions/auth.ts:29 — `(await res.json()) as { credentials?: string }`.

Downstream code compensates with defensive `?.`/`typeof` checks scattered everywhere (that is the
Python "EAFP + isinstance sprinkles" pattern in TS clothing). One zod schema per boundary deletes
dozens of those checks and turns garbage input into a 400 with a field path instead of a mid-run
`TypeError`.

**Fix:** add `zod` (this package is standalone; the dependency cost is contained). Define
`agentRunRequestSchema` next to protocol.ts and derive the type (`export type AgentRunRequest =
z.infer<...>`) so the wire contract and validator can never drift — the golden-fixture test then
pins the schema too. Priority order: (1) `/run` body in server.ts + cli.ts, (2) relay request files,
(3) the extension's `AGENTA_AGENT_TOOLS_PUBLIC_SPECS` env. Horizon: **short** for (1)–(2); the rest medium.

### 2. The untyped SDK seam bleeds `any` through the whole engine layer (HIGH, medium)

`sandbox: any` / `session: any` / `update: any` / `event: any` appear in **10 files**:
sandbox_agent.ts:419,717; capabilities.ts:71,121; model.ts:19,46; usage.ts:50; workspace.ts:14;
pi-assets.ts; daytona.ts:50,77; mount.ts:357 (this one, `SandboxExec`, is actually typed — the model
to copy); acp-interactions.ts:14,51; otel.ts:839,881 (`handleUpdate(update: any)`).

The `sandbox-agent` SDK presumably exports types; even if it doesn't (or they're too loose), the
runner touches maybe a dozen members. `mount.ts:357` already shows the right pattern — a minimal
structural interface (`SandboxExec.runProcess`). Nobody did it for the big handles.

**Fix:** one `src/engines/sandbox_agent/acp-types.ts` with minimal structural interfaces:
`SandboxHandle` (createSession, destroySandbox, dispose, getAgent, readFsFile, writeFsFile, mkdirFs,
runProcess), `SessionHandle` (id, prompt, onEvent, setModel, getConfigOptions, onPermissionRequest,
respondPermission), and a discriminated `AcpSessionUpdate` union
(`agent_message_chunk | agent_thought_chunk | tool_call | tool_call_update | usage_update` — the
five variants `handleUpdate` already branches on by string). That last union alone converts
otel.ts's 30 `any` sites into narrowed access and would have caught bugs like reading
`update.title || update.kind` at otel.ts:1116 on the wrong variant. Horizon: **medium** (1-2 days,
mechanical).

### 3. `exporterCache` grows unboundedly, keyed by a per-run ephemeral credential (HIGH, short)

tracing/otel.ts:71-90: `exporterCache` is a module-level `Map` keyed by
`endpoint + "\n" + authorization`. The authorization for session-owned runs is the invoke caller's
**ephemeral ~15-minute Secret token** — a new value nearly every run. Each miss constructs a new
`OTLPTraceExporter` (which owns an HTTP client) and caches it **forever**; `shutdown()` iterates the
cache but is only reachable via `TraceBatchProcessor.shutdown`, which the server never calls. In the
long-lived sidecar this is a slow memory + socket leak, and the "cache one exporter per distinct
endpoint+auth" comment is false in practice (hit rate ≈ 0).

**Fix (code-level):** don't cache on the credential — build the exporter per flush and `shutdown()`
it after export, or cache per endpoint and pass headers per export if the exporter API allows, or
add an LRU with eviction+shutdown. Horizon: **short**. (Flagging to the tracing reviewer as well.)

### 4. Global mutable state written from request data + no config module (HIGH, medium)

Two related problems:

- server.ts:229-231 mutates `process.env.AGENTA_API_URL` from the *request body*
  (`if (requestApiBase && !process.env.AGENTA_API_URL) process.env.AGENTA_API_URL = ...`). First
  request wins for the process lifetime; a multi-project sidecar silently pins every later session's
  API base to the first caller's. Writing process-global config from a request is the classic
  module-global Python-ism.
- **~45 `process.env` reads across 19 files** (extensions/agenta.ts 13, daemon.ts 9, server.ts 5,
  provider.ts 5, …). Some are read at module load and frozen (`REPLICA_ID` alive.ts:32,
  `RELAY_POLL_MS` relay.ts:57, `DAYTONA_PI_DIR` daytona.ts:15 — untestable without module-cache
  tricks), some per call — no rule for which. The repo's own convention exists for the Python API
  ("add env vars to `env.py`, never `os.getenv` directly" — root AGENTS.md); the runner has no
  equivalent.

**Fix:** `src/config.ts` exporting a typed, zod-validated `env` object (lazy getters where hot-reload
matters), and replace the env write in server.ts with an explicit `apiBase` parameter threaded to the
session helpers (they all already call `apiBase()` — give that function an injected override instead).
Exception: extensions/agenta.ts legitimately reads env (it runs inside the Pi process and env *is*
its wire) — give it its own tiny typed env reader. Horizon: **medium**.

### 5. `runSandboxAgent` is a 650-line orchestration function (HIGH, medium→long)

engines/sandbox_agent.ts:317-973. One function holds: mount signing, durable-cwd derivation, plan
build, env assembly, Claude connection env, Pi asset prep, sandbox start, Daytona asset push,
workspace prep with ENOTCONN retry, capability probe, MCP channel build, session create, model
apply, otel wiring, pause controller, permission responder wiring, client-tool relay, tool relay,
the prompt race, usage resolution, swallowed-error recovery, and an 8-step `finally`. It declares
**11 mutable `let`s** and three inline closure state machines (`mountLocalDurableCwd` /
`reSignAndRemountLocalCwd` / `remountLocalCwdAfterRuntimeEnotconn`, lines 433-491).

The extraction pattern is already established (run-plan.ts, workspace.ts, client-tools.ts were
clearly carved out of this file). Two more carves pay the most:

- **`durable-cwd.ts`**: the mount/remount lifecycle (sign → derive cwd → mount → ENOTCONN
  re-sign/remount → unmount) as an object with `ensureMounted()`, `onAcpEvent()`, `cleanup()` —
  it is a self-contained state machine currently interleaved with everything else.
- **`turn-wiring.ts`** (or fold into client-tools.ts): the responder/latch/pause/interaction wiring
  block (lines 710-835), which builds seven collaborators and knots them together.

Target: `runSandboxAgent` as a ~150-line phase script (plan → provision → wire → prompt → collect →
cleanup). Horizon: **medium** for the two carves; the full phase split is **long** (post-launch).

### 6. Copy-paste helpers, several already diverged (MEDIUM, short)

The grep-verified inventory:

| helper | copies | divergence |
|---|---|---|
| `runCredential(request)` | server.ts:122, sandbox_agent.ts:122 | one casts headers to `Record<string,string>`, one doesn't — same today, drift-bait |
| `readBody(req)` | server.ts:285, tool-mcp-http.ts:246 | **already diverged**: MCP copy enforces `MAX_BODY_BYTES`, the main `/run` copy is unbounded (see 7) |
| `isRecord` | relay.ts:338, permission-plan.ts:271 | identical |
| `errorMessage(err)` | cli.ts:32, acp-interactions.ts:331 | one returns `stack ?? message`, the other `message` only |
| `PAUSED` sentinel | pause.ts:7 (exported), relay.ts:130 (private duplicate) | two symbols for the same concept in one call chain |
| `INGEST_MAX_RETRIES` / `INGEST_RETRY_BASE_MS` | persist.ts:23, interactions.ts:40 | identical constants, two owners |
| `AbortSignal.any` feature-detect via `as any` | callback.ts:43, direct.ts:350 | identical — and unnecessary (see 11) |
| Pi builtin tool name list | permission-plan.ts:40 (`PI_BUILTIN_TOOL_IDENTITY`, canonical), run-plan.ts:166 (derived — good), extensions/agenta.ts:58 (**hard-coded second list**) | adding a Pi builtin now requires editing two lists; the extension one silently drifts |
| `type Log = (message: string) => void` | 9 definitions | identical |
| `function log(msg)` with hard-coded `[prefix]` | 6 definitions + ad-hoc `process.stderr.write` | see 13 |
| `messageText` | protocol.ts:525 (typed), otel.ts:294 (`msg: any` re-implementation) | the otel copy also handles a message object vs content — near-dup |

**Fix:** a small `src/internal/` (or `src/lib/`) with `guards.ts` (`isRecord`), `errors.ts`
(`errorMessage`), `http.ts` (`readBody(req, maxBytes)`), `logger.ts` (finding 13); export `PAUSED`
from pause.ts into relay.ts; move the builtin list to permission-plan and have the extension import
it (the extension is esbuild-bundled, so a src-internal import is free). Horizon: **short** — this
is an afternoon and removes real divergence risk before launch.

### 7. The main `/run` body read is unbounded while the loopback MCP body is capped (MEDIUM, short)

server.ts:285-291 accumulates the request body with no size cap; tool-mcp-http.ts:52 caps its
loopback-only endpoint at 1 MB with an explicit "cannot exhaust runner memory" comment. The
*internet-adjacent* endpoint has the weaker guard — backwards. Direct consequence of duplicate
`readBody` implementations (finding 6). **Fix:** one shared `readBody(req, {maxBytes})`, cap `/run`
generously (requests carry inline skills/tools; e.g. 32 MB via env-tunable). Horizon: **short**.

### 8. `request.sessionId!` asserts on a path where it is genuinely undefined (MEDIUM, short)

server.ts:195: `const sessionId = request.sessionId!;` executes for **every** streaming request,
including non-session ones where `sessionId` is `undefined`. The very next use (line 201) writes
`sessionId ?? "-"` — dead code under the `!`, and proof the author knows it can be undefined. The
value then flows into `runAndStream`'s session-owned block, where correctness silently depends on
the `if (sessionOwned)` guard being the only consumer. One future edit inside that function turns
this into `undefined` hitting `startAliveWatchdog(sessionId, ...)`.

**Fix:** make `isSessionOwned` a type-carrying narrowing instead:
`const session = request.sessionId?.trim() ? { id: request.sessionId, turnId: resolveTurnId(request) } : undefined;`
and branch on `session`. Deletes the `!`, the `?? "-"`, and the latent trap. Horizon: **short**.

### 9. Layering: a tools↔engines type cycle, and the extension's cross-process imports (MEDIUM, medium)

The implicit layering is good — `protocol.ts` (wire) ← `permission-plan/responder` (domain) ←
`tools/` + `sessions/` (adapters) ← `engines/` (orchestration) ← `server/cli` (entrypoints) — and
imports point inward almost everywhere. Two violations:

- **tools/mcp-bridge.ts:24 imports `McpServerHttp` from `engines/sandbox_agent/mcp.ts`, while
  engines/sandbox_agent/mcp.ts:7 imports `buildToolMcpServers` from tools/mcp-bridge.ts.** A
  tools→engines dependency (wrong direction) forming a cycle (type-only, so it runs, but `tsc`
  layering intent is gone). `McpServerHttp` is an ACP wire shape — it belongs beside the other
  shared types (protocol.ts or the new acp-types.ts from finding 2), which breaks the cycle and
  fixes the direction in one move.
- **extensions/agenta.ts imports `../tracing/otel.ts` and `../tools/dispatch.ts`** — but this file
  is esbuild-bundled and executes inside the *Pi process*, not the runner. It therefore drags
  runner modules (including otel.ts's module-level provider/exporter singletons and dispatch's
  sync-fs relay client) across a process boundary. It works because those modules are ambient-free
  enough, but nothing marks them as "must stay bundle-safe". At minimum add a header comment
  contract to otel.ts/dispatch.ts/spec-schema.ts ("bundled into the Pi extension — no top-level
  side effects, no Node-server-only imports"); better, move the shared parts (relay client,
  spec-schema, the Pi tracer) into an `src/shared-with-extension/` (or `extension-runtime/`) layer
  the bundle and the runner both import, so the boundary is visible in the tree. Horizon: **medium**.

Also: sandbox_agent.ts:111-115 and relay.ts:50-53 keep "compatibility re-exports" for moved symbols;
tests still import `buildTurnText` via the engine barrel (tests/unit/continuation.test.ts:14).
Finish the migrations and delete the re-exports — they are how import graphs rot. **short**.

### 10. File-naming convention split: `snake_case` vs `kebab-case` vs `camelCase` (MEDIUM, short)

`engines/sandbox_agent.ts` + the `engines/sandbox_agent/` dir are Python-style snake_case; every
other multiword file is kebab-case (`tool-mcp-http.ts`, `client-tool-relay.ts`, `permission-plan.ts`,
`run-plan.ts`); `apiBase.ts` is camelCase. Inside the code, naming is clean (no snake_case
identifiers outside deliberate wire fields like `args_into`/`session_id`, which are documented).
**Fix:** rename `sandbox_agent` → `sandbox-agent` and `apiBase.ts` → `api-base.ts` now, while the
import count is small and there's no downstream consumer of paths. Horizon: **short** (mechanical;
do it before launch or accept it forever).

### 11. AbortSignal propagation: good spine, three gaps + one obsolete polyfill (MEDIUM, short/medium)

The spine is right: HTTP disconnect → `AbortController` → `runSandboxAgent(signal)` →
`SandboxAgent.start({signal})`. Gaps:

- **Obsolete feature-detection:** callback.ts:43 and direct.ts:350 do
  `const anyOf = (AbortSignal as any).any` with a fallback. `AbortSignal.any` is native since Node
  20.3 and typed in @types/node 24 — the package pins Node 24. Replace both with
  `AbortSignal.any([signal, timeoutSignal])`, deleting two `as any`. **short**
- `startToolRelay` (relay.ts:399) has no signal; cancellation is a bespoke `active` flag +
  `stop()`. Fine, but the in-flight `handle()` executions it spawns get no signal either, so a
  caller abort waits out `TOOL_CALL_TIMEOUT_MS` per in-flight call. Thread `signal` through
  `executeRelayedTool` → `callAgentaTool`/`callDirect` (they already accept one). **medium**
- tool-mcp-http.ts:68-73 documents its own gap ("threading this signal into dispatch is a known
  follow-up") — the abort destroys sockets but lets `runResolvedTool` run to completion. Same
  threading fixes it. **medium**
- No floating-promise bugs found by inspection — the codebase is diligent with `void` + `.catch()`
  on fire-and-forget (server.ts:240-246, sandbox_agent.ts:760, pause.ts:26) and the tricky
  `promptPromise.catch(() => {})` before `Promise.race` (sandbox_agent.ts:858-861) is exactly
  right. But nothing *enforces* this — one missed `.catch` on a fire-and-forget is an
  `unhandledRejection` log at best. That's the eslint case (finding 19/tooling).

### 12. Sync fs on the runner's hot loops (MEDIUM, medium)

- relay.ts:165-177 (`localRelayHost`): `readdirSync`/`readFileSync`/`writeFileSync` wrapped in
  `async` arrows, called from the poll loop every 300 ms for the whole turn — each call blocks the
  event loop of the single-threaded sidecar that is simultaneously serving other runs' streams.
  Small files, so it's latency noise today, but it's on a FUSE-adjacent path where a stall (ENOTCONN,
  slow S3) freezes the **entire process**, not just this run. This is the strongest "sync fs in an
  async server" case in the codebase.
- pi-error.ts:99-140 (`findSwallowedPiError`): synchronously `readdirSync` + `readFileSync` **every
  transcript of every Pi session on the host** on the request path (reads whole files to check line 1,
  then re-reads the match). O(sessions × transcript size) of event-loop blocking per empty-output
  Pi run; the sessions dir only grows.

The `RelayHost` interface is already async — only the local implementation cheats. **Fix:** swap to
`node:fs/promises` in `localRelayHost` and pi-error.ts (and cap the pi-error scan to N most-recent
dirs by mtime). Note the *deliberate* sync fs in dispatch.ts:66-108/`relayPermissionCheck` runs
inside the Pi child process, not the runner — leave it. Horizon: **medium**.

### 13. Three logging patterns coexist; no levels; two debug gates (MEDIUM, short)

- Pattern A: per-module `function log(msg)` with a hard-coded prefix — 6 copies
  (`[sandbox-agent]`, `[agenta-pi-ext]`, `[sessions/auth]`, `[sessions/alive]`,
  `[sessions/interactions]`, `[sessions/persist]`, `[sandbox_agent/mount]`).
- Pattern B: raw `process.stderr.write("[tag] ...")` inline — server.ts ×8, relay.ts:325, others.
- Pattern C: `console.error` — direct.ts:372,383 and the `dbg` gate in callback.ts:47 (the only
  place a *debug level* exists, via `AGENTA_RUNNER_DEBUG_TOOLS`, also checked in client-tools.ts:223).

No levels, no way to silence heartbeat spam (alive.ts logs every OK heartbeat, persist.ts logs every
ingest OK — that's a log line per event per session at INFO-equivalent), and greppable tags are
inconsistent. stdout discipline (reserved for CLI JSON) is the one rule everyone did follow.

**Fix:** one `src/internal/logger.ts`: `createLogger(tag)` returning `{debug, info, warn, error}`,
stderr-only, level from `AGENTA_RUNNER_LOG_LEVEL`, `debug` folding in the existing
`AGENTA_RUNNER_DEBUG_TOOLS`. Mechanical adoption (every module already funnels through a local
`log`). Horizon: **short**.

### 14. Type-level nits that cost narrowing (LOW→MEDIUM, short)

- protocol.ts:13 — `type: "text" | "image" | "resource" | "tool_call" | "tool_result" | string`:
  the trailing `| string` collapses the union to `string`; no narrowing, no completion, no typo
  protection. Use the standard `| (string & {})` trick to keep completions, or split
  `KnownContentBlockType` from the open wire type.
- protocol.ts:369/374 — `harness?: string; sandbox?: string` on the wire is a deliberate
  open-world choice (fine), but the *internal* `RunPlan.acpAgent` (run-plan.ts:73) stays `string`
  even though the whole engine branches on `"pi" | "claude"`; `version.ts:15` already has
  `HARNESSES` as a const tuple — derive `type Harness = (typeof HARNESSES)[number]` and use it
  internally so the assert at run-plan.ts:262 becomes a compile-time exhaustiveness check.
- sessions/alive.ts:123-125 — `(interval as unknown as { unref?: () => void }).unref` is
  unnecessary: `setInterval` returns `NodeJS.Timeout` (typed `unref()`) under `types: ["node"]`.
  Delete the double cast.
- cli.ts:47 — `runCli(raw, stream, io)` boolean-trap positional; fold `stream` into the options
  object (`runCli(raw, {stream, run, write})`). Call sites: 2.
- responder.ts:111 — `.sort(([a],[b]) => (a < b ? -1 : ...))` — fine, but `localeCompare` is a
  footgun here and correctly avoided; leave as is (noted so nobody "fixes" it).

### 15. `tracing/otel.ts` is four modules in one 1315-line file (MEDIUM, medium)

Contents: (1) process-wide export infrastructure (`TraceBatchProcessor`, exporter cache,
`ensureProvider`, `orderParentFirst`) lines 57-235; (2) the Pi-extension tracer `createAgentaOtel`
lines 404-639; (3) the ACP-stream tracer `createSandboxAgentOtel` lines 806-1315; (4) pure text
utilities — the pi-acp startup-banner stripper and streaming splitter (`isBannerLine`,
`stripStartupBanner`, `splitLeadingBanner`, lines 697-796) which have *nothing* to do with OTel and
are unit-tested independently. The two tracers also share duplicated attribute-stamping blocks
(`stampUsage` vs the inline block at 614-625; two `invoke_agent` start blocks).

**Fix:** split into `tracing/export.ts` (infra), `tracing/pi-otel.ts`, `tracing/acp-otel.ts`,
`tracing/banner.ts` (pure), and a shared `tracing/attrs.ts` for the GenAI attribute stamping. The
banner utilities move first — zero-risk, and they're the part streaming code imports. Note the
bundle-safety constraint from finding 9 (pi-otel + export are compiled into the extension).
Horizon: **medium**.

### 16. Error-handling patterns: 4 coexisting, mostly coherent, two rough edges (LOW→MEDIUM)

Inventory: (a) result objects at boundaries (`{ok,error}`, `BuildRunPlanResult`) — good; (b) thrown
plain `Error`s inside, converted at each edge — consistent, though there are **zero Error
subclasses**, so edge code discriminates by regex on messages (errors.ts:47-52 matching
"credit balance is too low|401|unauthorized"; isTransportEndpointDisconnected matching "ENOTCONN"
in strings) — brittle, and a `RunnerError extends Error` with a `code` field would let
`conciseError` switch on codes with the regexes as fallback for foreign errors only; (c) sentinel
symbols for the pause outcome — **three of them** (pause.ts `PAUSED`, relay.ts's private `PAUSED`,
tool-mcp-http.ts `MCP_PAUSED`) expressing one concept; `executeRelayedTool` returns
`string | typeof PAUSED` where a small union `{kind:"text",text} | {kind:"paused"}` would be
self-documenting and mergeable; (d) `assert()` invariants (capabilities.ts:41) — good and
well-scoped. **Fix:** short: unify the PAUSED symbols (export one). Medium: introduce
`RunnerError{code}` for the classes `conciseError`/ENOTCONN-detection sniff for.

### 17. Dead exports and a booby-trapped tombstone file (LOW→MEDIUM, short)

Verified by cross-referencing src+tests (false-positive caveat: option-bag interfaces of exported
functions are legitimately exported; excluded below):

- Value exports referenced nowhere outside their own module (knip would flag): `persistEvent`
  (persist.ts:80), `allowedModels` (model.ts:19), `validateUserMcpUrl` (mcp.ts:78),
  `installPiInSandbox` (daytona.ts:50), `DAYTONA_PI_VERSION`, `EXTENSION_BUNDLE`,
  `installPiExtensionLocal`, `installSkillsLocal` (pi-assets.ts), `advertisedToolSpec`
  (public-spec.ts:24), `createRequestListener` (server.ts:294), `SESSION_ID_PATTERN`,
  `makeDisplacementPayload`, `displacedChannel`, `ownerKey`… (contract.ts — deliberate
  contract mirrors, keep), `RELAY_POLL_IDLE_GROW_AFTER` (relay.ts). Several are "exported for
  symmetry"; demote to module-private or add a `// exported for tests` marker once knip is in CI.
- **tools/mcp-server.ts is a tombstone that executes `process.exit(1)` at module top level.** Any
  future accidental `import "./mcp-server.ts"` (a barrel, a test glob, an IDE auto-import) kills
  the process at import time with a one-line stderr message. If the tombstone must stay, make it
  `throw new Error(...)` inside an entrypoint guard (`if (isEntrypoint(...))`), or just delete the
  file — git history remembers. **short**

### 18. Package/tsconfig hygiene (MEDIUM, short)

- **Both `pnpm-lock.yaml` and `package-lock.json` are committed.** The npm lockfile is drift bait
  (it will silently disagree with the pnpm one) and contradicts the package's own AGENTS.md
  (pnpm-only, own lockfile). Delete `package-lock.json`; add `"packageManager"` is already set —
  also consider a root `.npmrc` `engine-strict=true`.
- **No `"engines"` field** despite hard Node-24 assumptions (native `AbortSignal.any`,
  `Array.findLastIndex`, `fetch`). Add `"engines": {"node": ">=24"}`.
- Version pinning is inconsistent without a policy: exact (`undici 8.3.0`, `tsx 4.19.2`,
  OTel `1.28.0`, `sandbox-agent 0.4.2`, `pi-coding-agent 0.79.4`) vs caret (`@daytonaio/sdk`,
  `@zed-industries/claude-agent-acp`, `typescript`). The pins on harness/OTel packages look
  deliberate (wire-compat sensitive) — write the policy down in one comment or pin everything;
  a caret on `claude-agent-acp` is exactly the kind of dependency the pins elsewhere guard against.
- tsconfig: see finding 19 for flags. Also `lib: ["ES2023"]` with `target: "ES2022"` is fine but
  `ES2024` lib matches Node 24 better (e.g. `Object.groupBy`, `Promise.withResolvers` are available
  at runtime but not typed).

### 19. Missing strictness flags — measured cost (MEDIUM, short→medium)

Currently on: `strict` only (plus the module/interop set). Not on, ranked by value here:

| flag | what it would catch here | est. cost |
|---|---|---|
| `noUncheckedIndexedAccess` | `lines[i]` in `splitLeadingBanner`/`stripStartupBanner` (otel.ts:742,775-795), `messages[i]` (protocol.ts:539-543, transcript.ts:20), `raw.split("\n")[0]` (errors.ts:44), `parts[parts.length-1]` (direct.ts:71) — exactly the off-by-one surface of the trickiest code (the streaming banner splitter) | ~30-50 errors, 0.5-1 day; highest value |
| `exactOptionalPropertyTypes` | drift between `x?: T` and `x: T \| undefined` on the wire types; the codebase already writes conditional-spread style, so mostly clean | ~10-20 errors, half day |
| `noUnusedLocals` / `noUnusedParameters` | the `_req` (server.ts:182), `_harness` (daemon.ts:133) conventions already anticipate it | near-zero (underscore convention holds) |
| `noFallthroughCasesInSwitch`, `noImplicitOverride`, `noImplicitReturns` | hygiene; almost no switches today | free |
| `verbatimModuleSyntax` | already using `import type` consistently; locks it in | near-zero |

Recommendation: turn on everything except `noUncheckedIndexedAccess` immediately; schedule that one
as its own PR (it will touch the banner splitter — do it with the unit tests green).

### 20. Module-global mutable state constrains "the core as a library" (LOW, long)

`persistChains` (persist.ts:31), `traceTargets`/`exporterCache`/`provider` (otel.ts:68-163),
`inFlightSandboxes` (sandbox_agent.ts:150), `REPLICA_ID` (alive.ts:32). All documented, all
correct today — but they mean two `createAgentServer()` instances in one process share hidden
state, and tests depend on module-cache isolation. The Hashimoto move is a `RunnerRuntime` object
(created in the entrypoint, holding persist chains, in-flight registry, tracer provider) threaded
through the existing `deps` seams — the seams already exist, so this is wiring, not redesign.
Horizon: **long** (post-launch, alongside finding 5's phase split).

---

## Top 10 by payoff-per-effort

1. **Adopt eslint (flat config below) with `no-floating-promises` + strict-type-checked** — locks in
   the discipline the code already mostly has; catches the one class of async bug nothing guards today. (hours)
2. **Delete `package-lock.json`; add `"engines": {"node": ">=24"}`** — two-line drift/footgun removal. (minutes)
3. **zod-validate the `/run` body in server.ts + cli.ts** (finding 1) — the highest-blast-radius
   unvalidated input; schema doubles as wire documentation. (half day)
4. **Fix `request.sessionId!` narrowing + cap `/run` `readBody`** (findings 7, 8) — two latent
   production traps, both minutes to fix. (hour)
5. **Dedupe the helper inventory into `src/internal/`** (finding 6) — kills already-observed
   divergence (readBody, errorMessage, builtin list) before it bites. (half day)
6. **`acp-types.ts` structural interfaces for sandbox/session/update** (finding 2) — converts ~50
   of the 68 `any` sites into checked code in one mechanical pass. (1-2 days)
7. **Exporter-cache eviction in otel.ts** (finding 3) — a real leak in a long-lived process. (hours)
8. **One logger module with levels** (finding 13) — mechanical, silences heartbeat spam, makes the
   debug gate uniform. (half day)
9. **Turn on the cheap tsconfig flags now; `noUncheckedIndexedAccess` as its own PR** (finding 19). (half day + 1 day)
10. **knip in CI + delete/disarm the mcp-server.ts tombstone + native `AbortSignal.any`**
    (findings 11, 17) — dead-code hygiene and two `as any` deleted. (hours)

Deliberately below the line: the runSandboxAgent phase split (5) and otel.ts split (15) are the
right *medium* refactors but should not gate launch; the file renames (10) should happen now or never.

## Recommended eslint setup

```jsonc
// package.json devDependencies to add:
// "eslint": "^9", "typescript-eslint": "^8", "eslint-plugin-import-x": "^4" (optional), "knip": "^5"
```

```js
// eslint.config.js (flat)
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "coverage/", "tests/results/"] },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // The two rules that pay for the whole setup:
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }], // `void fn()` stays legal fire-and-forget
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false } }],

      // Ratchet, don't block: the SDK seam makes these warnings until acp-types.ts lands.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",

      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-non-null-assertion": "error", // there is exactly 1; fix it and lock the door
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true, allowBoolean: true }],

      // Config-module enforcement (finding 4): whitelist src/config.ts (and the extension) via overrides.
      "no-restricted-properties": ["error", {
        object: "process", property: "env",
        message: "Read config through src/config.ts, not process.env directly.",
      }],
      "no-console": ["error", { allow: [] }], // stderr logger only (finding 13)
    },
  },
  {
    // The Pi extension legitimately reads env (env IS its wire), and config.ts is the one reader.
    files: ["src/config.ts", "src/extensions/**", "src/apiBase.ts"],
    rules: { "no-restricted-properties": "off" },
  },
  {
    files: ["tests/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
```

```jsonc
// knip.json
{
  "entry": ["src/server.ts", "src/cli.ts", "src/extensions/agenta.ts", "scripts/build-extension.mjs"],
  "project": ["src/**/*.ts"],
  "ignoreExportsUsedInFile": true
}
```

CI: `pnpm exec eslint . --max-warnings 200` initially (the unsafe-* warnings from the `any` seam),
ratcheting the cap down as acp-types.ts lands; `knip` as a non-blocking report first week, then blocking.
