# Runner tools, permissions & security — deep review (2026-07-05)

Scope: `services/runner/src/tools/*`, `permission-plan.ts`, `extensions/agenta.ts`,
`sessions/auth.ts`, secret propagation, `engines/sandbox_agent*`, and the MCP-disabled path.
First-party pre-launch review. READ-ONLY — no source changed.

Deployed topologies considered:
- **Dockerized sidecar in Compose (EE/OSS)** — one long-lived runner process; `local` sandbox
  runs the harness as a child process **on the runner host, same uid**; `daytona` sandbox runs
  the harness in an isolated cloud VM.
- **Daytona** — the actual isolation boundary. `local` is NOT an isolation boundary.

---

## Verified map: tool execution + permission flow

**Where the /run request originates.** Python agent service (`services/oss/src/agent/`) resolves
tools, secrets, trace, permissions and POSTs the wire request to the runner (`server.ts` `/run` /
`/stream`). The runner *runs*; it does not decide *what* to run.

**Three tool executor kinds** (`ResolvedToolSpec.kind`): `code` (disabled — throws), `client`
(browser-fulfilled, paused across a turn), `callback`/default (POST back to Agenta `/tools/call`,
or a `call` direct-call descriptor for reference/platform tools).

**Three delivery channels, one dispatch.**
- **Pi** loads the bundled extension (`extensions/agenta.ts`), which `registerTool`s each public
  spec; `execute` → `runResolvedTool` (`dispatch.ts`) → file relay (`relay.ts`) → runner memory →
  `/tools/call` or a direct call. Private spec/`callRef`/scoped env/callback auth NEVER leave the
  runner; only `{name, description, inputSchema}` cross to the harness.
- **Claude (local)** takes tools over an **internal loopback HTTP MCP server**
  (`tool-mcp-http.ts`, bound `127.0.0.1`, ephemeral port, no auth), advertised as a
  `type:"http"` MCP server. `tools/call` → `runResolvedTool` → same relay/dispatch.
- **Daytona** — internal MCP is skipped (loopback unreachable from the VM); Pi uses the sandbox
  **file relay** (`sandboxRelayHost` = remote `ls`/read/write). Non-Pi + Daytona + tools is
  **refused** up front (`REMOTE_TOOLS_UNSUPPORTED_MESSAGE`).

**Permission decision points (four, all keyed off `permission-plan.ts` `decide`):**
1. Python SDK `claude_settings.py` pre-answers Claude gates (out of scope here).
2. **ACP responder** (`acp-interactions.ts`) — Claude raises gates over ACP; runner answers or
   pauses. `enforce:false` for the relay on Claude (harness gates first).
3. **Relay enforcement** (`relay.ts`) — the ONLY gate for Pi (`enforce:true`). Also the Pi
   builtin gate via `handlePermissionRelayRequest` (protocol-versioned, unknown builtin → deny).
4. **Client-tool ladder** (`responder.ts`) across pause/resume.

**Defaults.** No `permissions` block → `default:"allow_reads"` (reads allow, writes → ask →
pendingApproval). Unparseable policy → `ask`. `SANDBOX_AGENT_DENY_PERMISSIONS=true` → deny-all
kill switch. A tool with no record and no readOnly hint is treated as a **write → ask** (fails
safe). `specPermission` (author-set) short-circuits everything.

---

## Strengths — keep this

- **`code` execution is genuinely sealed.** `runCodeTool` throws unconditionally; `run-plan.ts`
  `hasCodeTool` refuses the run up front (avoids laundering a per-call throw into an `ok:true`
  reply). Defense-in-depth at every delivery path.
- **stdio MCP is sealed on three sides.** `run-plan.ts` `hasStdioMcpServer` refusal +
  `toAcpMcpServers` throw + `mcp-server.ts` refusing stub. No route reopens the runner-host child
  process. Internal channel restored as loopback HTTP (no child process) — correctly kept
  independent of the user-MCP gate.
- **`directCallUrl` SSRF guard is well built** (`direct.ts`): method allowlist, single-absolute-
  path check, `..`/backslash/CRLF rejection, origin lock to the run's own callback origin, mount
  confinement, `redirect:"manual"` (no SSRF-via-redirect), scalar-only path params, error detail
  kept server-side. Prototype-pollution guards (`deepSet`/`deepMerge`/`resolveCtxToken` reject
  `__proto__`/`constructor`/`prototype`, own-keys only).
- **Clear-then-apply secret discipline** (`daemon.ts` `KNOWN_PROVIDER_ENV_VARS` + managed run
  clears all provider env, applies only resolved `plan.secrets`) — an inherited key for another
  provider cannot leak into a managed run. Superset clear list covers AWS/GCP/Azure groups.
- **Secrets are not logged.** Log lines print key **names** only (`secretKeys=[...]`,
  `auth=yes/no`); debug tool-body logging is env-gated (`AGENTA_RUNNER_DEBUG_TOOLS`). Mount creds
  ride env, never argv (no process-table leak). Direct-call errors keep URL/body server-side.
- **User HTTP MCP SSRF guard** (`mcp.ts` `validateUserMcpUrl`): https-only, blocks
  loopback/link-local/`169.254.169.254`/private literals; capability flag-gated off by default.
- **Fail-loud not-implemented gates** for local `network`, any `filesystem`, remote non-Pi tools.
- **Permission engine is heavily unit-tested** (`permission-plan.test.ts` truth table,
  `permission-parity.test.ts` ≥36 cases, protocol-version + unknown-builtin fail-closed).
- **Body size bound** (`MAX_BODY_BYTES` 1 MB) on the internal MCP server; constant-time `/run`
  token compare; ReDoS-safe bearer parse; loopback default bind.

---

## Findings

### F1 — Local sandbox is not a tenant boundary: cross-run secret theft via `/proc` — **HIGH** (local topology)
`engines/sandbox_agent.ts:370-395`, `daemon.ts:132-162`, `provider.ts:127-129`
On the `local` sandbox the harness (LLM-steered, prompt-injectable) runs as a **child process on
the runner host under the same uid** as every other concurrent run's daemon. Provider keys and the
caller's OTLP bearer live in each daemon's process env (see F2). A prompt-injected agent in run A
with any shell/read primitive can enumerate `/proc/<pid>/environ` of run B's daemon and exfiltrate
run B's provider key + bearer token. Filesystem IPC compounds it: relay dirs live in world-
traversable `os.tmpdir()/agenta/relay/<basename(cwd)>` and the internal MCP server is unauthenticated
loopback (F3) — both reachable across runs on the shared host.
- **Scenario:** two tenants' runs land on the same Compose sidecar with `sandbox:"local"`. Tenant A's
  prompt injection reads `/proc/*/environ`, harvests Tenant B's `OPENAI_API_KEY` and Agenta bearer.
- **Recommendation:** treat `local` as **single-tenant / trusted-only**. For multi-tenant cloud,
  force `sandbox:"daytona"` at the Python service and reject `sandbox:"local"` requests there;
  document `local` as a dev/single-tenant mode in the deployment proposal. Longer term: per-run uid
  or namespace isolation if `local` must ever be multi-tenant. **Horizon: short** (config/policy),
  **long** (isolation).

### F2 — Caller's Agenta bearer token is placed in the agent-readable environment — **HIGH**
`pi-assets.ts:50-51` (`OTEL_EXPORTER_OTLP_HEADERS=Authorization=<bearer>`), spread into the daemon
env (`sandbox_agent.ts:395`) and into the Daytona sandbox env (`daytona.ts:31-46` `daytonaEnvVars`
spreads `piExtEnv`).
`trace.authorization` is the caller's **reusable user bearer token** (per the sidecar-trust doc).
It is injected as an env var the harness process can read. On **Daytona** it crosses into the
sandbox env, so a prompt-injected agent runs `env | grep -i authorization`, gets the token, and
(with default `network:on`) POSTs it anywhere — full user impersonation against the platform until
expiry. On **local** the same token is in the host daemon env (F1).
- **Recommendation:** do NOT hand the trace-export bearer to the harness environment. Options:
  export spans from the **runner** (which already holds the credential) rather than from inside Pi;
  or scope/shorten the export token to trace-ingest-only (the deferred "short-lived, audience-scoped
  token" item). At minimum, when Daytona `network` is unrestricted, treat the in-sandbox bearer as
  exposed. **Horizon: short** (stop injecting on Daytona), **medium** (runner-side export / scoped token).

### F3 — Internal tool MCP server is unauthenticated; cross-run reachable on the shared local host — **HIGH** (local topology)
`tool-mcp-http.ts:49-52, 271-419`, `mcp-bridge.ts:118-131` (`headers: []`)
The internal channel is bound to `127.0.0.1` on an ephemeral port with **no auth** ("carries no
credential; loopback only"). That reasoning holds for network isolation but NOT for a **shared
host**: on `local`, run A's prompt-injected agent shares the host loopback, can scan `127.0.0.1`
ports, find run B's `/mcp`, and call `tools/call` for run B's tools. Execution relays server-side
using **run B's** callback authorization held in run B's runner memory — so A drives B's
gateway/reference tools (and B's connection auth) without ever seeing the credential.
- **Scenario:** cross-tenant tool invocation / data exfiltration through another run's gateway
  connection on a shared local sidecar.
- **Recommendation:** add a per-run bearer to the internal channel even on loopback (mint a random
  token per server, advertise it in the ACP `headers`, require it in `tools/call`); the harness
  already carries MCP headers, so this is cheap. Independently, ties to F1 (local not multi-tenant).
  **Horizon: short.**

### F4 — Harness-side permission enforcement shares the trust domain it gates (Pi builtins) — **MEDIUM** (HIGH if local + any write primitive)
`extensions/agenta.ts:159-201` (the `tool_call` hook), `relay.ts` file IPC, `dispatch.ts`
`relayPermissionCheck`
Pi builtin gating is enforced by the extension **inside the Pi process the model steers**, over a
filesystem relay (`<id>.req.json` → poll `<id>.res.json`). The relay dir is writable by the same
process the agent controls. A prompt-injected agent that obtains ONE filesystem-write primitive can
pre-write a forged `<id>.res.json` with `verdict:"allow"` (or race the runner) to self-authorize
its own subsequent `bash`/`write`/`edit` builtin calls — defeating the gate. The gate is a
boundary against a well-behaved harness, not against a compromised one in the same process. On
**Daytona** the blast radius is contained to the sandbox (forging only harms that sandbox, which is
already isolated). On **local** it is a host-level bypass (leads to F1).
- **Recommendation:** document explicitly that Pi builtin gating is advisory within the sandbox and
  the real boundary is the sandbox (Daytona). Consider making relay files runner-owned/unwritable by
  the harness where the FS allows, or move builtin enforcement out of the model's process. Do not
  rely on builtin gating for host safety on `local`. **Horizon: medium** (structural).

### F5 — `permissions.default:"allow"` disables all Pi builtin gating (unconfined `bash` on the host) — **MEDIUM** (local) / low (daytona)
`run-plan.ts:193-220` `computeBuiltinGatingActive` (returns false when default is `allow`, grants
default, no builtin rules), `extensions/agenta.ts:291-301`
With `default:"allow"` and default grants, **no gating hook is registered** and every builtin
(`bash`, `write`, `edit`) runs with no confirmation. On `local` that is unconfined shell execution
on the runner host, steered by untrusted model output. This is "working as designed" (allow means
allow) but the blast radius on `local` is the whole host.
- **Recommendation:** ensure the Python service never sends `default:"allow"` for a `local` run in a
  multi-tenant context; or refuse `allow` + `local`. Note in docs that `allow` presumes Daytona.
  **Horizon: short** (policy).

### F6 — Relay directory is world-traversable and cross-run readable/forgeable on `local` — **MEDIUM** (local)
`relay.ts:165-177` `localRelayHost`, `run-plan.ts:384-391` (`os.tmpdir()/agenta/relay/<basename(cwd)>`),
`workspace.ts:95` (`mkdirSync` default mode)
Relay req/res files carry only public metadata (no secrets — good), but on the shared host another
run's agent can read run B's tool arguments/results and forge B's responses/permission verdicts
(the write side of F3/F4). `basename(cwd)` is `mkdtemp`-random (unpredictable — mitigates blind
targeting) but enumerable by listing the parent dir.
- **Recommendation:** create the relay root mode `0700`, per-run subdir owned by the run; or a
  per-run random dir not under a shared predictable parent. **Horizon: short.**

### F7 — Gateway `/tools/call` callback endpoint is not origin-locked (unlike direct calls) — **LOW/MEDIUM**
`callback.ts:31-64`, `relay.ts:296-303`
`callAgentaTool` POSTs to `request.toolCallback.endpoint` with `toolCallback.authorization`
verbatim — no origin/host validation (contrast the strong `directCallUrl` guard). The endpoint is
**service-supplied** (config trust), so this is safe under the current trust model, but if the
`/run` edge is ever reachable by an attacker (F8) a forged request could point the callback at an
attacker host — though it would only leak the attacker's own supplied token. Note the asymmetry: the
direct-call path is hardened, the gateway path relies entirely on caller trust.
- **Recommendation:** apply the same origin allowlist / scheme check to the gateway endpoint as a
  defense-in-depth; validate it against a configured Agenta origin. **Horizon: medium.**

### F8 — `/run` transport is unauthenticated by default; carries plaintext secrets + two bearer tokens — **MEDIUM** (accepted risk, documented)
`server.ts:41-90`
`AGENTA_RUNNER_TOKEN` is **off by default**; with it unset any client that can reach the port can
submit arbitrary runs (prompt injection, tool abuse, resource exhaustion) against configured creds,
and the body (provider keys + `trace.authorization` + `toolCallback.authorization`) is plaintext
HTTP. This is the explicitly-accepted "trusted network only" model (Part 1 of the sidecar-trust
doc), with loopback bind as the floor. Real risk only if the sidecar port is exposed or a co-tenant
lands on the trusted network.
- **Recommendation:** for the launch, **turn `AGENTA_RUNNER_TOKEN` ON** in EE/OSS Compose defaults
  (defense-in-depth is free once wired), verify the port is never published, and put the deferred
  TLS/mTLS + scoped-token items on the near-term hardening backlog before any cross-host topology.
  **Horizon: short** (enable token), **medium** (TLS/scoped tokens).

### F9 — Provider keys are, by design, readable by the LLM-steered harness — **MEDIUM** (structural, note)
`daytona.ts:31-46` (secrets → sandbox env), `sandbox_agent.ts:373` (secrets → local daemon env)
The harness must authenticate to the model provider, so resolved vault provider keys are placed in
the agent's environment (sandbox env on Daytona, daemon env on local). A prompt-injected agent can
read and exfiltrate the tenant's Agenta-managed shared provider key (with default open egress). This
is inherent to "the harness calls the model directly," but it means an Agenta-managed key is exposed
to untrusted model-steered code on every run.
- **Recommendation:** prefer a **proxy/gateway** for model calls (key stays server-side, harness
  talks to an Agenta-fronted endpoint) for managed keys; or restrict egress (Daytona `network`
  allowlist to the provider only) so a stolen key can't be exfiltrated. Document that self-managed
  keys are exposed to the agent. **Horizon: medium/long.**

### F10 — `credentialMode` fallback can upload the operator's own Pi/Claude login into a tenant run — **LOW/MEDIUM**
`run-plan.ts:475-481` `shouldUploadOwnLogin`, `daytona.ts:77-94` `uploadPiAuthToSandbox`
For an un-migrated caller (no `credentialMode`) with no api key, the runner uploads the **host's own**
`~/.pi/agent/auth.json` (the operator's OAuth login) into the run/sandbox. In a shared deployment
that mixes the operator's subscription login with tenant runs, a tenant's agent could end up
authenticated as (and could read) the operator's login inside the sandbox.
- **Recommendation:** require an explicit `credentialMode` in production; never fall back to a
  host login for a multi-tenant run. Gate `uploadPiAuthToSandbox` behind a "self-managed dev" flag.
  **Horizon: short** (require credentialMode in prod).

### F11 — Content capture puts prompts/args/results into trace spans — **LOW** (note)
`tracing/otel.ts` `setInputs`/`emitMessages`/`applyAssistant` (gated on `captureContent`, default on)
Tool arguments and results (which may contain data the tool fetched under a tenant credential) are
written to span attributes and exported. This is a product feature (observability), not a bug, but
worth stating: trace storage inherits whatever sensitivity the tool I/O carries. `captureContent`
can be disabled per run. No provider secrets are captured (only names).
- **Recommendation:** document the data-sensitivity of captured content; ensure trace export honors
  tenant scoping. **Horizon: medium** (doc/policy).

### F12 — `client`-tool advertisement vs pause path relies on the model behaving — **LOW**
`tool-mcp-http.ts:126-204`, `relay.ts:213-237`
Client tools are advertised so the model can call them; the call is paused/relayed. The abort/pause
plumbing is careful (the `MCP_PAUSED` sentinel, in-flight socket destroy). One noted self-documented
gap: the engine abort suppresses the response but does **not** cancel an in-flight `runResolvedTool`
dispatch (comment at `tool-mcp-http.ts:68-73`) — a paused call's server-side execution still
completes (its result is discarded). Low severity (execution is idempotent-ish and server-side), but
a slow tool keeps running after pause.
- **Recommendation:** thread the abort signal into `runResolvedTool` dispatch (already a noted
  follow-up). **Horizon: medium.**

---

## Top-10 priority list

| # | Finding | Sev | Horizon |
|---|---------|-----|---------|
| 1 | F1 — local sandbox = shared host/uid; cross-run secret theft via `/proc` | HIGH | short (policy) / long (isolation) |
| 2 | F2 — caller bearer token injected into agent-readable env (esp. Daytona) | HIGH | short / medium |
| 3 | F3 — internal tool MCP server unauthenticated, cross-run reachable on local | HIGH | short |
| 4 | F8 — enable `AGENTA_RUNNER_TOKEN` by default; port never published | MEDIUM | short |
| 5 | F5 — `default:"allow"` disables builtin gating → unconfined host bash on local | MEDIUM | short (policy) |
| 6 | F10 — require explicit `credentialMode`; no host-login fallback in prod | MED/LOW | short |
| 7 | F4 — Pi builtin gating shares the model's process (advisory, not a boundary) | MEDIUM | medium |
| 8 | F6 — relay dir world-traversable/forgeable on local (mode 0700, per-run) | MEDIUM | short |
| 9 | F9 — managed provider keys exposed to LLM-steered harness (proxy / egress-limit) | MEDIUM | medium/long |
| 10 | F7 — origin-lock the gateway `/tools/call` endpoint like direct calls | LOW/MED | medium |

**One-line launch gate:** the runner's isolation story is Daytona; `local` is a single-tenant/dev
boundary, not a tenant boundary. Before multi-tenant cloud launch, (a) force Daytona for tenant
runs, (b) stop handing the caller bearer + provider keys to agent-readable env where avoidable, and
(c) authenticate the internal MCP channel + `/run`. Everything Daytona-isolated + single-tenant-local
is in good shape; the sharp edges are all on the shared-host `local` topology and the two bearer
tokens that ride into the agent's environment.
