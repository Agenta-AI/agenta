# Runner replicas: research map of the current mechanisms

Issue: Agenta-AI/agenta#7322. Goal of the design that follows this research: option B, make the
runner pods interchangeable, so any runner pod can continue, cancel or kill any session.

This document records facts. It does not design. Every claim about code cites `path:line`
in this checkout (`origin/main` as of 2026-10-05). Claims I could not verify are marked
"unverified". All paths are relative to the repository root.

## Vocabulary

Each term is defined once here and used with one meaning after that.

- **runner**: the Node.js service in `services/runner`. One pod runs one Node process. It
  listens on port 8765 (`services/runner/src/config/runner-config.ts:76`). It drives agent
  harnesses and persists session records through the api. It holds no database client.
- **harness**: the agent program (Pi, Claude Code, Codex). The runner talks to it over ACP
  (Agent Client Protocol), a JSON-RPC protocol.
- **sandbox**: a Daytona virtual machine. Daytona is a cloud provider of sandboxes. The
  runner creates, stops, starts and deletes sandboxes through the Daytona API.
- **sandbox-agent**: a daemon that runs inside a Daytona sandbox on port 3000
  (`services/runner/src/engines/sandbox_agent/provider.ts:29`). It spawns the harness and
  proxies ACP to the runner over HTTP. The runner holds a client handle to it.
- **Daytona path**: the `daytona` sandbox provider. The harness runs inside the sandbox.
- **in-process path**: the `inprocess` sandbox provider. The Pi harness runs inside the runner
  process. Only shell and file tools run in a Daytona "command sandbox"
  (`services/runner/src/config/runner-config.ts:16-19,48`).
- **keepalive**: the runner keeps an environment alive between turns of one session, so the
  next message continues the same harness process (`services/runner/src/engines/sandbox_agent/session-pool.ts:1-13`).
- **SessionPool**: the in-memory map of kept-alive environments. One pool per provider
  (`services/runner/src/server.ts:423-432`).
- **LiveSession**: one entry of a SessionPool (`session-pool.ts:31-60`).
- **SessionEnvironment**: the object a LiveSession holds. It wraps the sandbox handle, the
  ACP session handle, and the per-turn state (`services/runner/src/engines/sandbox_agent/runtime-contracts.ts:319-542`).
- **park**: to put a SessionEnvironment into the SessionPool after a turn, as `idle` or as
  `awaiting_approval` (`session-pool.ts:25`).
- **turn**: one execution of one user message. The api mints the turn id (`turn_id`) on the
  send path. The runner mints it when the request carries none (`server.ts:257-259`).
- **replica id**: `REPLICA_ID`, one string per runner process (`services/runner/src/sessions/alive.ts:47-48`).
- **owner key**: the Redis key `owner:<project_id>:session:<session_id>` that names the
  replica that serves a session (`api/oss/src/dbs/redis/sessions/contract.py:90`).
- **coordination plane**: the api's Redis keys `alive`, `running`, `attached`, `owner`,
  `superseded`, `started` and the `session_streams` row that mirrors them
  (`api/oss/src/core/sessions/streams/service.py:1-13`).

## Facts the designer must not get wrong

1. The runner has no Redis client and no Postgres client. It reaches the coordination plane
   only through the api over HTTP (`services/runner/src/sessions/alive.ts:13`;
   `services/runner/package.json` lists no redis or pg package). The Helm chart gives the
   runner no `REDIS_URI*` variable (`hosting/kubernetes/helm/templates/runner-deployment.yaml:73-77`).
2. `REPLICA_ID` is `AGENTA_RUNNER_REPLICA_ID` or a random UUID per process
   (`alive.ts:47-48`). The chart sets the variable only when `replicas == 1`
   (`runner-deployment.yaml:101-111`). With two pods each pod has a random id that changes on
   every restart.
3. The owner key lives in the volatile Redis (no persistence), has a 120 second TTL, and the
   claim script never steals from a different live replica
   (`api/oss/src/dbs/redis/sessions/contract.py:337-352`; `api/oss/src/utils/env.py:1869`).
   Only a beat of a running turn refreshes it. A parked session's owner key expires.
4. The api and the services layer reach the runner through one URL,
   `AGENTA_RUNNER_INTERNAL_URL`, which in Kubernetes is one ClusterIP Service with no session
   affinity (`hosting/kubernetes/helm/templates/_helpers.tpl:345-365`;
   `hosting/kubernetes/helm/templates/runner-service.yaml`). `/cancel` on the wrong pod
   returns 404 (`server.ts:1586-1591`). `/kill` on the wrong pod returns 200 and destroys
   nothing (`server.ts:1515-1530`).
5. There are two different "warm" states on the Daytona path. In-pool warm: the sandbox is
   running and the ACP session is open in the pod. Stopped-parked: the pod evicted the entry,
   stopped the sandbox, and the next turn reconnects by id (`services/runner/src/environment/sandbox-lifecycle.ts:62-125,156-200`).
   Only the second state survives a pod loss.
6. The reconnect ladder already rebuilds a usable handle on a fresh pod from two durable ids:
   `session_turns.sandbox_id` and `session_turns.agent_session_id`
   (`sandbox-reconnect.ts:69-83`; `session-continuity-durable.ts:143-190`;
   `environment.ts:1494-1547`). It handles a sandbox that is still running
   (`daytona-provider.ts:304-307`).
7. A parked approval cannot be resumed from another pod. The resume needs `permissionId` and
   `promptPromise`, which belong to the open ACP session in the pod
   (`runtime-contracts.ts:212-227`). The durable fallback is the interaction row plus
   `loadDurableDecisions`, after which the model re-issues the call on a cold turn
   (`services/runner/src/sessions/interactions.ts:432-452`).
8. On the in-process path a second pod can already continue a session cold today. The Pi
   transcript is saved to the object store after every turn and restored before a session
   opens (`services/runner/src/engines/inprocess/workspace/transcript-store.ts:1-18`). A
   command sandbox belongs to the runner that created it and is never adopted
   (`services/runner/src/engines/inprocess/sandbox/command-sandbox.ts:5-11`).
9. The only cleanup for a sandbox that a dead pod leaves behind is Daytona's own autostop
   (15 minutes) and autodelete (30 minutes) (`provider.ts:117-122`;
   `runner-config.ts:72-73`).
10. `session_turns` is append-only. The latest row is the pointer. Native continuation is
    trusted only when that row has `end_time` (`session-continuity-durable.ts:172-180`).
11. Admission is the first heartbeat's `nx` acquire on the api. It is the single arbiter of
    "who runs this session" (`alive.ts:285-293`). It fails open on a network error, and the
    `busy` pool entry is the pod-local backstop for that window
    (`services/runner/src/lifecycle/session-coordinator.ts:1371-1389`).
12. A heartbeat-based cancel already works from any pod. The api deletes `alive` and `running`,
    the runner's next beat reads `is_current_turn: false` and aborts. Latency is up to 30
    seconds (`streams/service.py:341-369`; `alive.ts:326-337`; `server.ts:779-789`). The
    direct `/cancel` is immediate but pod-specific.
13. Daytona Secret ownership is process-local. A pod crash orphans the Secrets until Daytona's
    autodelete backstop (`provider.ts:244-248`).
14. The api DAO has `claim_commands`, a routing input of "sessions the caller holds warm", but no
    route or adapter calls it (`api/oss/src/dbs/postgres/sessions/commands/dao.py:446-458`;
    grep of `api/oss/src/apis` finds no caller). The control adapter default is `direct`
    (`env.py:687`).
15. The "records incomplete" marker that stops a pod from rebuilding model context from a log
    with a hole is in-memory only (`services/runner/src/sessions/persist.ts:213-228`).

## 1. How a turn reaches the runner today

### 1.1 The send path, step by step

1. The browser posts `POST /sessions/streams/` with inputs and no `force`
   (`api/oss/src/apis/fastapi/sessions/router.py:432-446`, handler `set_session_stream`
   at `:510`). The route stamps `arrived_at_ms` from Redis time (`:516`).
2. `SessionStreamsService.command` derives mode `send` (`streams/service.py:148-163,307`). It
   refuses when `alive` is held (`:308-312`). `_start_turn` mints `turn_id = uuid7()`,
   acquires `alive` and `running` under that turn id, and creates or updates the
   `session_streams` row (`:1194-1297`).
3. Someone invokes the workflow service with the turn id. Two callers exist.
   - The api's `invoke_workflow_detached` puts `run_id`, `project_id` and, for a continuation,
     `control_command_id` into `request.meta` and streams `{service_url}/invoke`
     (`api/oss/src/core/workflows/service.py:3295-3345`).
   - A code comment says the playground posts a turn straight to the services `/invoke`
     (`sdks/python/agenta/sdk/agents/handler.py:541-546`). I did not trace the browser code
     for this path. Unverified which caller the playground uses for a plain send.
4. The services app `services/oss/src/agent/app.py:114-128` hands the request to the SDK
   handler `make_agent_handler`. `select_backend` builds `SandboxAgentBackend(url=runner_url())`
   (`app.py:73-92`). `runner_url()` reads `AGENTA_RUNNER_INTERNAL_URL`
   (`services/oss/src/agent/config.py:62-65`).
5. The SDK handler builds `SessionConfig` with `session_id`, `detached`,
   `turn_id = meta.run_id`, `project_id = meta.project_id`,
   `control_command_id = meta.control_command_id` (`handler.py:555-563`).
6. The SDK HTTP transport posts `{base}/run` with `Accept: application/x-ndjson` and the
   runner token headers (`sdks/python/agenta/sdk/agents/utils/ts_runner.py:189-197`). The
   wire body carries `sessionId`, `detached`, `turnId`, `controlCommandId`
   (`sdks/python/agenta/sdk/agents/wire_models.py:557-565`).
7. The runner's `/run` handler (`server.ts:1603-1654`) calls `runAndStream` (`:542`). For a
   session-owned run (`sessionId` present, `:248-250`) it starts the alive watchdog whose
   first beat is the admission (`:774-828`), registers the execution (`:961-967`), wraps the
   emitter with the persisting emitter (`:999-1053`), then calls `run` which is `runAgent`
   (`:439-496`). `runAgent` dispatches to `runWithKeepalive` with the provider's pool
   (`:449-484`).

### 1.2 Every runner endpoint, its caller, and where the session identity rides

| Endpoint | Code | Caller | Session identity |
|---|---|---|---|
| `GET /health` | `server.ts:1459` | Kubernetes probes (`runner-deployment.yaml:211-232`), compose healthcheck | none |
| `GET /subscription-status` | `server.ts:1465-1470` | services `services/oss/src/agent/runtime_status.py:186-196` | none |
| `POST/GET/DELETE /subscription-login/attempts[/{id}]` | `server.ts:1476-1481,1271-1330` | api `api/oss/src/core/secrets/subscription_login.py:102` | attempt id in path; attempt lives in the pod's memory (`subscription-login-attempts.ts:10-14`) |
| `POST /kill` | `server.ts:1483-1531` | api `streams/service.py:455` via `runner_client.py:32-64` | body `{sessionId, projectId}` |
| `POST /cancel` | `server.ts:1533-1599` | api `api/oss/src/dbs/http/sessions/control_delivery_direct.py:96-103` via `runner_client.py:98-170` | body `{commandId, projectId, sessionId, targetTurnId, createdAt}` |
| `POST /stream`, alias `POST /run` | `server.ts:1603-1654` | services through the SDK (`ts_runner.py:189`) | body `sessionId`, `turnId`, `controlCommandId`, `runContext.project.id` |

No header carries session identity. The only headers are `Authorization: Bearer <token>` or
`X-Agenta-Runner-Token` (`server.ts:198-221`), and `Accept`.

### 1.3 Runner-to-api calls (the reverse direction)

The runner calls the api at `apiBase()`, which is `AGENTA_API_INTERNAL_URL`, then
`AGENTA_API_URL`, then the base inferred from the request's telemetry endpoint, then
`http://api:8000` (`services/runner/src/apiBase.ts:20-29`). The calls:

- `POST /sessions/streams/heartbeat` (`alive.ts:161`, `:240`, `:426`). Body
  `{session_id, replica_id, turn_id, is_running, name?, references?}` or `release_owner: true`.
- `POST /sessions/control/commands/{id}/outcome` (`control-channel.ts:294`, `:344`).
- `POST /sessions/turns/query`, `POST /sessions/turns/`, `POST /sessions/turns/complete`
  (`session-continuity-durable.ts:104`, `:240`, `:203`).
- `POST /sessions/interactions/`, `/transition`, `/cancel-stale`, `/query`
  (`interactions.ts:150`, `:197`, `:234`, `:322`).
- `POST /sessions/records/ingest` (`persist.ts:91`).
- Mount signing (`environment.ts:307-322` calls `signSessionMountCredentials`).

### 1.4 Where the runner URL appears

The runner base URL variable is `AGENTA_RUNNER_INTERNAL_URL`. No other runner URL variable
exists (searched `api/`, `services/`, `hosting/`, `sdks/`, `web/`).

- Read: `api/oss/src/utils/env.py:1572` (`env.runner.internal_url`), `services/oss/src/agent/config.py:62-65`,
  `sdks/python/agenta/sdk/agents/handler.py:109`.
- Consumed in api: `api/oss/src/core/sessions/streams/runner_client.py:38,114`,
  `api/oss/src/core/secrets/subscription_login.py:102`.
- Consumed in services: `services/oss/src/agent/app.py:90`, `services/oss/src/agent/runtime_status.py:186`.
- Set by Helm: `_helpers.tpl:345-347` (Service name `<fullname>-runner`), `:349-356` (URL),
  `:358-365` (env block), included at `api-deployment.yaml:93` and
  `services-deployment.yaml:99`. Override: `agentRunner.externalUrl` (`values.schema.json:367-368`).
- Set by compose: `http://runner:8765` for api and services in all seven compose files, for
  example `hosting/docker-compose/oss/docker-compose.dev.yml:173` (api) and `:425` (services).
- Set by Railway: `hosting/railway/oss/template/template.json:182,239`;
  `hosting/railway/oss/scripts/configure.sh:376-377`.
- The literal `agenta-runner` is the image and npm package name, not a Service name
  (`_helpers.tpl:336`; `services/runner/package.json:2`).

## 2. Inventory of per-process state in the runner

Classification used below. **(a)**: a handle to something that lives outside the pod (an id,
a URL, a token, a credential). **(b)**: a live in-process object that cannot be serialized (a
child process, an open socket, a promise, a closure, a timer, an SSE stream).

### 2.1 `server.ts` module level

| Item | Code | Holds | Written by | Read by | Created and dropped | Class |
|---|---|---|---|---|---|---|
| `inFlight` | `server.ts:188` | count of `/run` requests in flight | `/run` handler `:1621,1652` | `:1615` | per request | counter |
| `keepaliveConfigs` | `:418-422` | TTLs and `poolMax` per provider, read from env once | boot | dispatch `:454,466` | process lifetime | config |
| `keepalivePools` | `:423-432` | three `SessionPool` instances: `local`, `daytona` (strict capacity), `inprocess` | `runWithKeepalive`, `/kill`, shutdown | `/cancel` `parkedSessionControl` `:1350-1387`, `inBandAnswerTokens` `:520-530` | process lifetime | (b) container |
| `inProcessProvider` | `:391-409` | the lazily built in-process provider (registry, ledger, slots) | first in-process run | shutdown `:1743` | process lifetime | (b) |

### 2.2 `SessionPool` and `LiveSession`

`SessionPool` (`session-pool.ts:96-103`) holds `sessions: Map<key, LiveSession>` and
`teardowns: Map<key, Promise<void>>`. The key is `<projectId>:<sessionId>`
(`session-identity.ts:899-908`). Writers: `reserve` (`:186`), `park` (`:313`), `repark`
(`:266`), `checkoutIdle` (`:229`), `checkoutApproval` (`:245`), `evict` (`:414`), `destroy`
(`:462`), `destroyAll` (`:474`). Readers: `get` (`:112`), `awaitingApproval` (`:129`).

`LiveSession` fields (`session-pool.ts:31-60`):

| Field | Holds | Class |
|---|---|---|
| `key` | `<projectId>:<sessionId>` | string |
| `environment` | the `SessionEnvironment` (2.3) | (b) |
| `configFingerprint` | getter over `environment.appliedState.configFingerprint` | derivable string |
| `historyFingerprint` | hash the next request's prior conversation must match (`session-identity.ts:483-496`) | derivable string |
| `historyAsserted` | whether the parking request carried a full transcript | boolean |
| `credentialEpoch` | `CredentialMaterial` (the credential values, held to compare), `direct`, `mountExpiresAtMs` (`session-identity.ts:663-688`) | secret material, compare only |
| `state` | `busy`, `idle`, `awaiting_approval`, `destroyed` | string |
| `lastUsed` | LRU stamp | number |
| `teardown` | `(reason) => env.destroy({reason})` (`session-coordinator.ts:769,917`) | (b) closure |
| `ttlTimer` | `setTimeout` handle (`session-pool.ts:375-387`) | (b) timer |
| `teardownPromise` | the one running teardown | (b) promise |

Idle TTL: local 60 s, Daytona 120 s. Approval TTL: local 600 s, Daytona equals the idle TTL
(120 s). Stopped TTL: 600 s both (`session-identity.ts:53-70,106-137`). `poolMax`: local 8,
Daytona 20, in-process 64 (`:64,70,72`).

### 2.3 `SessionEnvironment` field by field

Source: `runtime-contracts.ts:319-542`. Built in `acquireEnvironmentOnce`
(`environment.ts:444-1754`) and `prepareEnvironmentSetup`.

| Field | Holds | Class |
|---|---|---|
| `appliedState` | fingerprint and facet digests of what the environment has installed (`:328`) | derivable |
| `workspaceInventory` | what the workspace write created (`:336`) | serializable |
| `reopenSession` | closure over persist driver, session init, local session key (`:346`, built `environment.ts:1551-1574`) | (b) |
| `credentialDelivery` | port bound to the sandbox provider (`:361`) | (b) |
| `commitApplied` | closure (`:363`) | (b) |
| `plan` | `RunPlan`: derived from the request plus the signed mount; includes local temp dirs | derivable, some local paths |
| `logger`, `deps` | functions | (b) |
| `sandboxGone` | one-way latch with listeners (`:377`) | (b) |
| `sandbox` | the sandbox-agent client (`SandboxAgent.start` result). It carries `sandboxId` (`daytona/<id>`) (a), an HTTP client with a Daytona auth cookie (`environment.ts:834-839`) (b), `inspectorUrl` (a) | (a) inside (b) |
| `session` | the ACP session handle: `id` = `<sessionId>:<harness>` (`environment.ts:1516-1518`), `agentSessionId` (a: the harness's native id, stored in `session_turns`), `respondPermission`, `onEvent`, `onPermissionRequest` listeners (`environment.ts:1633-1642`) | (b) with one (a) inside |
| `sessionId` | the conversation id | string |
| `model`, `capabilities`, `strictModel` | probed values | serializable |
| `toolCallIndex`, `clientToolRelayRef`, `executableToolGateRef`, `mcpAbort`, `closeToolMcp` | per-session tool plumbing | (b) |
| `mcpHandshakeFailures` | list | serializable |
| `runAgentDir`, `piPromptDir`, `codexSqliteHome` | local disk paths removed at destroy (`environment.ts:648-652`) | local disk |
| `subscriptionPublish`, `subscriptionPublisher`, `releaseSubscriptionHome` | login publication loop | (b) |
| `sandboxMeter` | billing meter with interval | (b) |
| `mountCreds`, `agentMountCreds` | signed object-store credentials with `expiresAt` (`:437-438`) | (a), re-signable from the api |
| `mountProjectId`, `projectScopeId` | ids | strings |
| `loadedFromContinuity`, `nativeHistoryVerified`, `nativeHistoryDurable`, `resumable` | booleans | booleans |
| `modelSecretDeliveredAt`, `continuityTurnIndex` | numbers; the turn index is also in `session_turns` | numbers |
| `sessionDestroyRequested`, `mountedCwd`, `agentMountedPath`, `installedMountExpiries`, `durableCwdSafeToDelete` | teardown state | serializable |
| `workspace` | `{cleanup}` closure | (b) |
| `runtimeRemount` | promise | (b) |
| `currentTurn` | otel run, pause controller, tool relay, update router (`:192-202`) | (b) |
| `piTraceExport` | spool consumer | (b) |
| `lastTurnToolCallIds` | strings | serializable |
| `parkedApprovals` | `Map<toolCallId, ParkedApproval>` (`:499`) | see below |
| `commitAuthorization` | frozen approval bytes (`:507`) | in-memory |
| `parkedApproval`, `parkedApprovedExecutions`, `approvalGateCount`, `nonParkablePauseCount`, `harnessCostReading` | per-turn approval bookkeeping | mixed |
| `destroyed` | boolean | boolean |
| `destroy` | the one idempotent teardown closure (`environment.ts:535-665`) | (b) |
| `clearTurn` | closure | (b) |

`ParkedApproval` (`runtime-contracts.ts:212-227`): `gateType` (string), `permissionId` (the
ACP permission request id; it is meaningful only on the live ACP connection in this pod),
`toolCallId` (string), `toolName`, `args`, `interactionToken` (a: the durable
`session_interactions.token`), `promptPromise` (b: the open `session/prompt` promise). Written
by `onUserApprovalGate` (`run-turn.ts:1287-1304`); `promptPromise` attached at
`run-turn.ts:1757-1761`. Cleared at turn start (`run-turn.ts:299-300`), on cancel
(`run-turn.ts:1695-1698`), and on parked Stop (`server.ts:1435-1441`).

### 2.4 Other module-level maps in the runner

| Module and symbol | Holds | Writer | Reader | Lifetime | Class |
|---|---|---|---|---|---|
| `sessions/alive.ts:97 ownedSessions` | `Map<sessionId, {authorization, claimedAt}>`: sessions whose owner key this replica won, with the run credential | `recordOwnedSession` on a beat the api confirmed (`:205-207,257`) | `releaseOwnedSessions` at shutdown (`:467-484`) | pruned past 120 s (`:100-105`) | (a) token |
| `sessions/execution-registry.ts:62 executions` | `Map<sessionId, LiveExecution>`: `projectId`, `turnId`, `startedAt`, `settled`, `released` promise, `abort` closure | `registerExecution` (`server.ts:961`) | `holdsSession`, `applyCommand` | until `unregisterExecution` in the request `finally` (`server.ts:1168`) | (b) |
| `execution-registry.ts:63 releases` | per `(sessionId, turnId)` promise | same | `applyCommand` awaits `live.released` | same | (b) |
| `sessions/active-turns.ts:14 active` | set of in-process turns for shutdown | `registerActiveTurn` (`server.ts:1067`) | `endActiveTurns` | per turn | (b) |
| `sessions/continuation-admission.ts:53 admissions` | `Map<commandId, pending or applied>`; dedupes continuation deliveries | `claimContinuationAdmission` (`server.ts:632`) | same | 30 minutes (`:14`) | cache; the api command row is the source of truth (`:9-11`) |
| `sessions/applied-commands.ts:40 applied` | `Map<commandId, outcome>`; dedupes Stop deliveries | `rememberCommand` | `recallCommand` | 30 minutes, cap 5000 (`:35-38`) | cache |
| `sessions/persist.ts:74 persistChains` | per-session promise chain of record ingests | `persistEvent` | `drainPersist` | per session | (b) |
| `persist.ts:77 persistFailures`, `:213 incompleteSessions` | dropped-record counts; sessions that must not be reconstructed | `postEvent`, `noteRecordsIncomplete` | `takePersistFailures`, `recordsIncomplete` | process lifetime | in-memory flag with durable meaning |
| `engines/sandbox_agent/session-continuity.ts:140 sessionContinuityStore` | `(sessionId, harness) -> {agentSessionId, turnIndex}`, `latestTurnIndex`, `credentialRaceReports` | `record`, `restoreLatestTurn` (hydrated from `session_turns`, `session-continuity-durable.ts:143-190`) | `eligibleAgentSessionId`, `nextTurnIndex` | process lifetime | (a) mirror of durable rows |
| `sandbox-reconnect.ts:32 destroyedSandboxIds` | ids this process deleted, cap 512 | `markSandboxDestroyed` | `readStoredSandboxPointer` | process lifetime | latency cache (`:27-30`) |
| `environment.ts:229 inFlightSandboxes` | set of environments with a live sandbox, for `/kill` and shutdown | acquire `:925`, destroy `:553` | `destroyInFlightSandboxesForSession` | per environment | (b) |
| `daytona-secret-provider.ts:92 processLocalRegistry` | Daytona Secret ownership per sandbox | provider | provider cleanup timer | process lifetime | (a) ids, process-local by design (`provider.ts:244-248`) |
| `metering/sandbox-usage.ts:311-312 runningTurns, sessionMeters` | billing holds and meters | admission | release | per turn | (b) |
| `metering/turn-admission.ts:77 openTurns`, `:62 admittedTurnStorage` | ending closures per admitted turn | `runAdmittedTurn` | `endAbandonedTurn` | per turn | (b) |
| `subscription-login-attempts.ts:116,292 attempts` | device-code login attempts: a running promise and `AbortController`, plus the login once obtained | `start` | `get`, `cancel` | 20 minutes (`:36`) | (b), holds a credential |
| `subscription-login/retention.ts:23 held` | login folders held by live sessions | acquire | sweeper | per session | local disk |
| `providers/credential-delivery-port.ts:738 inFlightByEnvironment` | one delivery per environment | delivery | delivery | per delivery | (b) |
| `tracing/otel.ts:151-255` | trace targets, span run ids, redactors, exporter cache | tracing | tracing | per run | (b) |
| `config/runner-config.ts:430 cached` | the parsed config | boot | all | process lifetime | config |

### 2.5 In-process provider state

Built once by `createInProcessProvider` (`engines/inprocess/index.ts:82-128`).

| Item | Holds | Class |
|---|---|---|
| `ConversationRegistry.entries` (`conversation-registry.ts:59`) | `Map<"inprocess:<project>:<session>", ConversationWorkspace>` | (b) container |
| `ConversationWorkspace` (`conversation-workspace.ts:73-92`) | `sandbox: CommandSandbox`, `drive: SandboxDrive`, `transcripts: TranscriptStore`, `changes: SerialQueue`, view-refresh counters | (b) |
| `CommandSandbox.current` (`command-sandbox.ts:181`) | the `DaytonaSandbox` handle; its `id` (a) is also written to `session_turns.sandbox_id` (`harness-host.ts:112-115`) | (a) inside (b) |
| `CommandSandbox` timers, slots, meter, usage lease (`:189-208`) | lifecycle queue, idle-stop timer, running slot, retired-sandbox promises | (b) |
| `TranscriptStore` (`transcript-store.ts:56-66`) | local dir `<cwd>-pi-sessions/<instance uuid>/` and a `saved` stamp map; the object store prefix `pi-sessions` is the durable copy | local disk + (a) |
| `SessionLedger.sessions` (`session-ledger.ts:43`) | admission seats and byte counts | counters |
| `sandboxSlots` (`sandbox-slots.ts:201-208`) | create and running semaphores; unresolved slots reconciled against Daytona | (b) |
| `InProcessHarnessHost.sessions` (`harness-host.ts:98`) | `Map<localId, InProcessAcpSession>` | (b) |
| `InProcessAcpSession` (`pi/acp-session.ts:84-103`) | Pi `AgentSession` and `ModelRuntime` in memory, `PiAcpSession` adapter, `pendingPermissions: Map<permissionId, resolver>`, `currentTurn` promise, watchdog | (b) |
| `persist: InMemorySessionPersistDriver` (`environment.ts:751-752`) | the sandbox-agent event log for this environment | (b) |

## 3. The Daytona path in detail

### 3.1 Where the warm agent process lives

The harness process runs inside the Daytona sandbox, spawned by the sandbox-agent daemon on
port 3000 (`provider.ts:29`, `:217-233`). The runner holds only a client handle
(`environment.ts:753-756`, `:886-907`). The runner's own `InMemorySessionPersistDriver`
records the ACP envelopes it observed (`environment.ts:751-752`); it is not the harness's
transcript. The harness's native transcript directories are mounted from the object store
into the sandbox (`environment.ts:1137-1155`, `mountHarnessSessionDirs`), so they outlive both
the sandbox and the pod when the mount is active.

### 3.2 Create

`buildSandboxProvider("daytona", ...)` (`provider.ts:206-275`) builds the create request with
the snapshot or image, network policy, `envVars`, Secrets, and the lifecycle intervals:
`autoStopInterval` 15 minutes, `autoDeleteInterval` 30 minutes, `ephemeral: false`
(`provider.ts:95-124`; defaults `runner-config.ts:72-73`). `daytonaWithLifecycle` adds
`refreshActivity`, `pause`, `reconnect`, `deleteSandbox` (`daytona-provider.ts:187-328`).

### 3.3 Find and reconnect

`sandbox-lifecycle.ts:acquire` (`:62-125`):

1. `readStoredSandboxPointer(sessionId)` posts `/sessions/turns/query` with
   `windowing {limit 1, order descending}` and takes `sandbox_id` from the latest row
   (`sandbox-reconnect.ts:69-83`; `session-continuity-durable.ts:93-134`). An id this process
   deleted is skipped (`:76-81`).
2. `startSandboxAgent({...startOptions, sandboxId})` reconnects (`sandbox-lifecycle.ts:82-92`).
   `daytonaWithLifecycle.reconnect` gets the sandbox, waits for a stable state, starts it if
   stopped or archived, syncs the network policy, and throws `DaytonaReconnectTerminalError`
   for not-found, error, destroyed (`daytona-provider.ts:293-317`). A running sandbox is
   accepted as is (`:304-307`).
3. Any failure falls through to a fresh create (`sandbox-lifecycle.ts:93-118`).

The harness session is opened by `openHarnessSession` (`environment.ts:1531-1544`;
`environment/harness-session-lifecycle.ts:156-260`). `priorAgentSessionId` comes from the
continuity store, which `hydrateHarnessSessionFromDurable` seeds from the latest
`session_turns` row for this harness when `end_time` is set
(`environment.ts:1500-1515`; `session-continuity-durable.ts:143-190`). With an eligible id the
runner seeds the persist driver and calls `resumeSession(localSessionId)`, which the patched
sandbox-agent turns into ACP `session/load` (`harness-session-lifecycle.ts:163-232`). It then
verifies that history events were observed (`:117-147`). Otherwise `createSession`
(`:234-252`).

The turn row is written at turn start with `sandbox_id`, `agent_session_id`, `stream_id`,
`turn_index` (`run-turn.ts:724-745`; `session-continuity-durable.ts:229-273`) and completed
with `end_time` at turn end (`run-turn.ts:351-365`; `session-continuity-durable.ts:193-226`).

### 3.4 Teardown

`env.destroy({reason})` (`environment.ts:535-665`) runs, in order: quiesce runtime
(`:540-545`), stop the subscription publisher, remove from `inFlightSandboxes`,
`teardownHarnessSession` which sends `destroySession` unless a cancel was already sent
(`:556-560`; `harness-session-lifecycle.ts:269-285`), drain Pi trace export, then
`teardownSandbox` (`:586-598`; `sandbox-lifecycle.ts:156-200`).

`teardownDisposition(reason)` (`teardown.ts:75-83`) maps the reason to `stop` or `delete`.
The parkable set is an allowlist: `clean-resumable`, `idle-expiry`, `capacity-eviction`,
`shutdown-idle`, `cancelled`, `session-incompatible`, `continuity-invalid` (`teardown.ts:61-73`).
Everything else, including `kill`, `failed-turn`, `aborted`, `runtime-incompatible`,
`shutdown-in-flight`, deletes. `stop` calls `pauseSandbox` (Daytona stop) and reports
`parked: true`; `delete` calls `markSandboxDestroyed` then `destroySandbox`
(`sandbox-lifecycle.ts:164-192`).

### 3.5 The pool's two warm states

- **In-pool live.** After a clean turn the coordinator parks the environment `idle` with the
  idle TTL, or `awaiting_approval` with the approval TTL (`session-coordinator.ts:747-812`,
  `:824-873`). The sandbox stays running. `onParkedLive` calls Daytona `refreshActivity` so
  Daytona's autostop clock resets (`server.ts:321-324`; `daytona-provider.ts:257-272`). The
  next turn on this pod takes `hit-continue` (`session-coordinator.ts:1116-1133`) without
  any acquire.
- **Stopped-parked.** When the TTL fires, or the pool is full, the entry is evicted with a
  parkable reason and the sandbox is stopped (`session-pool.ts:375-387`;
  `teardown.ts:61-73`). The next turn, on any pod, takes `miss` then `coldAndPark`, which runs
  the reconnect ladder (`session-coordinator.ts:875-947`, `:1396-1401`).

### 3.6 The fingerprints

- `configFingerprint(request)` hashes the config-bearing request fields with credential
  values stripped (`session-identity.ts:252-377`). A mismatch means "rebuild or apply a live
  route" (`session-coordinator.ts:982-1022`).
- `historyFingerprint(messages)` hashes user texts, attachment ids, inline media digests,
  tool-call ids and the user-message count (`:437-470`). The park stores
  `expectedNextHistoryFingerprint` (`:483-496`). A mismatch means an edited transcript, so
  the warm native memory is wrong; the teardown reason is `continuity-invalid`, which parks
  the sandbox (`session-coordinator.ts:604-608`).
- `computeCredentialEpoch(request)` holds the credential values to detect rotation
  (`:709-754`); `mountExpiresAtMs` bounds the parked mount lease (`:663-688`).
- `daytonaCreateFingerprint` hashes the image and create request so a parked sandbox with a
  different topology is rebuilt (`provider.ts:139-163`).

All fingerprints derive from the incoming request plus `env.appliedState`. They matter only
when a pool entry exists. A fresh pod has no entry, so it always takes the cold path and
never evaluates them.

### 3.7 What a fresh pod loses when the old pod's memory vanishes

Given the durable ids (`session_turns.sandbox_id`, `agent_session_id`, `turn_index`,
`session_interactions`), a new pod loses:

1. The in-pool live handle. The sandbox keeps running with no owner until Daytona autostop
   (15 minutes) and autodelete (30 minutes) (`provider.ts:117-122`). The reconnect ladder on
   the new pod finds it by id and accepts a running sandbox (`daytona-provider.ts:304-307`).
   The old ACP session inside the daemon is not closed by anyone. Unverified what the
   sandbox-agent daemon does with an abandoned ACP session when a new `session/load` or
   `session/new` arrives for the same local id.
2. The in-flight turn. The pod's HTTP response stream and the `session/prompt` promise die
   with the pod. The harness keeps working inside the sandbox until it finishes
   (`sandbox-liveness.ts:3-9` describes the inverse case). The api watchdog settles the
   execution `lost` after the heartbeat stops (`api/oss/src/core/sessions/commands/service.py:1565-1626`).
   Records already ingested survive (`persist.ts:1-22`).
3. Parked approvals. `permissionId` and `promptPromise` are gone (`runtime-contracts.ts:212-227`).
   The interaction row survives with `status`, `token`, `data.request.tool_call_id` and
   `data.parameters` (`api/oss/src/core/sessions/interactions/dtos.py:27-50`). The cold path
   on the new pod reads answered rows with `loadDurableDecisions`, claims them, and seeds the
   decision map, so the model re-issues the gated call and it runs without a second question
   (`interactions.ts:432-452`; `engine.ts:112-118`; `server.ts:309-315`).
4. Daytona Secret ownership (`processLocalRegistry`), left to the provider's cleanup timer
   (`provider.ts:244-248`).
5. `destroyedSandboxIds` (one wasted reconnect round trip), `credentialRaceReports` (one extra
   retry hint), `incompleteSessions` (a new pod would trust a log with a hole).
6. The continuity store, which is rebuilt from `session_turns` on the next acquire
   (`environment.ts:1500-1508`).

### 3.8 Teardown reason vocabulary that drives a correct kill

`kill` deletes (`teardown.ts:61-73`, not in the allowlist). `destroySandbox` on the
sandbox-agent handle deletes the Daytona sandbox; `daytonaWithLifecycle.deleteSandbox(id)`
exists as a direct id-based delete that treats not-found as success (`daytona-provider.ts:318-326`).

## 4. The in-process path in detail

### 4.1 Where the Pi loop runs

Inside the runner process. `openPiSession` builds a Pi `ModelRuntime` and `AgentSession` from
memory with no extensions from disk (`engines/inprocess/pi/pi-session-factory.ts:77-134`).
The `InProcessHarnessHost` offers the same surface the shared turn code calls
(`harness-host.ts:1-16`, `:280-335`), so `runTurn` is unchanged.

### 4.2 Where the conversation state lives

- Pi writes its session file to `transcripts.dir`, which is
  `<cwd>-pi-sessions/<instance uuid>/` on the runner's local disk
  (`transcript-store.ts:26-34`; `conversation-registry.ts:86`). `cwd` is the session folder
  under `/home/sandbox/agenta/mounts/<project>/<mount>` (`run-plan.ts:437`;
  `server.ts:400-405`).
- The durable copy is the object store prefix `pi-sessions`, signed apart from the session
  folder so the command sandbox cannot read it (`environment.ts:867-876`;
  `transcript-store.ts:1-18`). `restore()` runs before a session opens
  (`harness-host.ts:208`); `save()` runs after every turn (`harness-host.ts:244`).
- A runner start sweeps every `*-pi-sessions` folder a previous process left
  (`transcript-store.ts:41-52`; `server.ts:400-405`).

### 4.3 Where file tools execute

In the conversation's command sandbox, a Daytona sandbox created on the first tool call
(`conversation-workspace.ts:1-19`; `command-sandbox.ts:361-386`). The sandbox mounts the
drive. The sandbox is labelled with the conversation id, the project, the credentials
fingerprint, `agenta.owner = REPLICA_ID` and a deployment digest (`command-sandbox.ts:417-423`;
`sandbox-owner.ts:12-25`). The id is written to `session_turns.sandbox_id`, with the comment
"another runner never uses it" (`harness-host.ts:112-115`).

### 4.4 What a follow-up message relies on

- Warm (same pod): the `InProcessAcpSession` is in the pool; `resumeSession` returns the live
  object (`harness-host.ts:309-311`).
- Cold (any pod): `openHarnessSession` seeds the persist driver with the durable
  `agent_session_id` (`harness-session-lifecycle.ts:163-171`), then `resumeSession` reads that
  record and calls `openSession(cwd, localId, agentSessionId)` (`harness-host.ts:312-321`).
  `openPiSession` finds the session file in `transcripts.dir`, restored from the store
  (`pi-session-factory.ts:62-75`, `:110-113`), opens it with `SessionManager.open`, and
  `replayHistory` emits the prior turns (`harness-host.ts:318`). A new command sandbox is
  created on the first tool call.

Pod-only state: the live Pi object, `pendingPermissions` (`acp-session.ts:94`), the running
command sandbox (left to Daytona autostop and autodelete, `command-sandbox.ts:9-11`), and the
turn in flight (`transcript-store.ts:17`).

### 4.5 Can a second pod continue an in-process session today?

Yes, cold. The integration tests cover it: "a runner restart between two turns: resumes the
history on a fresh sandbox that mounts the drive; the old sandbox is never used again"
(`services/runner/tests/integration/inprocess/pi-loop.test.ts:212`) and "brings the history
back on a runner that lost its disk" (`:250`; also `sandbox-drive.test.ts:154`). What is
needed for the pod to reach that path is only that the request arrives at it: nothing in the
in-process acquire asks the owner key. The `LocalSandboxNotOwnerError` guard is confined to
`resolvesToLocalProvider(request.sandbox)` (`environment-setup.ts:93-97`;
`session-continuity.ts:205-265`).

Approvals on this path have the same limit as on Daytona: a gate parked in the old pod's
`pendingPermissions` is unreachable from the new pod; the durable decision path applies.

## 5. Approvals, end to end

### 5.1 Runner side

1. The harness asks permission. In park mode `onUserApprovalGate` records a `ParkedApproval`
   per gate (`run-turn.ts:1287-1304`). The runner writes a durable interaction row with
   `token`, `kind user_approval`, `data.request {tool, args, tool_call_id}`, `references`,
   `parameters` (`run-turn.ts:1038`; `interactions.ts:142-182`, `:105-127`).
2. The pause returns without destroying the session when at least one parkable gate exists
   (`run-turn.ts:784`). `promptPromise` is attached to every parked record
   (`run-turn.ts:1757-1761`). `noteExecutionSettled` is not called for a paused turn
   (`run-turn.ts:1596-1598`), so the Stop route still sees it as stoppable through the pool.
3. The coordinator parks `awaiting_approval` when every gate is parkable
   (`session-coordinator.ts:669-697`, `:785-793`, `:841-857`). `watchParkedPrompt` evicts the
   entry if the held prompt rejects while parked (`:707-724`).
4. The runner releases the alive watchdog in the request `finally` and the turn-end beat
   releases `running` (`server.ts:1164`; `alive.ts:387-397`). `alive` stays held under the
   paused turn id until its 3600 second TTL (`streams/service.py:820-827`).
5. Resume. A new `/run` with the approval envelope arrives. The `awaiting_approval` branch
   matches each parked gate by `toolCallId` against `approvalDecisionForToolCall`
   (`session-coordinator.ts:1173-1223`; `session-identity.ts:549-585`), checks history, mount
   expiry and credential rotation (`:1241-1273`), then `checkoutApproval` and `runTurn` with
   `resume` or `settleApprovalsThenPrompt` (`:1303-1341`). `runTurn` answers each gate with
   `env.session.respondPermission(permissionId, reply)` (`run-turn.ts:1228`, `:1485`). Any
   mismatch evicts with `session-incompatible` and runs cold (`:1275-1301`).
6. Cold path. `loadDurableDecisions` queries the session's interaction rows, keeps
   `user_approval` rows in `responded`, claims each by transitioning it to `resolved`, and
   seeds the decision map (`interactions.ts:396-452`). The model re-issues the call and the
   gate resolves from the seeded decision.
7. Stop on a parked approval. `holdsSession` consults the pool through `parkedSessionControl`
   (`server.ts:1350-1387`; `control-channel.ts:93-100`). `stopParkedApprovalSession` rejects
   every gate, sends ACP `session/cancel`, waits for the prompt to settle, clears the parked
   set, and reparks idle with the stopped TTL (`server.ts:1399-1451`).

### 5.2 Api side: the durable continuation

`respond_interactions` locks the source execution, transitions the rows to `responded`, settles
the source execution `continued`, creates a continuation execution with a new id, and inserts a
`continue_interaction` command (`commands/service.py:599-836`). Delivery goes through
`DirectControlDelivery.continue_interaction` (`control_delivery_direct.py:71-82`), wired to
`interactions_dispatcher.respond_many` (`api/entrypoints/routers.py:1516-1527`), which builds an
invoke request with `meta.control_command_id` (`api/oss/src/tasks/asyncio/sessions/interactions_dispatcher.py:461-470`)
and calls `invoke_workflow_detached` (`workflows/service.py:3295-3345`). The runner receives
`controlCommandId` on `/run`, claims it process-locally (`server.ts:631-697`), and reports
`started` to `/sessions/control/commands/{id}/outcome` before it starts the engine
(`server.ts:830-875`; `control-channel.ts:335-375`). Delivery failure marks the execution
`recoverable` (`commands/service.py:868-929`).

### 5.3 Owner bookkeeping and the departed-owner path

The heartbeat (`streams/service.py:552-969`):

- `claim_owner_value` claims the owner key without stealing from a different live replica
  (`:671-677`; Lua `contract.py:337-352`). The value is `replica_id\x1fturn_id`
  (`contract.py:56-63`). TTL `OWNER_TTL_SECONDS` = 120 (`env.py:1869`).
- When the owner differs, `_reclaim_affinity_from_a_departed_replica` takes the key only when
  the beat carries a `turn_id` and `is_running`, and no other turn holds `running`
  (`:471-550`). Its docstring states the known limit (`:499-506`): on a multi-replica
  deployment a parked approval holds `alive` with no `running`, so a second replica can take
  affinity and the handover below tombstones the parked turn, "killing the pending approval".
- A beat from a replica that lost the claim mutates nothing and gets `is_current_turn: False`
  (`:689-697`). The runner reads that on the first beat as a refused admission
  (`alive.ts:384-386`; `server.ts:933-958`) or on a later beat as an interruption and aborts
  (`alive.ts:326-337`; `server.ts:783-789`).
- The handover branch (`:743-792`): when `alive` is held by a different turn and no `running`
  exists, the api releases the old `alive` owner, writes a `superseded` tombstone for the
  displaced turn, and acquires `alive` for the new turn. A tombstoned turn's later beats are
  refused forever (`:644-666`).

What identifies the owner is `replica_id`, the runner's `REPLICA_ID` (`alive.ts:47-48`). The
runner keeps `ownedSessions` so a graceful shutdown can release the keys
(`alive.ts:72-131`, `:467-484`; `server.ts:1747-1754`). The shutdown beat requires the runner
token (`router.py:703-704`; `streams/service.py:600-633`).

## 6. Cancel and kill

### 6.1 The runner `/cancel` route

`server.ts:1533-1599`. Required body fields: `commandId`, `sessionId`, `projectId`. If
`holdsSession` is false (no live execution in the registry and no `awaiting_approval` pool
entry for the pair), it answers 404 `session not held here` (`:1586-1591`;
`control-channel.ts:93-100`). Otherwise it answers 202 `{ok: true, replicaId}` and runs
`applyCommand` asynchronously (`:1595-1598`).

`applyCommand` (`control-channel.ts:107-212`): dedupes by `commandId` (`:115-132`), decides
the outcome (`:214-276`), aborts the live execution through `live.abort()` or stops a parked
approval through `parked.stop()` (`:158-182`), then posts the outcome with `replica_id`
(`:285-323`). The abort makes the turn end `cancelled`; `runTurn` sends ACP `session/cancel`
and waits for the prompt to settle (`run-turn.ts:1694-1711`; `cancel-turn.ts:82-155`). A
settled cancel parks the environment on the stopped TTL (`engine.ts:61-78`;
`session-coordinator.ts:795-805`).

### 6.2 The api cancel path and the lost settlement

`request_cancel` (`commands/service.py:335-579`): resolves the target from Redis `running`,
falling back to `alive` only for a named Stop (`:1120-1150`); applies the late-Stop guards
(`:371-440`); inserts the command and sets the execution `stopping` in one transaction
(`:486-573`); then `_deliver` (`:1216-1304`).

`_deliver` records an attempt, calls the adapter, and on `accepted` writes the claim with the
runner's reported `replica_id` or `"direct"` (`:1271-1287`). On `not_held` it calls
`_settle_not_held` (`:1358-1412`): if some execution holds `running` and the row is beating
(updated within two heartbeat intervals, `:1414-1427`), the command settles `lost` and an
error log names the owner replica (`:1380-1403`). Otherwise `not_running`.

`settle_abandoned_commands` (`:1429-1472`) runs on the sweep. It redelivers while the row is
beating and `claim_count < max_deliveries` (3), else settles `lost`. Lease 90 s, admission
timeout 90 s, sweep every 10 s (`env.py:691-712`). The outcome route accepts a report only
from the replica that holds the claim (`dao.py:624`, from the storage sweep; `commands/service.py:1750-1773`).

The second, pod-agnostic cancel is the streams command `POST /sessions/streams/` in cancel
mode: `displace_turns` deletes `alive` and `running` and tombstones the turn
(`streams/service.py:341-369`; `locks.py:353-386`). The runner learns it on its next beat
(`alive.ts:201,326-337`). Latency is one heartbeat interval, 30 s (`contract.ts:18`).

### 6.3 The runner `/kill` route

`server.ts:1483-1531`. It drains the pool entry `<projectId>:<sessionId>` in all three pools
with reason `kill` (`:1515-1523`), then `destroyInFlightSandboxesForSession` for sandboxes
mid-turn (`:1524-1529`; `environment.ts:273-294`). It answers 200 whether or not anything was
found. Reason `kill` means disposition `delete` (`teardown.ts:61-83`).

What kill destroys on Daytona: `env.destroy({reason: "kill"})` sends `destroySession` to the
daemon, then deletes the Daytona sandbox (`sandbox-lifecycle.ts:176-192`), unmounts
runner-host mounts, removes local dirs. On the in-process path `destroySandbox` closes the Pi
sessions and releases the workspace with `delete`, which deletes the command sandbox and
removes the local transcript folder (`harness-host.ts:412-415`;
`conversation-registry.ts:109-132`; `command-sandbox.ts:537-553`).

### 6.4 The api kill

`SessionStreamsService.kill` (`streams/service.py:415-469`): displaces the turns, force-clears
the owner key, steals and releases `attached`, calls `kill_runner_sandbox` best-effort
(`runner_client.py:32-64`), marks the row ended, soft-deletes it. The api does not read
`session_turns.sandbox_id` and does not call Daytona itself.

### 6.5 What a correct kill needs from a pod that holds nothing

- Daytona: the sandbox id is durable in `session_turns.sandbox_id`. An id-based delete
  exists (`daytona-provider.ts:318-326`). The harness session dies with the sandbox. The
  Daytona Secrets attached to that sandbox are tracked only in the creating pod's memory
  (`provider.ts:244-248`); unverified whether a Secret can be found from the sandbox alone.
- In-process: the command sandbox id is also in `session_turns.sandbox_id`
  (`harness-host.ts:112-115`). The sandbox carries labels `agenta.conversation` and
  `agenta.owner` (`command-sandbox.ts:417-423`). The transcript is already in the store after
  the last completed turn; the pod-local folder is scratch (`transcript-store.ts:12-15`).

## 7. Durable storage that already exists

### 7.1 Redis

Two planes, both configured in `api/oss/src/utils/env.py:1817-1827`:

- Volatile: `REDIS_URI_VOLATILE`, default `redis://redis-volatile:6379/0`. Runs with
  `--appendonly no --save ""`, policy `volatile-lru` (`hosting/docker-compose/oss/docker-compose.dev.yml:560-569`;
  Helm `redis-volatile-deployment.yaml:67-72`). Clients: `CacheEngine`, `LockEngine`
  (`api/oss/src/dbs/redis/shared/engine.py:30,69`), the rate limiter.
- Durable: `REDIS_URI_DURABLE`, default `redis://redis-durable:6381/0`. Runs with
  `--appendonly yes`, policy `noeviction`, a PVC in Helm (`redis-durable-statefulset.yaml:63-70,140-152`).
  Clients: `StreamsEngine` (`engine.py:99`), the Taskiq brokers, the stream worker.

The session coordination keys (`alive`, `running`, `attached`, `owner`, `superseded`, `started`,
`heartbeat-guard`, `displaced`) live on the **volatile** plane through `LockEngine`
(`contract.py:7-29`; `locks.py`). TTLs: alive 3600, running 3600, attached 60, owner 120,
superseded 3600 (`env.py:1857-1925`). The durable plane holds `watch:*` pub/sub channels,
`streams:records`, `streams:session-live-frames`, `streams:sessions`
(`contract.py:156-164`; `api/oss/src/core/sessions/records/streaming.py:67-68`;
`api/oss/src/tasks/asyncio/sessions/streaming.py:61`). Those are event transport, not session
state.

Who connects: the api, the workers, the services for caching. The runner never does
(`alive.ts:13`). The Python services under `services/oss/src` have no Redis or Postgres import
(grep over `services/oss/src` found none). The Helm chart gives Redis variables to api,
services, workers, cron and the alembic job through `commonEnv` (`_helpers.tpl:1102-1107`),
not to the runner.

### 7.2 Postgres tables about a session

All under `api/oss/src/dbs/postgres/sessions/`.

- `session_streams` (`streams/dbes.py:24-95`): `session_id`, `references`, `turn_id` (mirror of
  the Redis lock value), `stopping_turn_id`, `turn_started_at`, `archived_at`, `flags` JSONB
  (mirror of the nest), `updated_at` is the heartbeat timestamp. No owner or replica column
  (`:34-45`).
- `session_turns` (`turns/dbes.py:13-18`; columns `turns/dbas.py:11-44`): `session_id`,
  `turn_id`, `stream_id`, `turn_index`, `harness_kind`, `agent_session_id`, `sandbox_id`,
  `references`, `trace_id`, `span_id`, `start_time`, `end_time`. Unique
  `(project_id, session_id, turn_index)`. This is the only durable home of the sandbox id and
  the harness session id.
- `session_executions` (`executions/dbes.py:16-30`): `execution_id`, `state`
  (`active|stopping|pending_delivery|recoverable|running|terminal`), `parent_execution_id`,
  `source_interaction_id`, `error`, `terminal_outcome`, `settled_by`, `settled_at`,
  `ending_written_at`, `redis_reconciled_at`.
- `session_commands` (`commands/dbes.py:14-35`; `commands/dbas.py:119-135`): `kind`
  (`cancel|continue_interaction|continue_input`), `target_turn_id`, `expected_turn_id`, `state`
  (`pending|claimed|applied|obsolete`), `claimed_by` (the only persisted replica identity),
  `claim_expires_at`, `claim_count`, `outcome`, `idempotency_key`, `settled_at`, `data`.
- `session_interactions` (`interactions/dbes.py:13-14`; `interactions/dbas.py:25-29`):
  `session_id`, `turn_id`, `token` (unique per session), `kind`, `status`
  (`pending|responded|resolved|cancelled`), `data` with `request`, `resolution`, `parameters`.
- `session_inputs` (`inputs/dbes.py:22-41`): queued inputs with `state`, `policy`,
  `promoted_execution_id`.
- `records` and `session_sequence_cursors` (`records/dbes.py:15-56`): the event transcript,
  in the tracing database (`records/dao.py:29,35` uses the analytics engine).
- `mounts` and `session_attachments` (`api/oss/src/dbs/postgres/mounts/dbes.py:13-14`;
  `sessions/attachments/dbes.py:14-15`): the session-to-object-store link is `mounts.id` with
  `session_id`; the storage key is derived server-side (`api/oss/src/core/mounts/dtos.py:16-17`).

No table stores a runner address, an environment handle, or a Daytona Secret id.

### 7.3 Object store

The session folder is a geesefs mount of an object-store prefix: on a local runner under
`/var/lib/agenta/mounts/<project>/<mount>` (`run-plan.ts:434`), in a Daytona sandbox under
`/home/sandbox/agenta` (`run-plan.ts:437`). The harness transcript directories and Codex's
`.codex/sessions` rollouts live in it. The in-process Pi transcript lives in the separate
`pi-sessions` prefix (section 4.2).

### 7.4 Runner local disk

`AGENTA_RUNNER_STATE_DIR` or `<tmpdir>/agenta/runner-state` holds subscription logins
(`run-plan.ts:151-172`). `/tmp/agenta/{relay,telemetry,tool-mcp,codex-sqlite}` are scratch.
The Helm chart mounts no volume for either (`runner-deployment.yaml:249-260` mounts only
`/dev/fuse`). Compose gh and dev mount a named volume `runner-state`
(`hosting/docker-compose/oss/docker-compose.gh.yml:348,391`).

## 8. Deployment

### 8.1 Helm (`hosting/kubernetes/helm`)

- Runner `Deployment`, name `<fullname>-runner`, `replicas` from `agentRunner.replicas`,
  default 1 (`templates/runner-deployment.yaml:8-15`; `_helpers.tpl:138`).
- `strategy: Recreate` with the comment: "the api addresses the runner through one Service
  with no session routing, so while two runner pods exist a Stop, Cancel or follow-up message
  can reach the pod that does not own the session. The owner answers 404 and the api can
  settle the command as lost. ... Revisit when the api routes by session id; the plan is in
  the GCP production design" (`runner-deployment.yaml:20-27`). The referenced GCP design is not
  in this repository.
- `AGENTA_RUNNER_REPLICA_ID` is set to the Service name only when `replicas == 1`; the
  comment says "with several pods a shared id would make every pod claim every session" and
  "Local multi-replica is unsupported anyway (no sticky routing); scale with Daytona"
  (`runner-deployment.yaml:101-111`).
- Probes: startup, liveness, readiness all `GET /health` (`:211-232`).
  `terminationGracePeriodSeconds` 300, `preStop sleep 10` (`values.yaml:285-287`;
  `runner-deployment.yaml:41-46,233-244`).
- Service: `ClusterIP`, port 8765, no `sessionAffinity`, not headless (`runner-service.yaml`).
- PodDisruptionBudget: `maxUnavailable: 1` at replicas >= 2; `protectSingleton` at 1
  (`poddisruptionbudget.yaml:24-25`). No HorizontalPodAutoscaler template exists.
- Runner env block: `AGENTA_API_URL`, `AGENTA_API_INTERNAL_URL`, host, port, providers,
  replica id, `PI_CODING_AGENT_DIR`, Daytona settings, `AGENTA_RUNNER_TOKEN` from a secret
  (`runner-deployment.yaml:72-210`). No Redis, no store, no state dir.
- Redis: `redis-volatile` is a `Deployment` with `Recreate` and no volume;
  `redis-durable` is a `StatefulSet` with AOF and a 5Gi PVC (`redis-volatile-deployment.yaml:5-21,67-72`;
  `redis-durable-statefulset.yaml:10-18,63-70,140-152`).

### 8.2 Compose and Railway

- Compose runs one runner service `runner` on `http://runner:8765`, with
  `AGENTA_RUNNER_REPLICA_ID` default `local-runner-1` in the gh variants
  (`hosting/docker-compose/oss/docker-compose.gh.yml:329-412`, `:341`) and unset in the dev
  variants. No compose file sets `replicas` or `deploy`.
- Railway runs one runner service with no replica id and no state volume
  (`hosting/railway/oss/template/template.json:267-275`). Volatile and durable Redis are one
  instance there (`:204-206`).

## 9. Tests that exist

Runner tests use vitest under `services/runner/tests/` (255 files). Relevant files, from the
test sweep, verified by path:

- Pool and keepalive: `unit/session-pool.test.ts`, `unit/session-pool-teardown.test.ts`,
  `unit/session-keepalive-dispatch.test.ts`, `unit/session-keepalive-engine.test.ts`,
  `unit/lifecycle-session-coordinator.test.ts`, `unit/session-steer-mount-loss.test.ts`.
- Approvals park and resume: `unit/session-keepalive-approval.test.ts` (Claude, Pi, Codex
  gates; two-gate parks; TTL expiry; disconnect after pause still parks; duplicate approval
  does not double-respond), `unit/session-admission.test.ts` ("admits an approval RESUME while
  the previous turn is parked"), `unit/continuation-admission.test.ts`.
- Reconnect: `unit/sandbox-reconnect.test.ts`, `unit/sandbox-lifecycle.test.ts` ("remote
  sandbox reconnect ladder"), `unit/session-continuity-durable.test.ts`,
  `unit/session-continuity.test.ts`, `unit/sandbox-gone.test.ts`, `unit/sandbox-liveness.test.ts`.
- Owner and replica: `unit/session-ownership.test.ts`, `unit/session-ownership-release.test.ts`,
  `unit/session-alive.test.ts`, `unit/session-alive-interrupt.test.ts`,
  `unit/session-redis-contract.test.ts`, `unit/inprocess/sandbox-owner.test.ts`,
  `unit/inprocess/command-sandbox.test.ts` ("a conversation that moves to another runner gets
  a new sandbox").
- Cancel and kill: `unit/control-command-apply.test.ts` (`applyCommand`, `holdsSession`,
  404 case), `unit/harness-cancel-park.test.ts`, `unit/kill-inflight-scope.test.ts`,
  `unit/server.test.ts` (`/kill` scope, duplicate continuation admission, "does not run when
  the API says another replica already admitted the command").
- In-process: `integration/inprocess/pi-loop.test.ts` (restart between turns, lost disk),
  `integration/inprocess/sandbox-drive.test.ts`.

Api pytest under `api/oss/tests/pytest/unit/sessions/` uses a fake Redis lock engine:
`test_owner_claim.py`, `test_heartbeat_ownership.py`,
`test_heartbeat_departed_replica_affinity.py`, `test_heartbeat_release_owner.py`,
`test_heartbeat_parked_zombie.py`, `test_session_cancel_admission.py` ("not_held on a beating
session is reported as LOST"), `test_kill_runner_teardown.py`, `test_runner_client_kill.py`,
`test_execution_watchdog.py`, `test_session_commands_dao.py`.

The `agent-release-gate` skill (`.agents/skills/agent-release-gate/`): `qa_product.py` journeys
`warm`, `cold1`, `park`, `cold2` (SIGKILL and replace one runner, then wait owner TTL),
`approve`, `deny`; `session_control.py` cells `stop-warm`, `stop-approval`, `runner-gone`,
`restart-after-stop`, `repeat-stop` and others. Its own comment says a two-replica journey "is
a follow-up" (`resources/qa_product.py:1592`). No test or CI workflow runs two runner
instances or asserts on `AGENTA_RUNNER_REPLICA_ID` (search of `.github/workflows`).

## 10. Prior design work

- **Session control and live events** (`docs/design/session-control-and-live-events/`,
  2026-09). Decided the durable Stop command and kept the Redis `owner` key. D-017 explicitly
  excluded multi-runner fencing because "Agenta operates one runner". O-006 chose the direct
  HTTP adapter behind a replaceable port and deferred a runner-initiated long-poll adapter
  "until multi-runner or user-operated routing requires it". The long-poll design declares
  the sessions a runner holds, from `SessionPool.keys()`, as the routing input; the DAO half
  (`claim_commands`) exists, the route does not. It bears directly on option B: it documents
  the wrong-replica `not_held` detector and the removed replica census.
- **Runner scalability specs** (`docs/designs/sessions/streams/specs.md`, `tasks.md`, 2026-06,
  "Not implemented"). Proposed coordination through Redis, a `session_runners` table, and
  explicitly rejected route-to-owner. Its multi-replica acceptance tests are unchecked. The
  Redis keys and heartbeat from it shipped; the routing did not.
- **In-process Pi runner spike** (`openspec/changes/spike-pi-inprocess-runner/`, 2026-09-23 to
  25). Decided: the transcript is saved outside the process after every turn so a later turn
  rebuilds "on any runner"; no cross-runner sandbox adoption; owner-lease sweeps were added
  then removed in favour of Daytona autostop and autodelete. Design question E4 (sticky
  versus stateless) was posed; I did not find its conclusion.
- **Sessions-takeover architecture** (`docs/design/agent-workflows/projects/sessions-takeover/architecture.md`,
  2026-08). Reference inventory: the keepalive pool is the only plane that does not survive a
  restart; the heartbeat is fail-open so a partitioned runner keeps executing.
- **Codex harness QA and the local owner guard** (`docs/design/codex-harness/reports/warm-approvals-qa.md`,
  `status.md`). Records that a SIGKILLed replica leaves its owner key for 120 s and that the
  local provider refuses on a non-owner replica (GH #5611).
- **Warm Daytona sessions** (`docs/design/agent-workflows/projects/warm-daytona-sessions/`,
  2026-07). Decided park-to-stopped, the 20-slot warm cap, and the latest-turn pointer. Notes
  the pool is per process.
- **Hosted subscription connections** (`docs/design/hosted-subscription-connections/status.md`).
  Records that a device-login attempt lives in one runner process and a poll may reach another
  replica; "Recorded, not solved here".
- **Mobile approvals and steering** (`docs/design/agenta-mobile/plans/2026-07-27-mobile-approvals-steering.md`).
  Documents the `superseded` tombstone as the Stop signal and the non-stealing owner key.
- The folder `docs/design/runner-replicas/` existed but was empty before this document.

## 11. Mechanisms that keep a copy of "who owns this session" or "is this session alive"

Facts and dependencies only. No design.

| Mechanism | Where | What it answers | Who depends on it | If deleted or derived from one source |
|---|---|---|---|---|
| Redis `owner` key (`replica_id\x1fturn_id`, TTL 120 s) | api `contract.py:90,56-63`; written by the heartbeat `streams/service.py:671-677` | which replica serves the session | the heartbeat refusal (`:681-697`), `kill` force-clear (`:436-438`), the local-provider guard (`environment-setup.ts:93-115`), `_settle_not_held` logging (`commands/service.py:1386-1390`) | nothing routes by it today. The direct adapter does not read it (`control_delivery_direct.py:28-33`). Only the local provider refuses on it. Removing it removes the parked-approval tombstone hazard in the departed-owner path (`streams/service.py:499-506`) and the 120 s post-crash lockout. |
| Redis `alive` and `running` (TTL 3600) | `contract.py:78,82`; api `_start_turn` and the heartbeat | is a turn executing; may a new turn start | admission (`alive.ts:285-293`), send refusal (`streams/service.py:308-312`), Stop target resolution (`commands/service.py:1132-1138`), `_settle_not_held` | these are the single arbiter of at-most-one execution. Everything else is a cache of them. |
| `superseded` tombstone and `started` key | `contract.py:94,106` | is this turn dead; when did it start | heartbeat refusal (`streams/service.py:644-666`), late-Stop guard | api-only. |
| `session_streams` row (`turn_id`, `flags`, `updated_at`, `stopping_turn_id`) | Postgres | mirror of the nest for readers; "is beating" | `_session_is_beating` (`commands/service.py:1414-1427`), the UI, the orphan sweep | derived from Redis on every beat (`streams/service.py:846-927`). |
| Runner `SessionPool` entry | `server.ts:423-432`; `session-pool.ts` | does this pod hold a warm environment; is it busy, idle, or parked on an approval | `runWithKeepalive` routing, `/cancel` `holdsSession`, `/kill`, shutdown | per pod. The `busy` state is the fail-open backstop for admission (`session-coordinator.ts:1371-1389`). `awaiting_approval` is the only record that a live prompt is open. |
| Runner `execution-registry` | `execution-registry.ts:62` | which turn this pod runs now | `/cancel` 404 decision, `applyCommand`, late-Stop exactness (`:30-32`) | per pod; its `abort` closure is the only immediate cancel. The heartbeat interruption is the slow equivalent that needs no registry. |
| Runner `ownedSessions` | `alive.ts:97` | which owner keys this pod should release at shutdown | shutdown only | exists only because the owner key never steals. |
| Runner `applied-commands` and `continuation-admission` | `applied-commands.ts:40`; `continuation-admission.ts:53` | has this pod already acted on command X | duplicate deliveries | caches of `session_commands.state`; documented as such (`continuation-admission.ts:9-11`). Across pods they do not dedupe; the api claim `claimed_by` and the outcome guard do. |
| `session_commands.claimed_by` | Postgres `commands/dbas.py:129` | which replica may settle the command | outcome route guard (`commands/service.py:1750-1773`) | written from the runner's `/cancel` answer `replicaId` or `"direct"` (`:1278`). |
| Runner `REPLICA_ID` | `alive.ts:47-48` | the identity written into the owner key, the outcome report, the in-process sandbox label | the owner key, `claimed_by`, `agenta.owner` label | random per boot unless pinned; the chart pins it only at one replica. |
| `inFlightSandboxes` set | `environment.ts:229` | sandboxes mid-turn in this pod | scoped `/kill`, shutdown sweep | per pod; the same sandbox id is in `session_turns.sandbox_id` after turn start. |
| `session_turns` latest row | Postgres | the sandbox id and harness session id to rebuild from | the reconnect ladder, continuity hydration | durable and already the only pointer. |
| `session_interactions` rows | Postgres | which gates are open and how they were answered | durable decisions on the cold path, the api `_execution_is_parked_on_a_gate` (`commands/service.py:931-949`) | durable. The live `permissionId` is not stored and cannot be. |
| Keepalive TTL timers | `session-pool.ts:375-387` | when to stop or delete the sandbox | Daytona billing and the stopped-parked transition | per pod; Daytona autostop and autodelete are the provider-side equivalent with longer windows. |
| Daytona `autoStopInterval` and `autoDeleteInterval` | `provider.ts:117-122` | provider-side cleanup of an abandoned sandbox | nothing in the runner reads them back | the only mechanism that does not depend on any pod. |
| `incompleteSessions` | `persist.ts:213` | may this session be reconstructed from records | `sessions/reconstruct.ts` (per the module comment) | per pod, and lost on a pod change. |

## 12. Answers to the designer's follow-up questions

Where I cite the installed `sandbox-agent` client, the file is
`/home/mahmoud/code/agenta/services/runner/node_modules/sandbox-agent/dist/chunk-TVCDKGSM.js`
(the main checkout's `node_modules`, read only). Its `package.json` says version `0.4.2`,
which is the version this worktree pins (`services/runner/package.json:46`), and the patch in
this worktree applies to that same file (`services/runner/patches/sandbox-agent@0.4.2.patch:1`).
I write the installed file as `chunk.js` below.

### 12.1 sandbox-agent re-attach semantics

**What we pin and where the daemon comes from.** The runner depends on the npm package
`sandbox-agent` 0.4.2 and `acp-http-client` 0.4.2 (`services/runner/package.json:42,46`), from
`https://github.com/rivet-dev/sandbox-agent` (installed `package.json`, `repository.url`). The
daemon inside the sandbox is not built from source in this repo. The Daytona snapshot is built
on the upstream image `rivetdev/sandbox-agent:0.5.0-rc.2-full`
(`services/runner/images/sandbox/daytona/build_snapshot.py:64`), so the daemon is 0.5.0-rc.2
and the client is 0.4.2. The daemon's source is not in this repository, so every statement
about what the daemon does on its own is **unverified** unless the client code implies it.

**What the patch changes** (`services/runner/patches/sandbox-agent@0.4.2.patch`):

- Adds `loadRemoteSession(localSessionId, agentSessionId, sessionInit)` to the ACP connection,
  which sends ACP `session/load` with `sessionId: agentSessionId` and a Claude `resume` option
  (`patch:25-30`, `:182-200`). Records whether the adapter advertised `loadSession`
  (`patch:10`, `:16`).
- Makes `resumeSession` try `session/load` first when the adapter supports it, before the
  pre-existing fallback that creates a fresh remote session and replays text
  (`patch:104-120`).
- Adds `cancelSession(id)`: a managed ACP `session/cancel` that does not mark the record
  destroyed (`patch:130-133`, `:171`).
- Makes a failed reconnect pause the sandbox instead of leaving it, and keeps the provider
  attached when `pauseSandbox` fails (`patch:40-60`, `:63-80`).
- Local provider: spawns the daemon detached and kills its process group
  (`patch:175-218`).

**How the client binds a session.** Session records live in the runner's persist driver, which
is `InMemorySessionPersistDriver` per environment (`environment.ts:751-752`). A record carries
`id` (the local id `<sessionId>:<harness>`, `environment.ts:1516-1518`), `agentSessionId` (the
harness's native id), and `lastConnectionId` (`chunk.js:1313-1322`). Each `SandboxAgent`
instance opens its own ACP connection to the daemon under a random server id
`sdk-<agent>-<randomId>` on the route `/v1/acp/<serverId>?agent=<agent>`
(`chunk.js:553`, `:760-762`, `:2053-2060`; `getLiveConnection` caches one connection per agent
per client instance, `:2042-2084`). The binding local id to agent session id is a map inside
that connection object (`chunk.js:734-735`, `:811-814`).

**What `resumeSession(id)` does** (`chunk.js:1347-1392`, patched):

1. Looks up the record in the pod's persist driver; throws `session '<id>' not found` when
   absent (`:1348-1351`). A fresh pod has an empty driver, which is why the runner seeds a
   synthetic record before calling it (`harness-session-lifecycle.ts:163-171`).
2. If the record's `lastConnectionId` is this connection and the connection has the binding,
   returns the handle as is (`:1353-1355`). This is the only "attach to a live session" path,
   and it is satisfied only inside the same pod and the same `SandboxAgent` instance.
3. Otherwise, if the adapter supports `loadSession` and the record has an `agentSessionId`,
   sends ACP `session/load` for that native id on THIS connection (`:1357-1372`).
4. Otherwise creates a new remote session (`session/new`) and queues a text replay of the
   events the pod persisted (`:1373-1391`).

**Consequence for a new pod.** A second pod never attaches to the first pod's ACP session. It
opens a new ACP connection under a new server id, which (by the route shape) is a new ACP
server inside the daemon, and asks that server to `session/load` the native id. For Claude
that is a `resume` of the transcript on disk; for Pi it is the Pi ACP adapter's load of its
session file. Whether the daemon spawns one harness adapter process per server id, and what it
does with the first pod's adapter and its open `session/prompt` when that pod's SSE stream
drops without a DELETE, is **unverified**: the client sends `DELETE` on an orderly
`disconnect()` (`acp-http-client/dist/index.js:142-144`, `:226-236`), and a pod death sends
nothing. Nothing in the repo reads the daemon's session list, and I found no client call that
lists live sessions on the daemon.

**What a parked permission request looks like from the daemon's side.** The permission request
is a reverse RPC on the first pod's ACP connection (`chunk.js:764-770` sets the client
`requestPermission` callback). When the connection object is gone the callback returns a
cancelled response only if the client is still running; with the pod gone the request simply has
no reader. The daemon behaviour is **unverified**.

### 12.2 Does `teardownHarnessSession` key by the shared local id?

Yes. `teardownHarnessSession` calls `sandbox.destroySession(session.id)` where `session.id` is
the handle's local id (`environment.ts:556-560`; `harness-session-lifecycle.ts:269-285`).
The local id is `<sessionId>:<harness>` on both the create and the load path
(`environment.ts:1516-1518`; `harness-session-lifecycle.ts:198`, `:237-242`).

`destroySession(id)` (`chunk.js:1407-1418`) cancels pending permissions in THIS client, then
`sendSessionMethodInternal(id, "session/cancel", ...)`. That method resolves the record in THIS
pod's persist driver and sends on THIS pod's ACP connection, bound to the `agentSessionId` the
record holds (`chunk.js:1550-1566`). If this connection does not hold the binding, it first
calls `resumeSession`, which would `session/load` the native id on this connection and then
cancel it (`:1558-1561`).

So: pod A's `idle-expiry` teardown sends `session/cancel` for the native `agentSessionId` over
pod A's own ACP connection to pod A's own ACP server in the daemon. Pod B's session with the
same local id and the same native id lives on a different ACP connection and server id. Whether
the harness treats two ACP servers loading one native transcript as one session or two is a
property of the harness adapter inside the daemon and is **unverified**. What is certain from
the client: A never addresses B's connection, and both pods use the same two ids
(local `<sessionId>:<harness>`, native `agentSessionId`). After the cancel, pod A's teardown
also stops the Daytona sandbox when the reason is parkable (`sandbox-lifecycle.ts:164-174`),
which would stop the sandbox under pod B's live session. The in-process path has the same
shape: `destroySession(id)` only touches the host's own map (`harness-host.ts:328-335`).

### 12.3 Turn-start write and conflict handling

**Order in `run-turn.ts`.** The turn index is computed at turn start from the in-memory
continuity store (`run-turn.ts:285-287`). The row is appended at `run-turn.ts:724-764`, after
the prompt blocks are built and before the prompt is sent at `run-turn.ts:1524` or `:1574`.
The append is awaited, and every failure is swallowed: `.catch(() => {})` at `:764`. Inside
`appendSessionTurn` a 409 returns silently and any other non-2xx or network error is logged
and swallowed (`session-continuity-durable.ts:229-271`, specifically `:262` for the 409 and
`:263-269` for the rest). The turn proceeds either way. The row is completed at turn end with
`end_time` and `agent_session_id` (`run-turn.ts:351-365`; `session-continuity-durable.ts:193-226`),
also swallowing failures.

**Api side.** `POST /sessions/turns/` is `append_turn` (`router.py:1966-2000`), which calls the
turns service, which calls `SessionTurnsDAO.append` (`api/oss/src/dbs/postgres/sessions/turns/dao.py:36-70`).
On `IntegrityError` naming `ix_session_turns_project_id_session_id_turn_index` the DAO raises
`EntityCreationConflict` (`dao.py:54-67`). I did not read the mapping of that exception to an
HTTP status in `intercept_exceptions`; the runner code treats 409 as the benign duplicate
(`session-continuity-durable.ts:228`, `:262`), and the prior design notes say two replicas
colliding on `turn_index` surface as a 409 the runner drops
(`docs/design/agent-workflows/scratch/debug-session-turns-append-500.md:64`, from the design
sweep). So the status is 409 (unverified at the exception-mapping line). There is no upsert.

**Consequence.** Two pods that start turn `n` of one session both compute `n` from their own
store (seeded from the same latest row), both send `session/prompt`, and one append is refused
with 409 and ignored. The refused pod's `sandbox_id` and `agent_session_id` are then never on
the ledger for that turn; its `complete` call targets the other pod's row (`POST
/sessions/turns/complete` keys on `session_id, turn_index`, `session-continuity-durable.ts:203-216`).

### 12.4 Heartbeat loop shape

**Interval.** `HEARTBEAT_INTERVAL_SECONDS = 30` (`services/runner/src/sessions/contract.ts:18`),
mirrored from `env.sessions.heartbeat_interval_seconds` default 30 (`env.py:1872-1876`;
`contract.py:49`). `REFRESH_INTERVAL_MS = HEARTBEAT_INTERVAL_SECONDS * 1000` (`alive.ts:25`).
Beat timeout is half an interval (`alive.ts:35`).

**Loop.** `startAliveWatchdog` (`alive.ts:298-407`): one awaited first beat with retry
(`:342-350`), then `setInterval` every 30 s, skipping a tick while a beat is in flight
(`:352-376`). `release()` clears the interval and sends one final beat with `is_running: false`
(`:387-397`). `abandon()` clears without the final beat (`:399-402`).

**Request schema** (runner `alive.ts:170-179`; api `SessionHeartbeatRequest`,
`streams/dtos.py:270-293`): `session_id`, `replica_id`, `turn_id?`, `is_running`, `name?`,
`references?`, `release_owner`.

**Response schema** (`SessionHeartbeatResult`, `streams/dtos.py:302-321`): `stream`
(the row or null), `replica_id` (the actual owner), `is_current_turn`. The runner reads exactly
these three (`alive.ts:191-212`).

**Reaction to `is_current_turn: false`.** `sendHeartbeat` returns `interrupted: true`
(`alive.ts:201`). `handleBeat` fires `onInterrupted` once (`:326-337`). `server.ts` wires it to
`markInterrupted(...)` and `controller.abort(USER_STOP_ABORT_REASON)` (`server.ts:783-789`).
The abort is the same signal `applyCommand` uses through `live.abort()`
(`control-channel.ts:164`; `server.ts:966`). On the first beat a `false` is read as a refused
admission instead (`alive.ts:385`; `server.ts:933-958`).

**Could the beat response carry commands?** The response is parsed into three fields only
(`alive.ts:191-195`). `applyCommand(command, {isParked})` takes a `ControlCommand`
`{id, projectId, sessionId, kind, target, createdAt}` and needs nothing from the transport
except the parked lookup (`control-channel.ts:42-50`, `:107-113`). The `/cancel` route builds
exactly that object from its body and then calls `applyCommand` with `parkedSessionControl`
(`server.ts:1572-1597`). So a list of commands in a beat response could be handed to the same
function. Two structural points: the watchdog is per turn, not per session, so a parked
session beats nothing (`streams/service.py:820-827`; `orphan_sweep.py:87-90` says "the runner
sends one final beat with `is_running: false` and then stops beating on purpose"); and the beat
is authenticated as the invoke caller (`alive.ts:135-137`) while the outcome report uses the
runner token (`control-channel.ts:280-284`).

**Does a beat touch Postgres?** Yes, on every beat. `_heartbeat_locked` reads the row
(`streams/service.py:711-714`) and then creates or updates it (`:875-927`). The DAO update sets
`updated_at = now()` (`streams/dao.py:551`, `:600`). The constant
`HEARTBEAT_WRITE_THRESHOLD_SECONDS` (60) exists (`env.py:1880`; `contract.py:50`) but nothing
outside `env.py` and `contract.py` reads it (grep of `api/oss/src`).

**What depends on the interval.** `_session_is_beating` returns true when the row is
`is_alive` and `updated_at` is younger than `HEARTBEAT_INTERVAL_SECONDS * 2`
(`commands/service.py:1414-1427`). The orphan sweep settles a running turn whose heartbeat is
older than `stale_heartbeat_seconds`, default 90 ("three missed beats"), on the clock of
`session_streams.updated_at` (`orphan_sweep.py:80-85`; `env.py:621-642`). Alive-but-not-running
rows are reclaimed on the longer `idle_grace_seconds` clock (`orphan_sweep.py:87-99`). The command
lease is 90 s, "three heartbeat intervals" (`env.py:689-693`).

### 12.5 Shutdown disposition

**Why in-flight shutdown deletes.** The allowlist comment says only reasons whose daemon is sound
may park (`teardown.ts:54-73`); `shutdown-in-flight` is not listed, `shutdown-idle` is
(`:65`). The recorded rationale is in the warm-Daytona-sessions project: "Shutdown
stop-vs-delete split (open-questions item 2): STILL OPEN. ASSUMPTION ADOPTED (plan's proposal):
delete when a turn is in flight (partial transcript), stop when idle; /kill stays a hard delete"
(`docs/design/agent-workflows/projects/warm-daytona-sessions/implementation-status.md:135-137`;
`pr-body.md:55-57`, `:78-79`). The reason is the partial transcript a half-finished turn leaves
in the sandbox. The reason set was introduced by commit `06c4a3c09d` (2026-07-11, "Reuse
Daytona sandboxes across turns instead of deleting them every turn (#5225)") and refined by
`8766aa714e` and `61efa86e30` (`git log -- services/runner/src/engines/sandbox_agent/teardown.ts`).
No commit message explains the in-flight case beyond the doc above.

**SIGTERM order** (`server.ts:1731-1756`, handler `:1686-1707`):

1. `endActiveTurns(RUNNER_SHUTDOWN_REASON, 5000)`: interrupts every in-process turn so it
   writes its terminal record within 5 s (`server.ts:153`, `:1735`; `active-turns.ts:43-53`).
   Only in-process turns register here (`server.ts:1066-1067`).
2. `pool.destroyAll(timeoutMs, "shutdown-idle", "shutdown-in-flight")` on all three pools:
   idle entries stop the sandbox, busy and awaiting_approval entries delete it
   (`server.ts:1736-1740`; `session-pool.ts:474-501`). An approval-parked Daytona sandbox is
   therefore deleted on a graceful shutdown.
3. `destroyInFlightSandboxes(timeoutMs, "shutdown-in-flight")`: deletes sandboxes mid-turn
   that are not pool entries (`:1741`; `environment.ts:242-257`).
4. `inProcessProvider.settle(...)`: waits for command-sandbox parks and deletes (`:1743-1746`).
5. `releaseOwnedSessions(timeoutMs)`: one `release_owner` beat per owned session (`:1754`;
   `alive.ts:467-484`).
6. `exit(0)` (`:1704`). The whole handler is bounded; `destroyAll` and
   `destroyInFlightSandboxes` default to 5 s each (`environment.ts:243`; `session-pool.ts:475`).
   Kubernetes gives 300 s (`values.yaml:285`), with a 10 s `preStop` sleep first
   (`runner-deployment.yaml:233-244`).

**The in-flight turn on the api afterwards.** The request `finally` releases the watchdog with
`is_running: false` only if the request function reaches it; a Daytona turn interrupted by
`destroyInFlightSandboxes` ends through the sandbox-gone latch or the run's own failure path
(`sandbox-liveness.ts`), so whether the final beat lands before `exit(0)` is bounded by the
5 s budgets. If it does not, the row keeps `is_running: true` until the orphan sweep settles
the execution `lost` after 90 s of stale heartbeat and writes the `error` and `done` records
(`orphan_sweep.py:80-85`; `commands/service.py:1565-1626`; test
`api/oss/tests/pytest/unit/sessions/test_execution_watchdog.py:465` "a lost turn gets an error
then a done"). The owner key is released by step 5 or expires after 120 s.

### 12.6 Daytona activity and autostop during a turn

`refreshActivity` has one call site: `onParkedLive`, after a successful park
(`server.ts:321-324`). It is not called during a turn. Its body is `client.get(id)` with the
comment "Daytona counts API interactions as activity. This is believed to reset its idle-timer
clock; Slice 5 verifies that behavior against a live sandbox" (`daytona-provider.ts:257-272`).
I found no record of that verification in the repo.

During a turn the runner's traffic to the sandbox goes through the Daytona preview proxy: the
ACP SSE stream and POSTs (`environment.ts:834-839`, `createCookieFetch`), and the liveness
probe `GET <base>/v1/health` every 30 s (`sandbox-liveness.ts:55-57`, `:104-111`). Whether
proxy traffic counts as Daytona activity is **unverified** in code. The project notes say
"stop timer DAYTONA_AUTOSTOP 15 min (env-overridable, resets on every turn's API activity)" and
record a review comment "auto-stop as a blocker resolved by the 15-min stop timer greater than
the 300s max silent interval" (`implementation-status.md:35-36`, `:139-140`). The 300 s figure
is the run's idle limit; the claim that the stop timer resets on turn traffic is the project's
assumption, not a cited Daytona behaviour. `autoStopInterval` is set at create from
`autostopMinutes`, default 15 (`provider.ts:120`; `runner-config.ts:72`).

### 12.7 The browser send request and history

**Browser.** The playground sends only the trailing user message on a fresh user turn when a
session id is present, and the full (answer-pruned) history on an approval resume:
`outboundMessages = opts.sessionId && lastMessage?.role === "user" ? [lastMessage] : history`
(`web/packages/agenta-playground/src/state/execution/agentRequest.ts:434-442`). The comment
says "let the runner rebuild prior turns from the durable record log".

**SDK.** `to_messages` converts what the client sent (`handler.py:447`) and `request_to_wire`
serializes them as `messages` (`sdks/python/agenta/sdk/agents/utils/wire.py:155`). No SDK code
trims or extends the list (grep for last-message or minimal-history helpers found none).

**Runner.** `carriesMinimalHistory(request)` is true for exactly one fresh user message
(`session-identity.ts:596-599`). `reconstructHistoryIfNeeded` then rebuilds prior turns from
`POST /sessions/records/query` and fails the turn when the log is unreadable or marked
incomplete (`reconstruct-history.ts:1-16`; called from `run-turn.ts:495-499`). In the
coordinator, `historyAsserted = assertsPriorConversation(request)` is false for such a request
(`session-coordinator.ts:335-337`; `session-identity.ts:522-524`), and the warm check skips the
history comparison when `carriesMinimalHistory` (`session-coordinator.ts:959-963`, `:984`).
The approval-resume branch compares only the tail when the park did not assert a transcript
(`:1224-1231`).

**Consequence.** For the playground path the history fingerprint is not what protects a warm
session from an edited transcript; the durable record log is the conversation of record, and
any pod can rebuild it. The fingerprint is checked only for clients that send a full
transcript (an approval resume, a headless caller).

## 13. Verification of the review's claims

Installed packages cited below are read from the main checkout's `node_modules`
(`/home/mahmoud/code/agenta/services/runner/node_modules/`), read only. `@daytonaio/sdk` is
version 0.198.0 there (`@daytonaio/sdk/package.json:3`); I did not verify that the worktree's
lockfile pins the same version, so SDK doc quotes are marked as such.

### 13.1 The Secret wrapper on reconnect

**Confirmed.** `daytonaWithProcessLocalSecrets(...).reconnect(sandboxId)`
(`services/runner/src/engines/sandbox_agent/daytona-secret-provider.ts:429-439`):

```ts
const entry = registry.get(sandboxId);
const activeProvider = providerFor({});
if (!entry) {
  // The runner restarted or lost ownership. It cannot prove which Secrets back the parked
  // sandbox, so delete the sandbox and force the caller onto a fresh create.
  await destroySandboxIdempotently(activeProvider, sandboxId);
  throw new DaytonaReconnectTerminalError(sandboxId, "missing-process-local-secret-allocation");
}
```

Two more delete-and-throw branches follow when an entry exists but the create fingerprint or
the Secret slot set differs (`:453-459`, `:470-477`), and the plain provider reconnect failing
also runs `cleanupAfterSandbox` (`:479-492`). `cleanupAfterSandbox` deletes the sandbox first,
then releases the Secrets (`:300-350`).

**The wrapper applies by default with zero candidates.** `run-plan.ts:885-903`: "ON (the
default): the plan splits every opaque_http value out of the plaintext env and is ALWAYS kept,
even with zero candidates, so the provider wrapper (and its create fingerprint) governs every
Daytona reconnect that hides credentials." The plan is built when `isDaytona &&
daytonaOpaqueSecretsEnabled()` (`:897-899`); the default is on unless
`AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS` is an off value (`daytona-secret-plan.ts:342,370-375`).
`provider.ts:249-274` wraps whenever a plan exists.

**How the reconnect reaches the wrapper.** `sandbox-lifecycle.ts:82-92` calls
`startSandboxAgent({...startOptions, sandboxId})`; the patched client calls
`provider.reconnect(rawSandboxId)` (`patches/sandbox-agent@0.4.2.patch:48-51`), and the provider
is the wrapped one. The thrown `DaytonaReconnectTerminalError` is caught at
`sandbox-lifecycle.ts:93-104` and the ladder falls through to `provider.create`.

**Consequence, stated plainly.** Today, when pod B reads `session_turns.sandbox_id` for a
sandbox pod A created, pod B's wrapper has no registry entry, so pod B **deletes pod A's
sandbox** (running or stopped) and creates a fresh one. This is true for every Daytona-path
session on a deployment with opaque Secrets enabled, including sessions with no Secret at all.
The same happens after a single-pod restart. On a two-pod deployment it also destroys a sandbox
pod A may still be serving from its pool; the harness process inside dies with it.

**The registry entry, field by field** (`daytona-secret-provider.ts:26-34`):
`lease: DaytonaSecretLease` (the allocation: `attachments` env-name to Secret-name map,
`mcpHeaderPlaceholders`, `created: DaytonaSecretRecord[]` with `id`, `name`, `placeholder`,
`hosts`, and `bySlot` slot-key to record, `daytona-secrets.ts:15-20`, `:44-60`);
`plan: DaytonaSecretPlan`; `createFingerprint: string` (sha256 of image plus the create
request, `provider.ts:158-163`); `generation: number`; `operation: Promise<void>`;
`cleanupTimer`. Nothing is written to Daytona or to the api.

**Recoverability from Daytona.** Secret names are random: `agenta_<36 hex>_<ordinal>`
(`daytona-secrets.ts:255`), not derived from the sandbox id. The Daytona-path create sets no
`labels` (grep of `provider.ts`, `daytona.ts`, `daytona-secret-provider.ts` finds none; the
in-process command sandbox does, `command-sandbox.ts:417-423`). The SDK supports
`labels` on create and `daytona.list({labels})` (`@daytonaio/sdk/esm/Daytona.d.ts:120,139,324-328`)
and `sandbox.setLabels` (`Sandbox.d.ts:191-206`). The SDK `SecretService.list` filters by
`name` only (`Secret.d.ts:64-70`, `:111`). The `Sandbox` type has a setter that "Replaces the set
of vault secrets mounted in the Sandbox" (`Sandbox.d.ts:478-486`); I found no getter that lists
the Secrets a sandbox has mounted (unverified beyond a grep of `Sandbox.d.ts`). So today nothing
on Daytona links a sandbox to its Secrets or to a session.

**Why delete, not adopt.** The module comment: "Secret ownership is process-local BY DESIGN: the
registry dies with the runner process, so a hard crash can orphan a Daytona Secret (until
Daytona's auto-delete backstop reaps the sandbox). This is an accepted limit of the
process_local mode, not a bug to patch here — durable reconciliation is an explicit follow-up
(PR B of the Daytona-Secrets design; see PR #5278)" (`daytona-secret-provider.ts:207-212`). The
branch comment: "It cannot prove which Secrets back the parked sandbox, so delete the sandbox
and force the caller onto a fresh create" (`:433-434`).

### 13.2 Durable hole detection in the record log

**Sequence numbers exist.** With `AGENTA_SESSIONS_SEQUENCE_WRITES` on (default `true`,
`env.py:1853-1855`), each ingested record gets a per-session `sequence` from
`session_sequence_cursors.latest_sequence + 1` in the same transaction
(`api/oss/src/dbs/postgres/sessions/records/dao.py:73-116`). The `records.sequence` column is
nullable (`records/dbas.py:40-43`); reads order by `sequence` with legacy null-sequence rows
first (`records/dao.py:261-275`). So the durable log is dense in `sequence` for every record
that reached Postgres, and the cursor says how many should exist.

**What triggers `noteRecordsIncomplete`.** A record whose ingest POST failed all retries
(default 6 attempts with exponential backoff, `persist.ts:50,98-149`) increments
`persistFailures`. At the request's `finally`, `takePersistFailures` reads and clears it and
calls `noteRecordsIncomplete(sessionId)` when it is non-zero (`server.ts:1154-1163`). The flag
is a pod-local `Set` (`persist.ts:213-228`).

**Where the flag is read.** `reconstructHistoryIfNeeded` throws when `recordsIncomplete(sessionId)`
and the request carries minimal history or an approval reply only
(`reconstruct-history.ts:81-99`). It also throws when the fetch fails or when a record carries a
legacy whole-body truncation marker (`:92-96`, `:106-110`). The records fetch posts
`/sessions/records/query` with `session_id` and reads `records` (`records-query.ts:38-59`).

**Could the reconstruct derive "incomplete" from the sequence?** The information is there: a
dropped record never got a sequence, so the stored sequences are still dense; a gap cannot appear
from a drop. What a drop produces is a missing event, not a hole in `sequence`. To detect it
durably the writer would have to stamp its own ordinal: the runner already sends `record_index`
(per turn, restarts at 0 each cold turn, `persist.ts:109-113`; `records/dbas.py:44-50`), and
the api stores it. A reader could detect a gap in `record_index` within one `turn_id`; I found
no code that does this (grep of `reconstruct.ts`, `reconstruct-history.ts`, `records/dao.py`).
Whether `record_index` is gap-free per turn by construction is unverified: the coalescing
emitter claims indexes for tool calls early and skips indexes for events it never persists
(`persist.ts:302-429`), so a gap check would need to account for that.

### 13.3 Parked versus running, as the api sees it

**Confirmed.** The runner's `release()` sends `is_running: false` with the turn id
(`alive.ts:387-397`), and the request `finally` always calls it (`server.ts:1164`). The api's
`elif not request.is_running` branch releases only `running` and only if this turn holds it;
`alive` "outlives the turn (own TTL, cleared only by kill)" (`streams/service.py:820-837`). A
parked approval therefore leaves `alive = turn_id`, `running` absent, for up to 3600 s.

**Can `request_cancel` tell parked from running?** Partly. `_resolve_target` reads `running`
first and falls back to `alive` only when the caller named an `expected_turn_id`
(`commands/service.py:1120-1150`). An unfenced Stop with no `running` targets nothing and settles
`not_running` (`:389-411`). A named Stop reaches the parked turn through `alive`. The service does
not read the interaction rows at admission; it does so elsewhere for the continuation path
(`_execution_is_parked_on_a_gate`, `:931-949`). The lock it holds is `lock_for_control` on the
execution row, not a Redis lock (`:489-494`). The Redis keys alone say "alive without running",
which is also the state between two ordinary turns, so they do not distinguish "parked on a
gate" from "idle after a finished turn"; the pending interaction row does.

**When the interaction row is created relative to the park.** `recordPendingInteraction`
posts the row through `createInteraction` as a fire-and-forget at the moment a gate resolves to
"ask" (`run-turn.ts:1026-1042`; wired at `:1246`, `:1336`, `:1349`, `:1373`). The pause that
ends the turn fires afterwards (`:784`), and the turn's final beat happens later still, in the
request `finally`. So yes: a `pending` interaction row exists while the turn is still running
and beating, for the time between the gate and the park. On the cold path (no park) the row also
exists while the turn tears down. `_session_is_beating` (`commands/service.py:1414-1427`) would
read such a session as beating.

### 13.4 The orphan sweep as an owner-key reader

The sweep reads the owner value before it collapses a stale row, and uses it only as a
compare-and-delete guard: "Capture the affinity generation before the guarded database update.
Redis cleanup compares this replica and the swept turn atomically after commit, so a new Send or
Steer generation cannot be deleted" (`orphan_sweep.py:571-590`, `get_owner_value` at `:587`).
It later passes that value to `release_watchdog_turn` (`:829-835`, `:881`) and in one path calls
`force_clear_owner` (`:872`). The Lua `WATCHDOG_RELEASE_TURN_LUA` (`contract.py:216-246`) deletes
`alive` and `running` only when they equal the swept turn, deletes `owner` only when it equals the
observed value and no foreign turn holds the locks, and always writes the `superseded` tombstone
for the swept turn. The sweep never routes to a replica or reads the replica id for anything but
this guard.

### 13.5 Confirmed cancellation

**Confirmed.** `teardown.ts:66-69`: "`cancelled`: A settled Stop. The harness answered its
cancelled prompt, so nothing inside the daemon is mid-flight and nothing baked into it is stale.
An UNSETTLED Stop never reaches this reason: it stays `aborted`, which deletes." `cancelled` is in
the parkable allowlist (`:69`); `aborted` is not, so it deletes (`:75-83`).

**How the settled fact flows.** `runTurn` calls `cancelHarnessTurn` only on a user Stop
(`run-turn.ts:1694-1711`) and records `cancelSettled = cancel.settled` (`:1709`). The result
carries `cancelSettled` (`:1997`). `shouldPark` requires `cancelSettled === true` for a settled
user Stop to park (`engine.ts:67-72`). The one-turn path maps that to reason `cancelled`
(`engine.ts:124-136`); the pooled path parks the environment as `idle` on the stopped TTL and
never names `cancelled` as a teardown reason (`session-coordinator.ts:795-805`, `:858-865`).

**The shutdown path.** It does not call `cancelHarnessTurn`. `pool.destroyAll` passes fixed
reasons `shutdown-idle` for idle entries and `shutdown-in-flight` for busy and approval-parked
entries (`server.ts:1736-1740`; `session-pool.ts:474-501`), and `destroyInFlightSandboxes`
passes `shutdown-in-flight` (`server.ts:1741`). `env.destroy` then sends `destroySession`
(ACP `session/cancel` plus the record mark, `harness-session-lifecycle.ts:269-285`;
`chunk.js:1407-1418`) without waiting for the prompt to settle, and deletes the sandbox. The
settled or unsettled result is not available there because no wait happens. For in-process
turns, `endActiveTurns` resolves the turn's `shuttingDown` promise so `awaitTurnOrAbandon`
abandons it after a 3 s grace (`server.ts:155-158`, `:1080-1088`); the abandoned run's own
teardown then runs with the reason its path picks.

### 13.6 Admission for the same turn on two pods

**Both pods are admitted.** Trace of a second pod B beating `turn_id = T` while pod A already
beats T:

1. `claim_owner_value` returns A's value `A\x1fT`; `owner != B` (`streams/service.py:671-681`).
2. `_reclaim_affinity_from_a_departed_replica` runs. The guard is `running_owner is not None and
   running_owner != request.turn_id` (`:515-521`). `running` holds T, which equals B's turn id,
   so the guard does not refuse. B releases A's value and claims the owner key (`:527-539`).
3. `refresh_alive(T)` succeeds because `alive == T` (`locks.py:181-196`), so `is_current_turn`
   stays true (`streams/service.py:731-736`, `:791-793`). `record_turn_start` is write-once and
   keeps the first start (`locks.py:315-345`). `refresh_running(T)` succeeds (`:800`).
4. A's next beat finds `owner = B\x1fT`, takes the same reclaim path, and wins the key back. Both
   pods run T and the owner key flips on every beat. Nothing marks either as interrupted.

Nothing binds a turn to one replica at admission. The Lua `ACQUIRE_ALIVE_WITH_START_LUA`
(`contract.py:248-259`) keys only on the turn id. The runner's `firstBeatOwned` is
`is_current_turn === true` (`alive.ts:211`, `:405`), which both pods receive. The owner value
carries the turn id (`contract.py:59-60`), but the reclaim path treats a matching turn id as the
caller's own lock (`streams/service.py:489-494`). The process-local
`claimContinuationAdmission` dedupes continuation deliveries only within one pod
(`continuation-admission.ts:9-11`); across pods the api's `reportContinuationAdmission` CAS
admits one (`control-channel.ts:325-334`; `commands/service.py:1800-1880`), so a continuation
is single-admitted but a plain `/run` retry with the same turn id is not. I found no test for
two replicas beating one turn id (`test_heartbeat_lock_races.py:98-229` covers single-replica
races).

### 13.7 The sandbox id in the turn row for the in-process path

**When it is written.** The append happens once per turn at turn start (`run-turn.ts:724-764`)
with `sandboxId: env.sandbox?.sandboxId` (`:738`). For in-process, `env.sandbox` is the
`InProcessHarnessHost` (`environment.ts:897-898`, `:907`) and `sandboxId` is
`this.workspace?.sandbox.sandboxId` (`harness-host.ts:112-115`), which is
`CommandSandbox.current?.id` (`command-sandbox.ts:229-231`). `current` is set only by
`create` (`:432`), which runs inside `bringUpOnce` on the first `acquire`, which is the first
tool call that needs the sandbox (`:361-386`; `conversation-workspace.ts:233-258`). So on the
first turn of a conversation the append carries no `sandbox_id`; on a later turn it carries the
id of the sandbox the previous turn created, which may be stopped. The `complete` call updates
only `end_time` and `agent_session_id` (`turns/dao.py:79-81`), so a row never gains `sandbox_id`
after its append.

**Formats.** On the Daytona path `env.sandbox.sandboxId` is the client's prefixed handle
`daytona/<raw>` (`chunk.js:1143-1144`); the runner strips the prefix for metering
(`environment.ts:937`) and for `refreshActivity` (`daytona-provider.ts:258-260`). The
reconnect passes the stored value to `startSandboxAgent({sandboxId})`, whose
`parseSandboxProviderId` requires the `{provider}/{id}` form (`chunk.js:1137-1143`,
`:2691-2700`), and the wrapper's registry accepts both forms (`daytona-secret-provider.ts:98-110`).
`daytonaWithLifecycle.deleteSandbox(id)` passes its argument straight to `client.get`
(`daytona-provider.ts:318-321`), so it expects the raw id. On the in-process path the id is the
raw Daytona id (`daytona-api.ts:148-150`, `:210-212`). The two providers therefore store
different shapes in the same column: `daytona/<raw>` and `<raw>`. The in-process reconnect
ladder reads the pointer too (`isDaytona` is `commandsInRemoteSandbox`, true for in-process,
`environment.ts:889`) but its `startSandboxAgent` ignores the id (`environment.ts:897-898`).

### 13.8 The benign 409 on approval resume

**Confirmed.** `env.continuityTurnIndex = nextTurnIndex(sessionId, continuityStore)` at turn
start (`run-turn.ts:285-287`), and the store advances only on `record()`, which a paused turn
never calls: "The shared store advances only on `record()` (paused turns record nothing), so
park-and-resume consumes one index" (`run-turn.ts:283-284`; `session-continuity.ts:143-153`).
The resume therefore appends the same `turn_index` as the paused turn, the api answers 409
(`turns/dao.py:54-67`), and `appendSessionTurn` returns silently on 409 (`session-continuity-durable.ts:262`).
The test "treats a resume execution's duplicate-start 409 as benign" asserts no log line
(`services/runner/tests/unit/session-continuity-durable.test.ts:414-431`). The row's `turn_id` and
`sandbox_id` therefore stay those of the paused turn's pod.

**Can the runner tell at the append?** Yes. `opts.resume` and `opts.settleApprovalsThenPrompt`
are set by the coordinator before `runTurn` (`session-coordinator.ts:1329-1338`) and are read
in `runTurn` before the append (`run-turn.ts:293-305`). `approvalReplyOnly =
carriesApprovalReplyOnly(request)` is computed at `:501`, before the append at `:724`.
`request.controlCommandId` is on the request throughout (`server.ts:607-611`). None of these is
passed to `appendSessionTurn` today (`:724-764`).

### 13.9 Daytona lifecycle semantics

From the installed SDK types (`@daytonaio/sdk` 0.198.0, read only):

- `setAutostopInterval`: "The Sandbox will automatically stop after being idle (no new events)
  for the specified interval. Events include any state changes or interactions with the Sandbox
  through the sdk. Interactions using Sandbox Previews are not included." (`esm/Sandbox.d.ts:379-386`).
  Create parameter: "Auto-stop interval in minutes (0 means disabled). Default is 15 minutes"
  (`esm/Daytona.d.ts:122`).
- `setAutoDeleteInterval`: "The Sandbox will automatically delete after being continuously
  stopped for the specified interval." (`esm/Sandbox.d.ts:439-445`). Create parameter: "negative
  value means disabled, 0 means delete immediately upon stopping. By default, auto-delete is
  disabled" (`esm/Daytona.d.ts:125`). So autodelete counts from the stop, not from last activity.
- `autoPauseInterval` and `autoArchiveInterval` exist too (`esm/Daytona.d.ts:123-124`); the runner
  sets neither (`provider.ts:117-122`).

**Consequence for a running turn.** The runner's traffic during a turn (the ACP SSE stream, the
tool POSTs, the liveness probe) goes through the Daytona preview proxy
(`environment.ts:834-839`; `sandbox-liveness.ts:104-111`). By the SDK text, preview
interactions do not count as events. The runner makes no SDK call during a turn
(`refreshActivity` is called only on park, `server.ts:321-324`). So a turn that runs longer than
`autoStopInterval` (15 minutes) with no SDK call is, by the SDK's own doc, stopped under the
runner. Whether Daytona in practice counts proxy traffic is **unverified**; the project notes
assumed the timer "resets on every turn's API activity"
(`docs/design/agent-workflows/projects/warm-daytona-sessions/implementation-status.md:35-36`),
and the SDK text contradicts that assumption for preview traffic.

## 14. The send path, for routing a follow-up to the holder pod

### 14.1 Who sends `/run` for a plain user message from the playground

**The browser posts straight to the services `/invoke`. The api is not on that path.** The
playground builds the request with `invocationUrl = \`${serviceUrl}/invoke\`` where
`serviceUrl` is the workflow revision's stored `data.url` or is built from its `uri`
(`web/packages/agenta-entities/src/workflow/state/runnableSetup.ts:240-260`). The chat hook hands
`{api: req.invocationUrl, headers, body}` to the AI SDK transport
(`web/packages/agenta-chat/src/hooks/useAgentConversation.ts:424-431`, `useChat` at `:519`). The
body carries `session_id` and, for a shared stream, `flags: {detached: true}`
(`web/packages/agenta-playground/src/state/execution/agentRequest.ts:445-449`). No non-generated
browser code calls `POST /sessions/streams/` (grep of `web/packages/*/src` and `web/mobile/src`
finds the route only in the generated Fern client,
`web/packages/agenta-api-client/src/generated/api/resources/sessions/client/Client.ts:204`).

On this path the services handler reads `turn_id` from `meta.run_id`, which the browser does not
set, so the runner mints the turn id (`server.ts:257-259`). The runner's first heartbeat then
takes `alive` from the previous turn through the handover branch (`streams/service.py:743-792`).
The services handler also says so: "the playground posts a turn straight to this service, so
`meta` is client input on the path the browser uses" (`sdks/python/agenta/sdk/agents/handler.py:540-546`).
`_start_turn` is therefore not on the plain playground path. Its only callers are
`SessionStreamsService.command` for `send` and `steer` (`streams/service.py:313`, `:328`), which
the api route `POST /sessions/streams/` reaches (`router.py:537`) and which `channels/commands.py:181`
uses only for cancel. Research 1.1 step 3 is corrected accordingly.

**Continuation after an approval.** `respond_interactions` creates the continuation command, and
delivery is `DirectControlDelivery.continue_interaction` → `interactions_dispatcher.respond_many`
→ `invoke_workflow_detached(..., run_id=<continuation execution id>, control_command_id=...)`
(`api/entrypoints/routers.py:1516-1527`; `interactions_dispatcher.py:461-480`). The api posts
`{service_url}/invoke` with `meta.run_id`, `meta.project_id`, `meta.control_command_id`
(`workflows/service.py:3315-3345`); `service_url` is the revision's `url` or
`env.agenta.services_url` plus the path inferred from its `uri` (`:765-779`).

**Queued input (`continue_input`).** Same hop: `routers.py:1527` wires `continue_input` to
`invoke_workflow_detached`, and the queued-input start path calls it with
`run_id=execution_id, strict_start=True` (`api/oss/src/core/sessions/starts/service.py:323-329`).
Triggers, channel inbox and the queue workers also go through `invoke_workflow_detached`
(`routers.py:1004`; `worker_queues.py:249,321,465`; `channels/inbox.py:1079`). None of these
callers acquires `alive` first (grep for `_start_turn` and `acquire_alive` outside
`streams/service.py` finds none in `starts/service.py`, `interactions_dispatcher.py`,
`workflows/service.py`); the runner's first beat does.

So there are two senders of `/invoke`: the browser (plain turn, approval resume from the
playground) and the api (`invoke_workflow_detached`: continuations, queued inputs, triggers,
channels). Both reach the same services handler and the same SDK transport.

### 14.2 Where an address can ride

**Api side.** `invoke_workflow_detached` is the only place the api stamps `meta`
(`workflows/service.py:3317-3321`). A `runner_url` would be set there, next to `run_id`. It
cannot be set on the browser path, because the api is not in it.

**Services and SDK side.** `_meta_string(name)` reads `request.meta` (`handler.py:536-538`) and
feeds `SessionConfig` (`:555-563`). The runner URL is fixed at backend construction:
`SandboxAgentBackend(sandbox=..., url=runner_url(), cwd=...)` in `select_backend`
(`services/oss/src/agent/app.py:86-92`), stored as `self._url`
(`sdks/python/agenta/sdk/agents/adapters/sandbox_agent.py:160-166`), and used by
`_deliver_stream` → `deliver_http_stream(self._url, payload)` (`:228-229`). `select_backend` is
called from the handler before the meta is read (`handler.py:436-438` versus `:555-563`), with
only `agent_template` as input (`app.py:73-74`). A per-turn URL would need `select_backend` or
the backend to receive it.

**Trust.** On the browser path `meta` is client input (`handler.py:540-546`). The `/run` body
carries plaintext provider credentials and bearer tokens (`server.ts:161-172`), so a client-supplied
runner URL would let a caller redirect those to any host. The existing code refuses to read
`meta.session_context` for the same reason (`handler.py:540-546`).

**Transport fallback.** `deliver_http_stream` is one `httpx` streaming POST to
`base_url + "/run"` with no retry and no second base URL (`ts_runner.py:189-213`). An HTTP status
of 400 or more raises `RuntimeError` through `_transport_error` (`:197-203`, `:48-58`). A
connection failure raises the `httpx` exception uncaught (no `try` around the `async with` at
`:193-211`). A stream that ends without a `result` record raises `RuntimeError` (`:212-213`). The
one-shot `deliver_http_result` is marked dev-only (`:60-66`). So a fallback to the Service URL
on connection error does not exist today; it would be new code in this function or in the backend.

**What the services layer already asks the api per turn.** `_bounded_session_context`
(`handler.py:547-551`) runs `resolve_session_context`, which reads `GET /sessions/streams/`
with `session_id` and `POST /sessions/turns/query` with `windowing: {limit: 1}`
(`sdks/python/agenta/sdk/agents/platform/session_context.py:347-355`, under
`_read_session_facts`). The second call returns a `session_turns` row, which already carries
`turn_id` and `sandbox_id` (`turns/dbas.py:22,33`); the query's ordering is not specified there
(`windowing: {limit: 1}` without `order`), so whether it returns the latest row is **unverified**.
The call is bounded by a budget and every failure returns "no facts" (`:225-235`). This is the
existing per-turn api read a `runner_url` could ride on, for both senders. The tool and
connection resolution calls (`handler.py:447-470`) also reach the api, through other endpoints.

### 14.3 Is the previous turn's id available at `_start_turn` time?

**Reconciliation.** `_start_turn` refuses when `alive` is held (`streams/service.py:308-312`,
`:1203-1213`), and `alive` outlives a turn for its 3600 second TTL (`:820-827`). Both are true.
They do not conflict because `_start_turn` is not on the plain follow-up path (14.1). On the api
send command, a plain `send` on a session whose previous turn ended within the hour is refused
with 409 `SessionTurnInUse` (`router.py:296-303`); a `steer` (`force: true`) displaces and
starts (`:326-339`). I did not find a client that uses `send` for a follow-up on a live session
(unverified).

**Plain follow-up from the playground.** The runner mints `T_new` and beats. In
`_heartbeat_locked`, `refresh_alive(T_new)` fails because `alive == T_prev`;
`acquire_alive_with_start` fails; the api reads `alive_owner = T_prev` and `running_owner =
None`, releases `alive` for `T_prev`, tombstones `T_prev`, and acquires for `T_new`
(`streams/service.py:731-792`, `alive_owner` at `:744-748`). So the api sees the previous turn
id at the first beat, which is after the services layer has already posted `/run` to a runner.
Before that beat, the api is not involved. The previous turn id is durable in two other places
the api or the services layer can read before the invoke: `session_streams.turn_id` (the
mirror written by the last beat, `streams/service.py:866`, `:883`, `:924`; column
`streams/dbes.py:60`) and the latest `session_turns` row (`turns/dbas.py:22`). Redis `alive`
also holds it for an hour.

**First turn after a parked approval's continuation.** The parked turn `T_parked` holds `alive`
with no `running` (research 13.3). The api creates the continuation execution with
`parent_execution_id = T_parked` and the command with `expected_turn_id = T_parked`
(`commands/service.py:797-822`), then invokes with `run_id = <continuation id>`. The runner's
first beat for the continuation takes the same handover branch from `T_parked`. So on this path
the api knows `T_parked` before the invoke: it is the command's `expected_turn_id`, the
execution's `parent_execution_id`, the stream row's `turn_id`, and the `alive` owner.

### 14.4 Liveness of the bound pod

What exists today, in order of cost:

- **No pod-level heartbeat.** Beats are per turn: `startAliveWatchdog` runs inside one `/run`
  request and `release()` stops it at turn end (`alive.ts:298-407`; `server.ts:779`, `:1164`).
  A parked or idle session beats nothing (`orphan_sweep.py:87-90`). The only pod-wide signals
  are the graceful-shutdown `release_owner` beats (`alive.ts:467-484`) and `GET /health`, which
  Kubernetes pulls (`runner-deployment.yaml:211-232`); nothing records `/health` results.
- **The owner key TTL** (120 s) is refreshed only by beats of a running turn
  (`streams/service.py:671-677`); it says nothing about an idle pod that holds a warm pool entry.
  A `bound:` key with the same refresh rule would have the same limit.
- **`session_streams.updated_at`** ages the same way; `_session_is_beating` reads it with a
  two-interval window (`commands/service.py:1414-1427`).
- **Fallback on connection error** does not exist in the transport (14.2). A pod that is gone
  answers with a connection refusal or a DNS failure at the pod IP; a pod that is up but holds
  nothing answers `/run` normally and takes the cold path (research 3.5), which is the behaviour
  of the Service URL today.

Nothing today tells the api whether a given pod is alive between turns. The durable facts it
has are the last beat time and the owner or binding TTL, both of which stop moving when the turn
ends.
