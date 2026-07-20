# Status

Source of truth for where this project stands. Keep it current.

## State

**Runner implementation LANDED (separate runner-only PR).** The research + proposal +
author-review revision (Part 1 trust/transport, Part 2 enforcement matrix) is complete and was
docs-only. The decided near-term code changes are now implemented in a follow-up runner-only PR
(lane `feat/agent-sidecar-trust-enforcement`, `services/agent/src/**` only):

1. **Network isolation + required `/run` token** (Part 1 steps 1–2): the sidecar binds to
   loopback by default (`AGENTA_RUNNER_HOST`, default `127.0.0.1`, never `0.0.0.0`), and
   a REQUIRED shared token (`AGENTA_RUNNER_TOKEN`) gates `/run` with a constant-time compare
   (`server.ts`); the runner refuses to start without it and fails closed. `/health` stays open.
   mTLS / scoped tokens / payload encryption remain deferred.
2. **Error-on-unimplemented `sandbox_permission`** (Part 2): `run-plan.ts` now errors the
   not-implemented way (mirroring `code.ts`) when a restricted `network` policy is set on the
   LOCAL sandbox (any `enforcement`), and whenever `filesystem` is specified (any backend, since
   none enforce it). The Daytona strict-mode runner-host-tool guard stays.
3. **stdio MCP disabled** (Part 2): the stdio MCP implementation is disabled the same way code
   execution was — `MCP_UNSUPPORTED_MESSAGE` in `tools/mcp-bridge.ts`; `buildToolMcpServers`,
   `toAcpMcpServers`, and `mcp-server.ts` throw/refuse; `run-plan.ts` rejects any run carrying a
   stdio MCP server. The wire shapes (`McpServerConfig`, `mcpServers`) are unchanged; only the
   runtime delivery is gated. This removes custom-tool delivery to non-Pi harnesses (Claude) and
   user-declared stdio MCP servers until the security issues are fixed.

`protocol.ts` was NOT edited (A3-owned; the error-on-unimplemented behavior is runtime, not a new
wire field). Gateway/callback tools were NOT touched (Layer-3 tool-permission, not Layer-2
`sandbox_permission`). Tests green: `pnpm test` (168) + `pnpm run typecheck` in `services/agent`.

## Scope

- **In scope:** documenting the trust model of the service→runner `/run` boundary; proposing
  transport/auth options; correcting the "declared, not enforced" record for `SandboxPermission`.
- **Out of scope (unchanged by this work):** Composio, the tool gateway, named connections,
  MCP. Token issuance design (Part 1 option 4) is platform-side and only recommended here.
  Editing `protocol.ts` (owned by sibling agent A3 this cycle).

## Key findings (verified in code)

Part 1 (transport):
- `services/oss/src/agent/config.py` `runner_url()` reads `AGENTA_RUNNER_URL`: set →
  HTTP; unset → local CLI subprocess.
- `sdks/python/agenta/sdk/agents/utils/ts_runner.py` `deliver_http` posts `json=payload` with
  no auth header, no TLS, no shared token. Only `Accept` is set (streaming).
- `services/agent/src/server.ts` `createRequestListener` serves `/run` with **no auth check**.
- The payload carries plaintext `secrets` (provider keys), `toolCallback.authorization`, and
  `trace.authorization` (the caller's full `Authorization` header, copied in
  `services/oss/src/agent/tracing.py`).
- Precedent for a shared-token gate already exists: `X-Agenta-Internal-Token` /
  `AGENTA_VAULT_RESOLVE_INTERNAL_TOKEN` on the platform vault-resolve route.

Part 2 (enforcement):
- Daytona network egress IS enforced: `provider.ts` `daytonaNetworkFields()` →
  `buildSandboxProvider()` (off/empty-allowlist → `networkBlockAll`, non-empty → `networkAllowList`).
- Local sandbox cannot enforce egress: `run-plan.ts` rejects under `strict`, warns under `best_effort`
  today (decision: should ERROR whenever `network` is set on local — see review decisions).
- Filesystem declared-only, enforced nowhere (`protocol.ts:159`; decision: should ERROR when specified).
- **`code` execution is ALREADY REMOVED** from the sidecar: `runCodeTool` (`tools/code.ts`) throws
  `CODE_TOOL_UNSUPPORTED_MESSAGE` ("Code tools are not supported by the sidecar."); interface kept,
  every path funnels through the throwing gate (`dispatch.ts` / `relay.ts`). This is the
  not-implemented pattern the local-network + filesystem + MCP decisions mirror.
- **stdio MCP is STILL implemented** on the runner host: `tools/mcp-bridge.ts`
  (`buildToolMcpServers`) launches `tools/mcp-server.ts` (JSON-RPC stdio). Decision: disable it the
  same way as code execution and remove the sidecar implementation.
- gateway/callback tools run on the runner host (`relay.ts`), governed by **Layer-3
  tool-permission** (`resolvePermission`), NOT `sandbox_permission` (Layer 2) — no change needed.
- **Legacy in-process `pi` engine REMOVED:** `engines/pi.ts` no longer exists (A3 landed it;
  shows as `D` in the working tree). Only `sandbox_agent.ts` / `sandbox_agent/` / `skills.ts` remain.
- The stale `protocol.ts:149-150` comment was ALREADY corrected by A3 (now reads "network policy
  IS enforced on Daytona … `filesystem` is declared-only on every provider"). Two follow-up comment
  edits remain (filesystem→error, local-network→error) once that behavior lands.

## Review decisions (PR #4831)

The author left 6 inline comments; each is folded into the README:

1. README network-isolation/loopback-binding option — **endorsed** ("agree"). Kept as decided step 1.
2. Recommendation — **scope near-term to steps 1 & 2 only** ("only implement 1 and 2 now"). mTLS /
   short-lived scoped tokens / payload encryption moved to an explicit "Later / deferred hardening"
   subsection.
3. Local network — **error when `network` set on local** (not-implemented-style, mirroring
   `code.ts`'s `CODE_TOOL_UNSUPPORTED_MESSAGE` gate / the typed `*Unsupported*Error`s in
   `connections/errors.py`), regardless of `enforcement`. Decision documented; code change separate.
4. Filesystem — **error when `filesystem` specified** (not implemented anywhere), same pattern.
5. MCP / gateway / layering — **disable stdio MCP-server execution in the sidecar** the same way
   code execution was disabled (not-implemented gate + remove `mcp-bridge.ts` / `mcp-server.ts` /
   stdio plumbing), until security is fixed. **gateway tools = no action**: they are Layer-3
   tool-permission, NOT Layer-2 `sandbox_permission`. Code-state verified: code exec removed, MCP
   still present. Decisions documented; code change separate (another agent owns the sidecar).
6. Legacy `pi` engine — verified **removed** (A3); doc now presents it as removed/historical only.

## Recommendation (Part 1)

**Decided near-term scope (implement now): steps 1 & 2 only** (author: "only implement 1 and 2
now"). (1) assert + enforce localhost/in-cluster-only binding and document the plaintext-secrets
trust model; (2) add an optional shared `/run` token (reuse the `X-Agenta-Internal-Token`
pattern). **Deferred (NOT near-term):** (3) TLS, mTLS via a service mesh where available; (4)
short-lived audience-scoped trace/callback tokens; (5) payload encryption held in reserve. Full
rationale in README Part 1.

## Coordination

- Lease claimed on `docs/design/agent-workflows/scratch/agent-coordination.md` as
  `sidecar-trust-research` (docs-only, this project's two files only).
- **A3 already applied the network half** of the `protocol.ts` comment correction (the comment
  now reads "network policy IS enforced on Daytona … `filesystem` is declared-only"). Two
  follow-up comment edits remain (filesystem→error, local-network→error) once that behavior
  lands. This project does not touch `protocol.ts`.
- The decided code changes (local-network + filesystem → error; disable + remove stdio MCP in
  the sidecar) are SEPARATE tasks. Another agent is editing the sidecar (`services/agent/`) this
  cycle, so this revision touches ONLY this project's two doc files and stages only them.
- Related (not blocking): the `contract-versioning (A1)` lease notes `/health` advertises
  `protocol: 1` that the Python client never reads. Orthogonal to this work.

## Open questions / follow-ups

1. **Whose decision is the default transport posture?** Decided near-term = localhost/in-cluster-only
   binding + optional token; the actual default (token on/off) is a deployment policy call for the
   sidecar-deployment owners. (TLS/mTLS now deferred, not near-term.)
2. **Deferred hardening** (TLS/mTLS, short-lived audience-scoped trace/callback tokens, payload
   encryption) — explicitly out of near-term scope per review; recorded, not designed here.
3. **Where the Part 1 recommendation lands when implemented:** the hardening section of
   `../sidecar-deployment-proposal/proposal.md`.
4. **Decided code changes (separate tasks, not this PR):** (a) `run-plan.ts` error when local
   `network` set / when `filesystem` specified (not-implemented gate, mirroring `code.ts`); (b)
   disable + remove the stdio MCP sidecar implementation (`mcp-bridge.ts` / `mcp-server.ts` /
   stdio plumbing) the way code execution was removed; (c) the two follow-up `protocol.ts` comment
   edits. Owned by whoever lands the runner change this cycle.

## Changelog

- 2026-06-24: Project created. Part 1 (transport trust proposal) + Part 2 (enforcement matrix
  + protocol.ts comment correction) written and verified against code. Lease + A3 flag posted
  on the coordination board. No code changed.
- 2026-06-24: Revised per author review on PR #4831 (6 inline comments). Scoped near-term work to
  steps 1 & 2 (deferred mTLS / scoped tokens / payload encryption to a "Later / deferred"
  subsection); documented error-on-specified behavior for local network + filesystem (mirroring
  the `code.ts` not-implemented gate); documented the decision to disable + remove the stdio MCP
  sidecar implementation; clarified gateway = Layer-3 tool-permission, not Layer-2
  `sandbox_permission`; updated the legacy `pi` engine to removed/historical. Verified code state:
  `code` execution already removed (`runCodeTool` throws), stdio MCP still present, `engines/pi.ts`
  gone, `protocol.ts` network comment already corrected by A3. Docs-only, two files; no code changed.
- 2026-06-24: **Runner implementation LANDED** (separate runner-only PR, lane
  `feat/agent-sidecar-trust-enforcement`, `services/agent/src/**` only). (1) loopback binding +
  optional `/run` token in `server.ts`; (2) `run-plan.ts` errors on local `network` / on
  `filesystem` specified (not-implemented gate, any enforcement); (3) stdio MCP disabled
  (`MCP_UNSUPPORTED_MESSAGE`, `mcp-bridge.ts`/`mcp-server.ts`/`toAcpMcpServers`/run-plan gate),
  removing custom-tool delivery to non-Pi harnesses + user stdio MCP. `protocol.ts` untouched
  (A3-owned; runtime behavior, no new wire field). Runner README MCP/tools lines synced. Tests
  green: 168 vitest + typecheck in `services/agent`.
