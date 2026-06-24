# Sidecar Trust and Sandbox Enforcement

Research and proposal workspace. This is not an implementation. It answers two questions and
corrects one stale comment.

- **Part 1 — sidecar trust and transport.** The Python agent service calls the Node runner
  sidecar at `/run` over plain HTTP with no authentication, carrying plaintext provider
  secrets and two bearer tokens. Today that is safe only because the sidecar is assumed to
  sit on a trusted local or in-cluster network. What if it is not? This part proposes how to
  protect the boundary, and recommends a pragmatic default plus a hardening path.
- **Part 2 — sandbox enforcement reality.** The `SandboxPermission` boundary is *partly*
  enforced, not "declared, not enforced" as several docs and one code comment still say.
  This part records the real state in an enforcement matrix and gives the exact wording to
  fix the stale `protocol.ts` comment (a sibling agent owns that file; see the flag below).

Composio, the tool gateway, named connections, and MCP are referenced only as things that
already exist. **This work changes none of them.**

## Files

- `README.md` — this file (Part 1 proposal, Part 2 enforcement matrix, the comment fix).
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

**Pragmatic default (assert what we already rely on, plus authenticate the caller):**

1. **State the trust model explicitly and enforce localhost/in-cluster-only by default.**
   Bind the sidecar to a loopback or private interface; never publish its port. Document, in
   the interface inventory and the deployment proposal, that `/run` carries plaintext
   secrets and bearer tokens and therefore **must** sit on a trusted, non-public network.
   This is the immediate, zero-cost correctness fix for the "no transport-security
   statement anywhere" gap.
2. **Add a shared auth token on `/run`**, reusing the existing `X-Agenta-Internal-Token`
   precedent (a new `AGENTA_AGENT_RUNNER_TOKEN`), default-off so co-located/loopback
   deployments are unaffected, on when set. Cheap defense-in-depth against accidental
   exposure.

**Hardening path, when the boundary can be untrusted (cross-host, multi-tenant, mesh):**

3. **TLS on the `/run` transport** (and the existing token now rides an encrypted channel) —
   the load-bearing fix for secrets/tokens in transit. Prefer **mTLS via a service mesh**
   where one is available, since it gives mutual auth with no app code and handles rotation.
4. **Short-lived, audience-scoped `trace.authorization` and `toolCallback.authorization`** —
   the highest-value payload-level reduction in blast radius; pursue independently of
   transport.
5. **Payload encryption of `secrets`** — held in reserve; only if a requirement forbids
   plaintext secrets even under TLS.

Rationale: steps 1–2 are config-only, ship today, and make the implicit assumption real and
auditable. Steps 3–4 are the real security upgrades and are exactly the parts that need
design/ops weight, so they belong on a deliberate hardening path rather than the default.
Step 5 is rarely worth its wire-contract cost.

Note on the CLI/subprocess transport: when `AGENTA_AGENT_RUNNER_URL` is unset, the runner is
a child process and the payload never touches a network socket (stdin pipe). That path needs
none of this; the trust question is purely about the HTTP transport.

---

## Part 2 — Sandbox enforcement reality (correcting the record)

The headline correction: **`SandboxPermission` network egress IS enforced — on Daytona.** The
widely repeated "declared, not yet enforced" line is now wrong for the network axis. The
filesystem axis is still declared-only, and several execution paths bypass the boundary even
where it is enforced. The matrix below is the verified state.

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

- **Filesystem boundary — DECLARED, enforced NOWHERE.**
  `SandboxPermission.filesystem` (`on` / `readonly` / `off`) travels on the wire and is
  versioned, but no backend applies a filesystem jail. See `services/agent/src/protocol.ts`
  (the `filesystem` field is explicitly annotated "Declared, NOT enforced today" around line
  158). The capability-config project confirms it: "It declares filesystem confinement but
  enforces none today (no fs jail on any backend)." (The Claude harness can be told to deny
  `Write`/`Edit` via its settings, but that is a harness behavior rule, not a sandbox
  filesystem boundary.)

- **Runner-host execution bypass — code/gateway tools and stdio MCP escape the boundary even
  on Daytona.**
  Resolved `code` tools, gateway/callback tools, and stdio MCP servers do **not** run inside
  the sandbox. They run in the **runner host process** via the relay
  (`services/agent/src/tools/relay.ts`: `runCodeTool`, `callAgentaTool`, and the stdio MCP
  bridge). So a network-blocked Daytona sandbox does not confine them — they have the runner
  host's network. `buildRunPlan` closes this hole at plan time: under `strict` + restricted
  network, a run carrying any runner-host-executed tool (`executableToolSpecs` — code and
  gateway) or any stdio MCP server (`hasStdioMcpServer`) is **rejected**; `best_effort` is
  the opt-out that accepts the boundary is not a hard guarantee.

- **Legacy in-process engine bypass.**
  `backend: "pi"` (the legacy in-process `engines/pi.ts`) is not the sandbox-agent path and
  historically enforced none of this; the capability-config work added a fail-loud guard so
  a restrictive policy on that engine is rejected rather than silently ignored. The
  enforced path is `backend: "sandbox-agent"` (the default).

### Enforcement matrix

Axis × backend, as of this writing. "Enforced" means a hard boundary is applied; "fail loud"
means the run is rejected at plan time under `enforcement: "strict"`.

| Capability | Daytona sandbox | Local sandbox | Notes |
| --- | --- | --- | --- |
| **Network: `off`** | **Enforced** — `networkBlockAll: true` at sandbox create (`provider.ts`) | **Not enforceable** — host has no egress control; `strict` → fail loud, `best_effort` → warn (`run-plan.ts`) | Real boundary on Daytona only |
| **Network: `allowlist` (non-empty)** | **Enforced** — `networkAllowList: "<cidr,...>"` (`provider.ts`) | **Not enforceable** — same as above | CIDR string, not array |
| **Network: `allowlist` (empty)** | **Enforced as block-all** — empty list = allow nothing (`provider.ts`) | **Not enforceable** — same as above | Deliberately not default-open |
| **Network: `on` / unset** | No restriction (default-open) | No restriction (default-open) | Baseline |
| **Filesystem (`on`/`readonly`/`off`)** | **Declared only — enforced NOWHERE** (`protocol.ts:158`) | **Declared only — enforced NOWHERE** | No fs jail on any backend |
| **`enforcement: strict`** | Rejects what Daytona cannot guarantee (runner-host tools, stdio MCP) | Rejects all restricted-network runs | Plan-time, before cwd alloc (`run-plan.ts`) |
| **`enforcement: best_effort`** | Allows with no hard guarantee | Allows with no hard guarantee | Per-axis opt-out |
| **code / gateway tools** | Run on **runner host**, bypass the sandbox net boundary; `strict`+restricted → fail loud | Run on runner host (always unconfined) | `relay.ts` execution |
| **stdio MCP servers** | Run on **runner host**, bypass the sandbox net boundary; `strict`+restricted → fail loud | Run on runner host (always unconfined) | `relay.ts` / `mcp.ts` bridge |
| **Legacy `backend: "pi"` (in-process)** | n/a (not a sandbox path) | Restrictive policy → fail-loud guard (capability-config) | Not the enforced path; default is `sandbox-agent` |

One-line summary: **network egress is a real boundary on Daytona and only on Daytona;
filesystem is declared-only everywhere; and code/gateway tools plus stdio MCP run on the
runner host, so they sit outside the sandbox boundary entirely and are gated by a fail-loud
plan check rather than confined.**

### protocol.ts comment correction (to be applied by the protocol.ts owner — not by this work)

The doc comment on `SandboxPermission` at `services/agent/src/protocol.ts:149-150` is now
stale. It currently reads:

```ts
 * (fail when the boundary cannot be applied) or `best_effort`. Plumbing only today: the runner
 * carries it onto the run plan but does NOT yet apply it on the sandbox provider.
```

That last sentence contradicts `provider.ts`, which **does** apply the network policy on the
Daytona sandbox provider via `daytonaNetworkFields()` / `buildSandboxProvider()`. Replace
those two lines with wording that matches the real state:

```ts
 * (fail when the boundary cannot be applied) or `best_effort`. The network policy IS enforced
 * on Daytona (`buildSandboxProvider` → `daytonaNetworkFields`: `off`/empty-allowlist →
 * `networkBlockAll`, non-empty allowlist → `networkAllowList`); the local sandbox cannot
 * enforce egress, so `buildRunPlan` rejects restricted-network runs under `strict`. `filesystem`
 * is still declared but enforced nowhere. Code/gateway tools and stdio MCP run on the runner
 * host, outside the sandbox boundary, so a restricted-network `strict` run carrying them is
 * rejected at plan time.
```

**Coordination flag (IMPORTANT):** `services/agent/src/protocol.ts` is a shared-risk surface
owned this cycle by a sibling code agent (referred to as **A3** on the coordination board).
This research project does **not** edit `protocol.ts`. The correction above is recorded here
for A3 to apply in their own change. The flag is also posted on
`docs/design/agent-workflows/scratch/agent-coordination.md` (the `sidecar-trust-research`
lease row and the communication log).

---

## Relationship to existing work

- The **capability-config** project (`../capability-config/`) built the Layer-2 enforcement
  this matrix records (Daytona `networkBlockAll`/`networkAllowList`, the local fail-loud, the
  runner-host guard). This project does not change that; it documents the verified result and
  fixes the stale comments around it.
- The **sidecar-deployment-proposal** project (`../sidecar-deployment-proposal/`) defines how
  the runner is deployed (`AGENTA_AGENT_RUNNER_URL`, Compose/Helm/Railway). Part 1's
  localhost/in-cluster-only recommendation and the optional `/run` token belong in that
  proposal's hardening section when implemented.
- Composio, the tool gateway, named connections, and MCP are unchanged by this work; they are
  referenced only as existing surfaces that the boundary carries.
