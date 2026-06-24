# Status

Source of truth for where this project stands. Keep it current.

## State

**Research + proposal complete. Docs-only, no code changed.** This project answers the
sidecar trust/transport question (Part 1) and records the real sandbox enforcement state
(Part 2) with a verified matrix, plus the exact `protocol.ts` comment correction for a
sibling agent to apply. Every claim in the README was checked against code (file + symbol
cited inline). Nothing here implements anything.

## Scope

- **In scope:** documenting the trust model of the service→runner `/run` boundary; proposing
  transport/auth options; correcting the "declared, not enforced" record for `SandboxPermission`.
- **Out of scope (unchanged by this work):** Composio, the tool gateway, named connections,
  MCP. Token issuance design (Part 1 option 4) is platform-side and only recommended here.
  Editing `protocol.ts` (owned by sibling agent A3 this cycle).

## Key findings (verified in code)

Part 1 (transport):
- `services/oss/src/agent/config.py` `runner_url()` reads `AGENTA_AGENT_RUNNER_URL`: set →
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
- Local sandbox cannot enforce egress: `run-plan.ts` rejects under `strict`, warns under `best_effort`.
- Filesystem declared-only, enforced nowhere (`protocol.ts:158`).
- code/gateway tools + stdio MCP run on the runner host (`relay.ts`), bypass the sandbox net
  boundary even on Daytona; `run-plan.ts` rejects them under `strict` + restricted network.
- Stale comment at `protocol.ts:149-150` now contradicts `provider.ts`.

## Recommendation (Part 1)

Pragmatic default: (1) assert + enforce localhost/in-cluster-only binding and document the
plaintext-secrets trust model; (2) add an optional shared `/run` token (reuse the
`X-Agenta-Internal-Token` pattern). Hardening path when the boundary can be untrusted: (3)
TLS, mTLS via a service mesh where available; (4) short-lived audience-scoped trace/callback
tokens; (5) payload encryption held in reserve. Full rationale in README Part 1.

## Coordination

- Lease claimed on `docs/design/agent-workflows/scratch/agent-coordination.md` as
  `sidecar-trust-research` (docs-only, new dir only).
- **Flag posted for A3** (the `protocol.ts` owner this cycle): apply the corrected
  `SandboxPermission` comment from the README §"protocol.ts comment correction". This project
  does not touch `protocol.ts`.
- Related (not blocking): the `contract-versioning (A1)` lease notes `/health` advertises
  `protocol: 1` that the Python client never reads. Orthogonal to this work.

## Open questions / follow-ups

1. **Whose decision is the default transport posture?** Recommending localhost/in-cluster-only
   + optional token; the actual default (token on/off, TLS required or not) is a deployment
   policy call for the sidecar-deployment owners.
2. **Short-lived scoped tokens** (Part 1 option 4) need token-issuance design on the platform
   side. Highest-value payload hardening; recorded, not designed here.
3. **Where the Part 1 recommendation lands when implemented:** the hardening section of
   `../sidecar-deployment-proposal/proposal.md`.

## Changelog

- 2026-06-24: Project created. Part 1 (transport trust proposal) + Part 2 (enforcement matrix
  + protocol.ts comment correction) written and verified against code. Lease + A3 flag posted
  on the coordination board. No code changed.
