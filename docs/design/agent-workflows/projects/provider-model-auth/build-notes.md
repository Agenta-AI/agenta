# Build notes (decisions taken during the autonomous run)

Judgment calls made while driving the feature to a PR, recorded for review.

## 2026-06-24 — Rework after PR review (#4815) to match the corrected design

Mahmoud's review + a Codex review drove a five-part rework. Implemented per the corrected
`design.md` / `plan.md`. Per-cut decisions:

1. **Two connection modes (`agenta` / `self_managed`).** `Connection.mode` literal collapsed
   3->2 in `connections/models.py` (default `"agenta"`); validator now **rejects a `slug` on a
   `self_managed`** connection (was: required slug for `agenta`). Every `"default"` branch purged
   (resolver, app.py, API `connections.py`, FE `connectionUtils.ts`). "The project default" is
   just `agenta` with no slug.

2. **API capability table deleted; vault resolve is harness-agnostic.** Deleted
   `api/oss/src/core/secrets/capabilities.py`; removed its import + the harness provider/mode
   reject from `core/secrets/connections.py`; dropped `harness`/`backend` from the vault resolve
   contract (`resolve_connection`, `VaultService.resolve_connection`, `ResolveConnectionRequest`,
   the SDK `VaultConnectionResolver` request body). The vault now does deterministic selection +
   provider-match only.

3. **Capability lives in the SDK + `/inspect` `meta`.** `sdks/python/agenta/sdk/agents/capabilities.py`
   rewritten with the REAL Pi vault-provider list (the eight) + Claude=anthropic (NOT `["*"]`),
   `deployments=["direct"]` (cloud declared but not consumable in v1), two modes, `model_selection`.
   Exposed via `ag.workflow(meta={"harness_capabilities": harness_capabilities_document()})` in
   `services/oss/src/agent/app.py` — the inspect-response `meta`, NOT a 4th `AGENT_SCHEMAS` key
   (`JsonSchemas` only allows inputs/parameters/outputs; confirmed). The agent layer imports the
   SDK table directly and does the fail-loud check **split around the resolve**: provider+mode
   PRE-resolve (`_check_harness_pre_resolve`), deployment POST-resolve (`_check_harness_post_resolve`,
   raising the new `UnsupportedDeploymentError`).

4. **Internal resolve gate (security must-fix) — mechanism chosen: an internal-service token.**
   `POST /vault/connections/resolve` now rejects any caller without a matching
   `X-Agenta-Internal-Token` header when `AGENTA_VAULT_RESOLVE_INTERNAL_TOKEN`
   (`env.agenta.vault_resolve_internal_token`) is set. The agent service reads the same env var and
   sends the header from `VaultConnectionResolver`. A browser session never has the token, so the
   route is not browser-reachable even though it sits on the public secrets router. **Product
   decision needed (flagged):** the token must be provisioned + injected into both the API and the
   agent-service deployments (compose/Helm/Railway), and rotated; until it is set the gate is a
   no-op (a dev backend does not enforce). Deferred the harder network-boundary option.

5. **Resolver emits FULL creds; runner clears a COMPLETE inventory.** The API resolver
   (`_build_env_and_endpoint`) now emits the complete secret group for a cloud deployment from the
   secret's `data.provider.extras` (Bedrock `AWS_*`/profile/bearer, Vertex GCP ADC/api-key, Azure
   key), region/version/base_url on the non-secret endpoint. It no longer fails loud on a cloud
   deployment (that reject moved to the agent layer, post-resolve). `KNOWN_PROVIDER_ENV_VARS` in
   `services/agent/src/engines/sandbox_agent/daemon.ts` replaced with the COMPLETE inventory (every
   `*_API_KEY` + the full AWS/GCP/Azure groups + the `CLAUDE_CODE_USE_*` flags). Because `pi.ts` and
   `sandbox_agent.ts` (both #4814-owned) only *import* the constant and iterate it, expanding it in
   daemon.ts fixes all three clear sites without editing the sibling-owned files.

6. **Pi cloud stays fail-loud in v1.** `harness_allows_deployment` lists only `direct`, so a Pi (or
   Claude) run resolving to bedrock/vertex/azure fails loud post-resolve. Pi custom-endpoint /
   cloud *consumption* (the `endpoint.baseUrl` / `models.json` path) is untouched — it stages with
   model-config.

### Hand-offs to the #4814 owner (shared files I edited in the working tree but do NOT commit)

- `sdks/python/agenta/sdk/agents/dtos.py`: `wire_model_ref` had a literal `"default"` branch that
  the mode collapse broke (it would always emit the connection). Fixed to omit the connection only
  for the default `agenta`-no-slug case. This is correctness-load-bearing for the wire; it must
  ride #4814 (the file's owner). **If not folded in, the default-connection wire regresses.**
- `sdks/python/agenta/sdk/agents/__init__.py`: the new `UnsupportedDeploymentError`,
  `harness_allows_deployment`, and `harness_capabilities_document` are NOT re-exported from the
  top-level `agents/__init__.py` (a #4814-owned file). app.py and the tests import them from the
  submodules (`agenta.sdk.agents.capabilities` / `agenta.sdk.agents.connections`), which works.
  A nicety follow-up: add them to the top-level re-export in #4814.

## 2026-06-24 — PR structure follows the multi-agent coordination protocol

**Context.** The shared dev workspace (`/home/mahmoud/code/agenta`, `gitbutler/workspace`) runs
the canonical protocol in `scratch/agent-coordination.md`: several agents each stack a lane onto
`big-agents`; uncommitted hunks interleave in shared files; **clean PRs are not required and
overlap between PRs is fine**; the rule is "first committer owns a shared file, their PR carries
everyone's hunks; do not hand-split hunks."

Three agent-config features are in flight, line-interleaved in ~13 shared files (`dtos.py`,
`utils/wire.py`, `agents/__init__.py`, `adapters/harnesses.py`, the pi golden,
`test_wire_contract.py`, `protocol.ts`, `pi.ts`, `sandbox_agent.ts`, `run-plan.ts`, etc.):
provider-model-auth (this), skills-config, capability-config.

**Verified ground truth (2026-06-24).**

- `feat/agent-skills` (PR **#4814**, open to `big-agents`) is the first committer of the 13 shared
  files and **already carries this feature's connection integration hunks** (`model_ref`,
  `ResolvedConnection`, the connection `/run` wire fields, the TS env handling) **at zero drift**
  from the current tested working tree. So the connection integration is already represented in
  #4814; it must not be duplicated.
- `feat/agent-capability-config` is PR **#4811**.
- This feature's **pure** files (the `connections/` SDK module, the API `GET/POST
  /vault/connections`, the `app.py` resolver rewire, the `daemon.ts`/`daytona.ts` env-clearing,
  the FE `connectionUtils.ts`, and the project docs) live in GitButler lane
  **`feat/agent-provider-model-connection`** (commit `dd5cb31bac`, 39 files). These files are
  **fully disjoint** from #4814 (55 files) and #4811 — no shared-file overlap, so no merge
  conflict at `big-agents`.

**Decision.** This feature's PR carries only lane `feat/agent-provider-model-connection` (the 39
pure files), opened to `big-agents`. It does NOT re-commit any of the 13 shared files; those ride
in #4814 per the protocol. An earlier attempt to reconstruct a self-contained connection PR in a
clean worktree (hand-splitting the connection hunks out of the shared files) was the WRONG move —
it would duplicate and conflict with #4814 — and was discarded.

**Merge-order dependency (the one real hazard, flagged in `agent-coordination.md`).** #4814's
`dtos.py` imports `from .connections import ModelRef`, and the `connections/` module exists only in
this PR. So **this PR must merge to `big-agents` before or together with #4814**, or `big-agents`
breaks on import. Coordinated with the skills/capability agents via the coordination file.

**Known gaps (post-merge follow-ups).**

- FE host wiring: `connectionUtils.ts` + the static capability map + tests are in; the sub-form is
  not yet mounted in `AgentConfigControl.tsx` (the host edit did not persist; the host file is one
  of the shared files owned by #4814). Mount it as a follow-up.
- Live feature-matrix verification (two OpenAI connections, a custom base_url, a self-managed run)
  needs a running stack and vault keys; deferred.
- The `connections/` module + the #4814 `dtos.py` hunks are reviewed in separate PRs; the
  connection design as a whole reads across both. The PR description points reviewers at #4814 for
  the integration hunks.
