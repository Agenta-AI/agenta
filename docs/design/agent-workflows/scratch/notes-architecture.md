# Architecture doc notes (open questions and follow-ups)

These are items I could not fully close while reconciling the architecture / sidecar /
sessions / protocol / ground-truth docs against the code on 2026-06-23. Each is written so you
can act on it cold. File:line citations are from the working tree at that date.

## Corrections I made (so you can spot-check)

- The deployed service ALWAYS uses `SandboxAgentBackend`. `select_backend`
  (`services/oss/src/agent/app.py:49`) hard-codes it and does not branch on harness. The old
  docs implied the service picks between `InProcessPiBackend` and `SandboxAgentBackend`. It
  does not. `InProcessPiBackend` is reference-only and is exercised by tests / standalone
  scripts, not the running service. Confirmed by `services/oss/tests/pytest/unit/agent/test_select_backend.py`.
- `SandboxAgentBackend.supported_harnesses` is `{pi, claude, agenta}`
  (`sdks/python/agenta/sdk/agents/adapters/sandbox_agent.py:121`). Old architecture/ports docs
  said `{pi, claude}` and claimed `agenta` was in-process-only or unsupported on sandbox-agent.
  Stale. `agenta` maps to the `pi` ACP agent (`engines/sandbox_agent/run-plan.ts:78`).
- Pi `systemPrompt` / `appendSystemPrompt` ARE delivered on the sandbox-agent path now
  (`engines/sandbox_agent/pi-assets.ts:71-107`, called from `prepareLocalPiAssets` line 181 and
  the Daytona path in `daytona.ts`). The old docs and QA matrix said "dropped on sandbox-agent
  (F-001)". `projects/qa/findings.md` F-001 is marked **resolved** and the code confirms it.
  NOTE: `projects/qa/matrix.md` still shows `append_system / pi` as `known-fail (F-001)` /
  `fail (F-001)` and references `sandbox_agent.ts:875`. That matrix is STALE relative to the
  code and findings.md. The matrix is owned by the QA project, not by me, so I did not edit it.
  RECOMMEND: have the QA owner flip those matrix cells to pass and drop the `:875` line ref
  (the monolithic `sandbox_agent.ts` was split into `engines/sandbox_agent/*`, so old line
  numbers like `:875`, `:933-949`, `:961` in findings.md and matrix.md no longer resolve).

## Stale line numbers across QA docs (not mine to edit)

`projects/qa/findings.md` and `projects/qa/matrix.md` cite line numbers in a now-split file:
- `sandbox_agent.ts:875` (F-001, append_system) - file was refactored into
  `services/agent/src/engines/sandbox_agent/` (run-plan, pi-assets, model, mcp, etc.).
- `sandbox_agent.ts:961` (F-007, applyModel) - now `engines/sandbox_agent/model.ts` +
  `applyModel`.
- `sandbox_agent.ts:933-949` (F-009, MCP) - now `engines/sandbox_agent/mcp.ts`.
These still point at the right concepts but the wrong locations. A QA-owner pass should refresh
them. I cite the new files in the docs I own.

## Open question: is `agenta` harness genuinely first-class on sandbox-agent, or pi-with-extras?

The runner maps `harness: "agenta"` to `acpAgent = "pi"` and layers forced skills + prompt
extras (`run-plan.ts:78`). So on sandbox-agent, `agenta` is "pi ACP agent + Agenta forced
config", not a distinct ACP agent. I described it that way. Confirm this is the intended
long-term model (vs. a real `agenta` ACP agent) before the agent-template doc hardens it.

## Open question: model override on sandbox-agent Pi

QA F-007 says pi-acp accepts only `default` for the model category, so a real model id is
silently dropped on the Pi-over-sandbox-agent path. I documented this as a current gap in
architecture.md and ground-truth.md. I did NOT independently re-verify against pi-acp source
(it lives in the `sandbox-agent` npm package, not this repo). If you can confirm whether pi-acp
exposes any non-default model channel, that resolves whether F-007 is "wire it" or "fail loud".

## Open question: sidecar.md vs folding into architecture.md

I folded the sidecar story into `architecture.md` (sections "The Sidecar", "Licensing and
images", "Daytona sandbox") rather than creating `documentation/sidecar.md`. Reason: `README.md`
(not mine to edit) lists the doc reading order and has no `sidecar.md` entry; a new unreferenced
file would be a dangling doc. If you prefer a dedicated `sidecar.md`, move those three sections
out and add a README link. The content is self-contained enough to lift cleanly.

## Open question: `LocalBackend` plan path

`sdks/python/agenta/sdk/agents/adapters/local.py:16` points readers to
`docs/design/agent-workflows/scratch/sdk-local-backend/plan.md`. After the restructure that
content is at `docs/design/agent-workflows/archive/sdk-local-backend/` (and the active
workstream is `projects/sdk-local-tools/`). The code comment's doc path is now wrong. That is a
code comment, not a doc I own, so I left it. RECOMMEND a one-line fix in `local.py` to the new
path, or to `projects/sdk-local-tools/`.

## Not verified live

I did not run the stack. All claims about runtime behavior are read from code plus the existing
QA captures (`projects/qa/findings.md`, `projects/qa/matrix.md`,
`scratch/feature-matrix-test.md`). The most load-bearing un-rerun claims:
- system-prompt delivery on Daytona (read from `daytona.ts` + `pi-assets.ts`; QA F-001 verified
  local and Daytona on 2026-06-20).
- `InMemorySessionPersistDriver` not surviving across turns (read from the cold per-`/run`
  lifecycle in `engines/sandbox_agent.ts`; no cross-process store is constructed).

## Minor: SDK `interfaces.py` docstring lists only Pi/Claude harnesses

`sdks/python/agenta/sdk/agents/interfaces.py:14-15` names `PiHarness` / `ClaudeHarness` but not
`AgentaHarness`. Cosmetic staleness in a code docstring (not a doc I own). Worth a one-word fix
when someone touches that file.
