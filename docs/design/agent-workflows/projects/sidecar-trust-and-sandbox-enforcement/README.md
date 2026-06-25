# Sidecar Trust and Sandbox Enforcement

Research and proposal workspace. It answers two questions, corrects the record on enforcement,
and records the decisions taken on author review. The decided near-term code changes have since
**landed in a separate runner-only PR** (lane `feat/agent-sidecar-trust-enforcement`,
`services/agent/src/**`): loopback binding + optional `/run` token, error-on-unimplemented for
local `network` / any `filesystem`, and the stdio MCP disable. The inline "NOW IMPLEMENTED"
notes mark what shipped; `protocol.ts` was not edited (A3-owned; the gates are runtime behavior,
not new wire fields). See [`status.md`](./status.md) for the landed summary.

- **Part 1 — sidecar trust and transport.** The Python agent service calls the Node runner
  sidecar at `/run` over plain HTTP with no authentication, carrying plaintext provider
  secrets and two bearer tokens. Today that is safe only because the sidecar is assumed to
  sit on a trusted local or in-cluster network. What if it is not? This part proposes how to
  protect the boundary. **Decided near-term scope: implement only step 1 (network
  isolation / loopback-or-in-cluster binding) and step 2 (optional shared `/run` token).**
  mTLS, short-lived scoped tokens, and payload encryption are explicitly deferred.
- **Part 2 — sandbox enforcement reality.** The `SandboxPermission` boundary is *partly*
  enforced, not "declared, not enforced" as several docs once said. This part records the real
  state in an enforcement matrix and the review decisions on the not-implemented axes, now
  implemented: the local sandbox **errors** when a `network` policy is set, `filesystem`
  **errors** when specified, `code` execution is already removed, stdio MCP is now **disabled**
  the same way, gateway tools need no change (Layer-3 tool-permission, not the sandbox boundary),
  and the legacy in-process `pi` engine is removed. The original stale `protocol.ts` comment was
  already corrected by the sibling code agent that owns that file.

Composio, the tool gateway (gateway/callback tools), and named connections are referenced only
as things that already exist; this work changes none of them. **The one exception is MCP:** the
**user-declared stdio** MCP-server implementation in the sidecar is now disabled (parity with the
removed code execution) until its security issues are fixed.

> Follow-up correction (gateway-tool-mcp project, 2026-06-25): this disable was originally wired
> through a single shared constant that ALSO killed the runner's INTERNAL gateway-tool MCP channel
> (the one that delivers Agenta gateway/callback tools to Claude), hard-failing Claude + gateway
> tools. That collateral damage was reverted: the internal channel is restored over a loopback
> HTTP MCP endpoint (no runner-host process), and the user-facing constant was renamed
> `USER_MCP_UNSUPPORTED_MESSAGE`. Only **user stdio** MCP stays disabled.

## Files

- `README.md` — this file (Part 1 proposal + decided scope, Part 2 enforcement matrix +
  review decisions, the protocol.ts comment status).
- `status.md` — state, decisions, open questions, and the coordination flag.

---

## Part 1 — Sidecar trust and transport

### How the service reaches the runner today

The Python agent service (`services/oss/src/agent/`) is the control plane; the Node runner
sidecar (`services/agent/`) is the execution plane. The boundary is the `/run` contract.

- **Transport selection** is in `services/oss/src/agent/config.py` and
  `services/oss/src/agent/app.py`. `runner_url()` reads `AGENTA_AGENT_RUNNER_URL`:
  - set → HTTP transport to the deployed sidecar (`SandboxAgentBackend(url=...)`).
  - unset → local development spawns the runner as a CLI **subprocess** from `runner_dir()`.
- **HTTP delivery** is `deliver_http` / `deliver_http_stream` in
  `sdks/python/agenta/sdk/agents/utils/ts_runner.py`. It does
  `client.post(url, json=payload)` with **no `Authorization` header, no client cert, no
  shared secret**. The only header it ever sets is `Accept: application/x-ndjson` for the
  streaming path.
- **The sidecar accepts anything.** `services/agent/src/server.ts`
  (`createRequestListener`) serves `POST /run` and `GET /health`. It reads the body and the
  `accept` header. **It performs no authentication or authorization check.** Any client that
  can open a TCP connection to the port can submit a run.

### What crosses the boundary in plaintext

Every `/run` payload (built by `request_to_wire` in
`sdks/python/agenta/sdk/agents/utils/wire.py`) can carry:

- **`secrets`** — a flat dict of provider env vars (e.g. `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, and the full AWS/GCP/Azure credential groups). This is the only
  vault-key channel on the wire. These are real, resolved provider credentials.
- **`toolCallback.authorization`** — a bearer token the runner uses to call the gateway tool
  endpoint back on the platform (`callAgentaTool` in `services/agent/src/tools/relay.ts`).
- **`trace.authorization`** — the full `Authorization` header value (the caller's user
  bearer token), copied from the inbound request in `services/oss/src/agent/tracing.py` and
  used to export OTel spans back to the platform.

So a single `/run` body can contain provider API keys plus two reusable bearer tokens. On an
untrusted network, an interceptor or a rogue peer reading the body gets all of it; a peer
that can merely *reach* the port can also submit arbitrary runs (prompt injection, tool
abuse, resource exhaustion) against whatever credentials are configured.

There is no transport-security statement anywhere in the codebase or the interface inventory
— no mTLS, no localhost-only note, no shared-token check. The trust model is implicit:
**"the sidecar is only reachable on a trusted network."** This part makes that assumption
explicit and proposes what to do if it cannot hold.

### Threat model (only relevant if the sidecar is reachable from an untrusted network)

| Threat | What it gets | Today's defense |
| --- | --- | --- |
| Eavesdrop the `/run` body | Provider keys + both bearer tokens | None (plain HTTP) |
| Unauthenticated `/run` submission | Run arbitrary turns/tools on configured creds | None (`/run` is open) |
| Replay a captured `trace.authorization` / `toolCallback.authorization` | Impersonate the user against the platform until the token expires | Token lifetime only |
| Tamper with the in-flight payload | Swap model, tools, secrets, sandbox policy | None (no integrity check) |
| SSRF / port scan from a co-tenant | Reach `/run` and `/health` | None |

The boundary is a **one-way trust** today: the service trusts the sidecar to run faithfully,
and the sidecar trusts every caller to be the service.

### Options

Ordered roughly cheapest-to-strongest. They compose; this is not either/or.

1. **Network isolation / localhost binding (make the implicit assumption real).**
   Keep `/run` unauthenticated but guarantee the network it lives on.
   - Bind the sidecar to `127.0.0.1` (or a private pod/sidecar interface), never `0.0.0.0`,
     when service and runner are co-located (same host, same pod, Compose internal network).
   - In Kubernetes: a sidecar container in the same pod (loopback only) or a `ClusterIP`
     service plus a `NetworkPolicy` that allows ingress *only* from the agent-service pods.
   - In Compose: an internal network with no published port; the runner port is never mapped
     to the host.
   - **Cost:** near zero, config only. **Limit:** no defense in depth — anything that lands
     on the trusted network (a compromised co-tenant, a misconfigured ingress, the
     subprocess transport on a shared dev box) sees everything. This is the *floor*, the
     thing we should assert and document today; it is not sufficient on its own once the
     boundary can be untrusted.

2. **A shared auth token on `/run`.**
   The service sends a secret bearer (e.g. `X-Agenta-Runner-Token` or `Authorization`); the
   sidecar rejects requests that do not match. There is already an in-repo precedent for
   exactly this shape: the provider-model-auth work gated the platform's vault-resolve route
   with `X-Agenta-Internal-Token` / `AGENTA_VAULT_RESOLVE_INTERNAL_TOKEN`. Mirror it on
   `/run`.
   - **Cost:** small — one env var on each side, one header set in `ts_runner.py`, one
     constant-time compare in `server.ts`. **Wins:** stops unauthenticated submission.
     **Limit:** a static shared secret is still plaintext over plain HTTP (eavesdroppable);
     it authenticates the *caller* but does not protect the *payload* in transit. Pair it
     with TLS.

3. **Transport encryption (TLS), and mTLS for mutual auth.**
   - **TLS** (server cert on the sidecar, HTTPS from the service) closes eavesdropping and
     tampering of the payload — the load-bearing fix for secrets and tokens in transit.
   - **mTLS** (client cert on the service too) additionally authenticates the caller without
     a shared secret, and is the cleanest fit for a service mesh (Istio/Linkerd can provide
     it transparently with zero app code).
   - **Cost:** TLS needs cert provisioning/rotation; mTLS needs a CA or a mesh. Higher
     operational weight, especially for self-hosters. **Wins:** confidentiality + integrity +
     (mTLS) mutual identity. This is the strong end of the hardening path.

4. **Short-lived, scoped tokens (reduce blast radius of what crosses).**
   The two bearer tokens are the most reusable loot. Independently of transport:
   - Make `trace.authorization` and `toolCallback.authorization` **short-lived** and
     **audience/scope-restricted** (trace-export-only; gateway-call-only) so a leaked token
     buys a small, bounded capability for a short window instead of full user impersonation.
   - This is the most valuable *payload-level* hardening and is orthogonal to TLS. It also
     improves the picture even on a trusted network. (It touches token issuance, which is
     platform-side and out of scope for this doc to design; recorded as the highest-value
     follow-up.)

5. **Payload encryption (envelope-encrypt `secrets`).**
   Encrypt the `secrets` dict (and optionally the tokens) at the service and decrypt in the
   sidecar with a shared key, so the keys are not plaintext even if TLS is terminated early
   or logged. **Cost:** key management + a wire-shape change (the golden contract). **Verdict:**
   generally redundant once TLS is in place and usually not worth the wire churn; keep it in
   reserve for a "secrets must never be plaintext at the HTTP layer even under TLS
   termination" requirement, not as a default.

### Recommendation

**Decided near-term scope (implement now): steps 1 and 2 only.** The author confirmed on
review: "I agree let's only implement 1 and 2 now." Both are config-only, ship today, and
make the implicit trust assumption real and auditable. Everything heavier (mTLS, short-lived
scoped tokens, payload encryption) is explicitly **deferred** to the [Later / deferred
hardening](#later--deferred-hardening) subsection below — it is NOT part of the near-term work.

1. **State the trust model explicitly and enforce localhost/in-cluster-only by default.**
   Bind the sidecar to a loopback or private interface; never publish its port. Document, in
   the interface inventory and the deployment proposal, that `/run` carries plaintext
   secrets and bearer tokens and therefore **must** sit on a trusted, non-public network.
   This is the immediate, zero-cost correctness fix for the "no transport-security
   statement anywhere" gap. (The author endorsed the network-isolation/loopback-binding
   option directly: "agree.") **IMPLEMENTED:** `server.ts` binds to `AGENTA_AGENT_RUNNER_HOST`
   (default `127.0.0.1`, never `0.0.0.0`); set it to the private pod/internal interface in
   Kubernetes/Compose and never map the port to the host.
2. **Add a shared auth token on `/run`**, reusing the existing `X-Agenta-Internal-Token`
   precedent (a new `AGENTA_AGENT_RUNNER_TOKEN`), default-off so co-located/loopback
   deployments are unaffected, on when set. Cheap defense-in-depth against accidental
   exposure. **IMPLEMENTED:** when `AGENTA_AGENT_RUNNER_TOKEN` is set, `server.ts` requires it
   on `/run` (`Authorization: Bearer <token>` or `X-Agenta-Runner-Token: <token>`,
   constant-time compare) and returns 401 otherwise; `/health` stays open for liveness probes.

Rationale: steps 1–2 are config-only, make the implicit assumption real and auditable, and
need no wire-contract change or cert/key machinery. They are the whole near-term ask.

#### Later / deferred hardening

**Not part of the near-term work.** These are the real security upgrades for when the boundary
can be untrusted (cross-host, multi-tenant, mesh). They each carry design/ops weight, so they
belong on a deliberate hardening path on a separate timeline, not in this cycle.

3. **TLS on the `/run` transport** (and the step-2 token then rides an encrypted channel) —
   the load-bearing fix for secrets/tokens in transit. Prefer **mTLS via a service mesh**
   where one is available, since it gives mutual auth with no app code and handles rotation.
   *Deferred.*
4. **Short-lived, audience-scoped `trace.authorization` and `toolCallback.authorization`** —
   the highest-value payload-level reduction in blast radius; pursue independently of
   transport. Touches platform-side token issuance. *Deferred.*
5. **Payload encryption of `secrets`** — held in reserve; only if a requirement forbids
   plaintext secrets even under TLS. Rarely worth its wire-contract cost. *Deferred.*

Note on the CLI/subprocess transport: when `AGENTA_AGENT_RUNNER_URL` is unset, the runner is
a child process and the payload never touches a network socket (stdin pipe). That path needs
none of this; the trust question is purely about the HTTP transport.

---

## Part 2 — Sandbox enforcement reality (correcting the record)

The headline correction: **`SandboxPermission` network egress IS enforced — on Daytona.** The
widely repeated "declared, not yet enforced" line is now wrong for the network axis. The
filesystem axis is still declared-only, and several execution paths bypass the boundary even
where it is enforced. The matrix below is the verified state, followed by the decisions taken
on review.

Review decisions folded into this part (each captured inline below): on the **local** sandbox a
set `network` policy now **errors** (not enforceable there), `filesystem` **errors when
specified** (not implemented anywhere), `code` execution is **already removed**, stdio MCP is
**slated to be disabled the same way** (and its sidecar implementation removed), gateway tools
need **no change** (they are Layer-3 tool-permission, not Layer-2 `sandbox_permission`), and the
legacy in-process `pi` engine is **removed**.

### What the code actually does

- **Daytona network egress — ENFORCED.**
  `services/agent/src/engines/sandbox_agent/provider.ts`, `daytonaNetworkFields()`, maps the
  Layer-2 network policy onto Daytona sandbox-create fields:
  - `mode: "off"` → `{ networkBlockAll: true }`
  - `mode: "allowlist"` with a **non-empty** list → `{ networkAllowList: "<cidr,cidr>" }`
    (a comma-separated CIDR string)
  - `mode: "allowlist"` with an **empty** list → `{ networkBlockAll: true }` (empty allowlist
    means "allow nothing", deliberately block-all rather than default-open)
  - `mode: "on"` or no policy → `{}` (sandbox stays default-open)
  These fields are spread into the Daytona `create` call in `buildSandboxProvider()`, so the
  egress boundary is applied by the Daytona platform at sandbox creation. This is real
  enforcement at the sandbox boundary.

- **Local sandbox network egress — NOT enforceable.**
  The local sidecar runs on the runner host, which has no per-run egress control. So a
  restricted-network policy cannot be honored locally.
  `services/agent/src/engines/sandbox_agent/run-plan.ts` (`buildRunPlan`) **rejects** a
  restricted-network run on the local sandbox when `enforcement: "strict"` (fail loud), and
  proceeds with a warning under `best_effort`.

  **Decided behavior (review): error when `network` is set on local, the way we error on a
  not-implemented capability — regardless of `enforcement`.** The author's call: "it might
  make sense to return an error the way we do when a capability is not implemented if that
  variable is set for local." So a restricted `sandbox_permission.network` (`mode` other than
  `on`) on the local sandbox should **fail with a not-implemented-style error**, not be
  silently accepted under `best_effort`. The local sandbox genuinely cannot enforce egress, so
  declaring the boundary and then ignoring it is the trap we close.

  *Pattern to mirror.* The codebase already errors this way for an unsupported feature: the
  code-tool gate in `services/agent/src/tools/code.ts` keeps the interface but throws a single
  named-constant message (`CODE_TOOL_UNSUPPORTED_MESSAGE = "Code tools are not supported by the
  sidecar."`) from `runCodeTool`, and the Python connection layer raises typed
  `*Unsupported*Error`s (e.g. `UnsupportedDeploymentError` in
  `sdks/python/agenta/sdk/agents/connections/errors.py`: `"deployment '<x>' is not supported …"`)
  for capabilities that are declared but not implemented. The local-network rejection should
  surface the same way: a clear "network policy is not enforceable on the local sandbox"
  error at plan time in `buildRunPlan`, so the run fails loudly rather than running unconfined.
  **NOW IMPLEMENTED:** `buildRunPlan` returns `LOCAL_NETWORK_UNSUPPORTED_MESSAGE` ("Network
  sandbox policy is not enforceable on the local sandbox …") whenever a restricted `network`
  policy is set on the local sandbox, regardless of `enforcement` (runner-only PR, lane
  `feat/agent-sidecar-trust-enforcement`).

- **Filesystem boundary — DECLARED, enforced NOWHERE.**
  `SandboxPermission.filesystem` (`on` / `readonly` / `off`) travels on the wire and is
  versioned, but no backend applies a filesystem jail. See `services/agent/src/protocol.ts`
  (the `filesystem` field is explicitly annotated "Declared, NOT enforced today" around line
  159). The capability-config project confirms it: "It declares filesystem confinement but
  enforces none today (no fs jail on any backend)." (The Claude harness can be told to deny
  `Write`/`Edit` via its settings, but that is a harness behavior rule, not a sandbox
  filesystem boundary.)

  **Decided behavior (review): error when `filesystem` is specified, since it is not
  implemented.** The author's call: "again, should be an error if specified currently since it
  is not implemented." So a present `sandbox_permission.filesystem` value (on any backend,
  since none enforce it) should **fail with a not-implemented-style error** at plan time
  rather than be silently accepted — the same not-implemented-capability pattern as the local
  network case above (`code.ts`'s `CODE_TOOL_UNSUPPORTED_MESSAGE` gate / the typed
  `*Unsupported*Error`s in `connections/errors.py`). Declaring a filesystem jail the runner
  does not apply is the same silent-acceptance trap. **NOW IMPLEMENTED:** `buildRunPlan` returns
  `FILESYSTEM_UNSUPPORTED_MESSAGE` ("Filesystem sandbox policy is not implemented …") whenever
  `sandbox_permission.filesystem` is present, on any backend, regardless of `enforcement`
  (runner-only PR, lane `feat/agent-sidecar-trust-enforcement`).

- **Runner-host execution bypass — gateway tools and stdio MCP run on the runner host;
  code execution is already removed.**
  Resolved `code` tools, gateway/callback tools, and stdio MCP servers all funnel through the
  runner host (the relay, `services/agent/src/tools/relay.ts`), not the sandbox. A
  network-blocked Daytona sandbox does not confine the ones that still execute — they have the
  runner host's network. Current verified state:
  - **`code` execution — ALREADY REMOVED from the sidecar.** `runCodeTool`
    (`services/agent/src/tools/code.ts`) no longer executes author snippets; it throws a
    single named constant, `CODE_TOOL_UNSUPPORTED_MESSAGE = "Code tools are not supported by
    the sidecar."`. The `code` interface still exists and code tools are still advertised to
    harnesses, but every delivery path (direct Pi, sandbox Pi, the ACP/MCP bridge) funnels a
    `kind: "code"` call through that throwing gate, so it fails consistently without changing
    the public wire shape (`tools/dispatch.ts`, `tools/relay.ts`).
  - **stdio MCP servers — STILL EXECUTE on the runner host (the remaining bypass).** The stdio
    MCP bridge is fully wired: `services/agent/src/tools/mcp-bridge.ts` (`buildToolMcpServers`)
    launches `services/agent/src/tools/mcp-server.ts` (a JSON-RPC stdio server) as a child
    process of the daemon, and `run-plan.ts` `hasStdioMcpServer` flags such servers. These run
    on the runner host, outside the sandbox boundary.

  `buildRunPlan` currently closes the remaining hole at plan time: under `strict` + restricted
  network, a run carrying any runner-host-executed tool (`executableToolSpecs`) or any stdio
  MCP server (`hasStdioMcpServer`) is **rejected**; `best_effort` is the opt-out that accepts
  the boundary is not a hard guarantee.

  **Decided plan (review) — NOW IMPLEMENTED: stdio MCP-server execution is disabled the same
  way code execution was — marked not-implemented, sidecar implementation removed, until the
  security issues are fixed.** The author's call: "we have removed code execution from the code.
  we should also disable the same way mcp servers implementation until we fix security issues. We
  simply put them as non implemented and remove the implementation in the sandbox sidecar like
  we did for tool calls." The runner-host stdio MCP path is now at parity with the code-tool
  gate: the wire/interface shapes (`McpServerConfig`, the `mcpServers` request field) are kept,
  but delivery routes through a single not-implemented gate — `MCP_UNSUPPORTED_MESSAGE` ("MCP
  servers are not supported by the sidecar.") in `services/agent/src/tools/mcp-bridge.ts`,
  thrown by `buildToolMcpServers` and by `toAcpMcpServers` (`engines/sandbox_agent/mcp.ts`);
  `mcp-server.ts` is reduced to a refusing stub; and `run-plan.ts` rejects any run carrying a
  stdio MCP server up front (`hasStdioMcpServer` → `MCP_UNSUPPORTED_MESSAGE`). This eliminates
  the last runner-host execution bypass rather than relying on the plan-time `strict` gate.
  **What it removes:** non-Pi harnesses (e.g. Claude) take tools only over MCP, so they can no
  longer receive custom tools, and user-declared stdio MCP servers are refused; Pi tools
  (delivered natively through the extension, not MCP) are unaffected. Implemented in the
  runner-only PR on lane `feat/agent-sidecar-trust-enforcement`; `protocol.ts` was not edited
  (A3-owned; the gate is runtime behavior, not a new wire field).

  **Layering clarification (review): gateway tools are fine and need NO action — they are NOT
  part of `sandbox_permission`.** The author's call: "for gateway it's alright. no need to do
  anything. that is not part of sandbox permission, that is part of the permission (the other
  parameter that is about the sidecar and obviously there we should deal with these
  correctly)." Gateway/callback tools belong to a **different layer** than the sandbox network
  boundary:
  - **Layer 2 — `sandbox_permission`** is the network/filesystem boundary the agent runs
    inside. That is what this Part 2 enforcement matrix is about (Daytona `networkBlockAll` /
    `networkAllowList`, the local fail-loud, the filesystem-declared-only state).
  - **Layer 3 — tool-permission** is the separate sidecar parameter that governs whether a
    tool may run at all (`allow` / `ask` / `deny`, including HITL). That is where gateway tools
    are governed (`relay.ts` `resolvePermission`), and it is handled correctly there.

  So gateway tools are not a `sandbox_permission` concern and require no change here. They are
  not lumped into the sandbox boundary; do not treat the gateway as a sandbox-enforcement gap.

- **Legacy in-process engine — REMOVED (historical).**
  The legacy in-process `backend: "pi"` engine (`engines/pi.ts`) has been removed by a sibling
  agent (A3); `services/agent/src/engines/` no longer contains `pi.ts` (verified: only
  `sandbox_agent.ts`, `sandbox_agent/`, and `skills.ts` remain, and `pi.ts` shows as deleted in
  the working tree). It is no longer a runtime path, so it is not part of the enforcement
  picture; it is mentioned here only as removed history. The single enforced path is
  `backend: "sandbox-agent"` (the default and now the only sandbox path).
  *(A few stale doc-comments in `engines/skills.ts`, `tools/mcp-server.ts`, and
  `tracing/otel.ts` still reference the in-process Pi engine; those are leftover comments, not
  live code, and are out of scope for this docs revision.)*

### Enforcement matrix

Axis × backend. "Enforced" means a hard boundary is applied; "fail loud" means the run is
rejected at plan time. The **Decided** column records the review decisions captured above (the
code change is a separate task; this is the agreed target behavior).

| Capability | Daytona sandbox | Local sandbox | Decided behavior (review) |
| --- | --- | --- | --- |
| **Network: `off`** | **Enforced** — `networkBlockAll: true` at sandbox create (`provider.ts`) | **Not enforceable** — host has no egress control | Local: **error if `network` set** (not-implemented-style, any `enforcement`), mirroring `code.ts`'s unsupported gate — not a `best_effort` warn |
| **Network: `allowlist` (non-empty)** | **Enforced** — `networkAllowList: "<cidr,...>"` (`provider.ts`) | **Not enforceable** — same as above | Same: local → error |
| **Network: `allowlist` (empty)** | **Enforced as block-all** — empty list = allow nothing (`provider.ts`) | **Not enforceable** — same as above | Same: local → error |
| **Network: `on` / unset** | No restriction (default-open) | No restriction (default-open) | Baseline, no change |
| **Filesystem (`on`/`readonly`/`off`)** | **Declared only — enforced NOWHERE** (`protocol.ts:159`) | **Declared only — enforced NOWHERE** | **Error if `filesystem` specified** (not implemented on any backend), not silent-accept |
| **`enforcement: strict`** | Rejects what Daytona cannot guarantee (runner-host tools, stdio MCP) | Rejects all restricted-network runs | Stays; the local-network + filesystem errors fire regardless of `enforcement` |
| **`enforcement: best_effort`** | Allows with no hard guarantee | Allows with no hard guarantee | No longer the escape hatch for local network / filesystem (those error unconditionally) |
| **`code` tools** | **Execution REMOVED** — `runCodeTool` throws `CODE_TOOL_UNSUPPORTED_MESSAGE` (`code.ts`); advertised but not run | Same — removed | Already done; this is the not-implemented pattern the others mirror |
| **stdio MCP servers** | Run on **runner host**, bypass the sandbox net boundary; `strict`+restricted → fail loud | Run on runner host (always unconfined) | **Disabled the same way as code:** not-implemented gate (`MCP_UNSUPPORTED_MESSAGE`) + the sidecar stdio plumbing (`mcp-bridge.ts` / `mcp-server.ts`) stays inert until security is fixed |
| **HTTP (remote) MCP servers** | **Delivered** — no runner-host process; the harness connects to the URL, the named secret rides in a request header (subject to the Daytona network policy like any egress) | **Delivered** — same, no runner-host process | **Enabled** (http-mcp-transport project): `toAcpMcpServers` builds the ACP `type: "http"` entry and routes the resolved secret from `env` into a header. This is the safe transport stdio is not. |
| **gateway / callback tools** | Run on runner host; governed by **Layer 3 tool-permission** (`relay.ts` `resolvePermission`), **not** `sandbox_permission` | Same | **No action** — NOT a `sandbox_permission` (Layer 2) concern; handled in the Layer-3 tool-permission/HITL parameter |
| **Legacy `backend: "pi"` (in-process)** | **REMOVED** — `engines/pi.ts` no longer exists | **REMOVED** | Gone (A3); not a path, historical only |

One-line summary: **network egress is a real boundary on Daytona and only on Daytona, and on
the local sandbox a set `network` policy now errors (not-implemented) rather than running
unconfined; `filesystem` is enforced nowhere, so specifying it now errors too; `code`
execution is already removed (throwing gate) and stdio MCP is now disabled the same way and its
sidecar implementation removed; gateway tools are out of scope here because they live in
Layer-3 tool-permission, not Layer-2 `sandbox_permission`; and the legacy in-process `pi`
engine is gone.**

### protocol.ts comment correction (network part APPLIED by A3; filesystem follow-up pending)

The original stale comment on `SandboxPermission` (`services/agent/src/protocol.ts`, the
"Plumbing only today … does NOT yet apply it on the sandbox provider" line) **has been
corrected by A3**. The current comment (around `protocol.ts:144-152`) now reads, correctly:

```ts
 * (fail when the boundary cannot be applied) or `best_effort`. The network policy IS enforced
 * on Daytona (`provider.ts` `daytonaNetworkFields`); on the local sidecar it cannot be a hard
 * guarantee, so a restricted-network run there is rejected under `strict` (`run-plan.ts`).
 * `filesystem` is declared-only on every provider.
```

So the network half of this section is **done**. The local-network and filesystem error
behavior has now **landed** in `run-plan.ts` (runner-only PR, lane
`feat/agent-sidecar-trust-enforcement`), so two comment follow-ups remain for the protocol.ts
owner (A3) to keep the comment in step with the live code — the implementation PR did NOT edit
`protocol.ts` (it is A3's shared surface, and the error behavior is runtime, not a wire field):

- The `filesystem` field annotation (`/** Declared, NOT enforced today. */`) should become a
  not-implemented error contract: specifying `filesystem` is now rejected as not implemented
  (`run-plan.ts` `FILESYSTEM_UNSUPPORTED_MESSAGE`, any backend, any `enforcement`).
- The local-network wording ("rejected under `strict`") should become "rejected whenever a
  `network` policy is set (not enforceable on the local sandbox), independent of `enforcement`"
  (`run-plan.ts` `LOCAL_NETWORK_UNSUPPORTED_MESSAGE`).

**Coordination flag:** `services/agent/src/protocol.ts` is a shared-risk surface owned this
cycle by a sibling code agent (**A3**). This research/proposal project does **not** edit
`protocol.ts`; A3 already applied the network correction, and the two follow-ups above are
recorded here for whoever lands the filesystem/local-network error behavior.

---

## Relationship to existing work

- The **capability-config** project (`../capability-config/`) built the Layer-2 enforcement
  this matrix records (Daytona `networkBlockAll`/`networkAllowList`, the local fail-loud, the
  runner-host guard). This project does not change that; it documents the verified result, fixes
  the stale comments around it, and records the review decisions to tighten the not-implemented
  axes (local network and filesystem now error; stdio MCP to be disabled).
- The **sidecar-deployment-proposal** project (`../sidecar-deployment-proposal/`) defines how
  the runner is deployed (`AGENTA_AGENT_RUNNER_URL`, Compose/Helm/Railway). The decided
  near-term work (localhost/in-cluster-only binding + the optional `/run` token) belongs in that
  proposal's hardening section when implemented; the deferred items (TLS/mTLS, scoped tokens,
  payload encryption) belong on its longer-term hardening path.
- Composio, the tool gateway (gateway/callback tools), and named connections are unchanged by
  this work; they are referenced only as existing surfaces, and gateway tools are governed by
  Layer-3 tool-permission, not the sandbox boundary. **MCP is the exception:** this revision
  records a decision to disable the stdio MCP-server implementation in the sidecar (parity with
  the already-removed code execution) until the security issues are fixed — the code change is a
  separate task, not made in this PR.
