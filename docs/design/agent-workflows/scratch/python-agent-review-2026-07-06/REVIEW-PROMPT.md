# Orchestration prompt: comprehensive review of the Python agent side

You are the orchestrator for a full-scope code review of the **Python "decide what to run" side**
of the Agenta agents feature: the agent service and the agent SDK. Hand yourself this file and run
the whole review end to end. It tells you what to produce, how to divide the work across subagents
(which model, which effort, which files), the exact deliverable format, how to synthesize, and how
to commit and open a draft PR at the end.

This review is the second half of a pair. The first half reviewed the TypeScript **runner** (the
part that *runs* the agent) and produced findings at
`docs/design/agent-workflows/scratch/runner-review-2026-07-05/`. Read that runner review's
executive summary before you fan out. Your reviewers must reconcile with it, not contradict it: the
two sides share a wire contract, a credential design, and a duplicated orchestration seam, and
several runner findings point directly at this Python code.

---

## 1. Context

- **What ships next week.** The agents feature launches. This Python code is on the critical path:
  it is what the playground and API actually call. It parses the agent config, resolves tools,
  secrets, connections, MCP, and skills server-side, assembles the `/run` wire request, drives the
  runner over a subprocess or HTTP transport, and translates the streamed result back into the
  frames the playground renders.
- **Maturity.** Like the runner, this started as a POC and is now near production. Expect
  POC-shaped gaps: things that work for one run at a time and one harness, but were never hardened
  for concurrency, version skew, multi-tenancy, non-Pi harnesses, or failure paths.
- **Author.** A Python developer wrote most of this, in their native language. So the idioms review
  here is the mirror of the runner's: judge pydantic v2, async, typing, and clean layering
  discipline, not "a foreigner writing Python."
- **Purpose.** Produce an actionable improvement roadmap the team will work through after launch:
  short-term (before/at launch), medium-term (1-2 months), long-term (structural). This is a
  review, not a rewrite. No source changes.

## 2. What you were asked to do (the clean version)

Review the architecture, responsibilities, and boundaries of this system and its subsystems. Cover
code organization judged against strong references (Lars Grammel's composable-modules and
provider/registry patterns from the Vercel AI SDK; Mitchell Hashimoto's strict layering and
"core-as-a-library"; and the ports-and-adapters style the package already reaches for). Cover code
quality at the function and module level, correctness, the wire contract and its mirrors, tool and
secret and connection resolution, permissions, how the system behaves across harnesses and
transports and sandboxes, and everything downstream: extensibility, flexibility, portability,
maintainability, scalability, testability, and the tests and QA themselves.

Divide the work across subagents. Use the strongest model at high effort for the most important and
most complex subsystems, and a cheaper model at lower effort for the mechanical ones. Work
map-reduce: fan out parallel reviewers, then reduce their findings into per-area reports plus one
executive summary. Update your plan as you go. Write the reports in clear prose (apply the
`style-editing` skill). Split the deliverable by area, and make every recommendation actionable
across short, medium, and long-term horizons, so the team can use them later to clean things up.

## 3. Strategy (map-reduce)

**Scout first, then design the fan-out.** Do not fan out blind. Read the two package READMEs / any
`AGENTS.md` in scope, the runner review's executive summary, and get a file-and-line inventory
(`find ... | xargs wc -l | sort -rn`) so your lane boundaries match the real code. The scout for
this review is already done — the inventory is in section 5. Re-verify anything that looks stale
before you brief a reviewer on it.

**Fan out (wave 1).** Launch all reviewers in ONE message so they run in parallel. Each reviewer is
READ-ONLY, owns one lane, and writes exactly one findings file. They return a compact summary to
you (severity counts + their top 5-8 findings, one line each); the detail lives in their file, not
in the chat. You will be notified as each completes.

**Reduce (wave 2).** When all are in, read every findings file yourself. The gold is the
**convergence**: a finding two independent reviewers reached from different angles is almost
certainly real (in the runner review, the `process.env` global-mutation bug surfaced independently
in the architecture and the entrypoints lanes — that is how you know it matters). Extract the
cross-cutting themes, write the executive summary, and triage the "short-horizon" items into two
groups: those that must gate the launch (data loss, credential leak, silent loss of a shipped
feature, wrong output to the user) and those that are launch-week polish.

**Commit and PR (wave 3).** Commit the docs on a fresh GitButler lane and open a draft PR. Exact
mechanics in section 9.

## 4. The lane division

Eight reviewers. Fable at high effort for the five load-bearing lanes (architecture, wire contract,
tools/secrets/security, the playground-facing stream adapter, and the Python-idioms sweep). Sonnet
for the three more contained lanes (service config/tracing, harness adapters, tests). Give each the
FULL brief below plus the shared deliverable format in section 6 and the reconciliation instruction
in section 7.

Total surface: ~611 lines in the service (`services/oss/src/agent/`) and ~10,900 lines in the SDK
(`sdks/python/agenta/sdk/agents/`).

### Lane A — Architecture, boundaries, orchestration (Fable, high/deep)
The system-level lane. Scope: `services/oss/src/agent/app.py` (328) + `__init__.py`; SDK
`handler.py` (250), `interfaces.py` (296), `__init__.py` (271), `fold.py` (151), `streaming.py`
(99), `adapters/harnesses.py` (173), `adapters/local.py`, `adapters/sandbox_agent.py` (206),
`adapters/_runner_config.py`, `utils/ts_runner.py` (258).
Review: the service-vs-SDK-vs-runner responsibility split ("Python decides what, runner runs it") —
is it held, where does it leak. **Confirm and quantify runner finding A-14**: `app.py` re-implements
the SDK's `AgentComposition` / `make_agent_handler` seam (`handler.py`) instead of calling it, and
the two copies have drifted; measure the duplication and name every place they disagree. The
ports/adapters layering in `interfaces.py` — dependency direction, is it real or decorative. The
`select_backend` seam and transport selection (subprocess vs HTTP via `ts_runner.py`). The public
API surface (`__init__.py` exports — is it coherent, is anything leaking that should be internal).
Extensibility to a new harness or backend from the Python side (the mirror of runner A-4/A-5: is
harness/backend knowledge a table/port here, or scattered conditionals). Propose a target structure
with a realistic migration path.

### Lane B — Wire contract and DTOs (Fable, high/deep)
Scope: `dtos.py` (1232), `wire_models.py` (517), `utils/wire.py` (192), `capabilities.py` (238),
the shared golden fixtures at `sdks/python/oss/tests/pytest/unit/agents/golden/`, `test_wire_contract.py`,
and how `ts_runner.py` frames the request/result.
Review: the **three-mirror problem** — `protocol.ts` (runner) ↔ `wire.py` (hand-built dict) ↔
`wire_models.py` (a second Pydantic mirror that exists only to emit JSON Schema). The runner review
(A-9) argues this has hit its complexity ceiling and recommends a schema-first source; evaluate that
from the Python end and say what the migration would cost here. Pydantic v2 modeling quality —
`dtos.py` at 1232 lines is the biggest file; is it one coherent contract or several concerns fused.
Classify wire fields by semantic role (use the `design-interfaces` skill: data / config / policy /
credentials / routing / protocol-context / metadata) and flag misclassifications, especially the
credential-inside-telemetry design the runner flagged (A-1) — this is the *producer* side of that.
Validation strength (does the SDK validate what it emits and what comes back). The versioning/skew
story: runner A-7 found the SDK never probes `/health` and still posts the deprecated `/run` alias —
confirm from here.

### Lane C — Tools, connections, secrets, MCP resolution (Fable, high/deep) — SECURITY
Scope (service): `tools/resolver.py` (50), `tools/gateway.py` (19), `tools/secrets.py` (12),
`secrets.py` (17). Scope (SDK): `platform/op_catalog.py` (1105), `platform/connections.py` (543),
`platform/connection.py` (151), `platform/gateway.py` (208), `platform/secrets.py` (150),
`platform/platform_tools.py` (123), `platform/resolve.py` (109), `platform/_schema.py`,
`platform/workflow.py`, `tools/models.py` (482), `tools/resolver.py` (228), `tools/compat.py` (146),
`connections/*` (models 224, resolver 154, errors 128), `mcp/*` (models 94, resolver 69, parsing,
errors), `adapters/agenta_builtins.py` (270), `permission_rules.py` (52).
Review: this is the core of "Python decides what to run." How tools, secrets, connections, and MCP
servers resolve server-side; the gateway/vault boundary; where a secret value is read, stored, and
placed into the wire request. Cross-check the runner's security findings: the runner found the
caller bearer and provider keys ride into the agent-readable environment (F1, F2, F9) — trace where
those originate here and whether the Python side could scope or withhold them. The `op_catalog`
(1105 lines — what is it, Composio-backed? is it coherent?). Tool executor kinds and the gate that
the runner enforces — is the Python side sending only what the runner can honestly serve, or does it
emit combinations the runner refuses (code tools, stdio MCP, remote tools on non-Pi). MCP resolution
(flag-gated — confirm the flag name and default; runner A-19 found the docs cite the wrong name and
polarity). Permission rules and how the default permission mode is decided (runner A-10 found the
runner fills a policy default that the service should own). Severity-rate realistically: distinguish
exploitable-in-the-deployed-topology from hardening.

### Lane D — The Vercel stream adapter (Fable, high/deep) — the playground-facing surface
Scope: `adapters/vercel/stream.py` (675), `adapters/vercel/messages.py` (290),
`adapters/vercel/sse.py` (25), `adapters/vercel/routing.py` (24), `adapters/vercel/__init__.py`,
`streaming.py` (99).
Review: this translates the runner's structured event stream into the ai-sdk v6 `UIMessage` frames
the playground renders — it is the highest UI-facing launch risk. ai@6's `UIMessageChunk` is a
strict-object discriminated union, so `stream.py` must emit exactly-conforming frames or the client
rejects them silently. Check every frame type against the ai-sdk v6 contract; check partial-failure,
error frames, tool-call and tool-result frames, interruption/pause (HITL) frames, ordering, and the
known "empty assistant bubble" bug class. Check whether an error on the run is visible to the user
or swallowed into a blank turn. This is correctness-of-translation: the assertion is structural (did
the right frame go out in the right order), not prose.

### Lane E — Service config, schemas, tracing (Sonnet, medium)
Scope: `services/oss/src/agent/config.py` (78), `schemas.py` (80), the config-parsing parts of
`app.py`; SDK `tracing.py` (235).
Review: agent config parsing and validation at the service boundary; the `trace` block the SDK fills
from the live workflow span and the runner consumes (the *producer* end of runner A-1's
credential-in-telemetry design — is the Agenta secret and API base deliberately packed into the OTLP
exporter headers here, and could a first-class field replace it); env/config discipline (does the
service read config through a shared env object per the repo convention, or call `os.getenv`
directly); schema coherence and where validation is missing.

### Lane F — Harness and platform adapters (Sonnet, medium)
Scope: `adapters/claude_settings.py` (262), `adapters/harnesses.py` (173), `capabilities.py` (238),
`adapters/agenta_builtins.py` (270), `platform/workflow.py` (123), `platform/_schema.py` (128),
`skills/*` (models 117, parsing 90, wire 20, errors).
Review: per-harness rendering — this is where the `harnessFiles` pattern originates (the runner
writes these files blind; `claude_settings.py` renders `.claude/settings.json` including the
permission rules). Harness identity and capabilities declaration. Skills materialization and the
wire shape for skills. This is the Python end of runner finding A-4 (harness knowledge should live
in one profile/table): judge whether harness specifics are contained in these adapters or smeared,
and whether adding codex/opencode is a one-adapter change or a scattered edit.

### Lane G — Tests and QA (Sonnet, medium) — runs the suite
Scope: `sdks/python/oss/tests/pytest/unit/agents/**`, `integration/agents/**` (incl.
`test_transport_roundtrip.py` and `_fake_runner_backend.py`), `sdks/python/agenta/tests/agents/`,
the golden fixtures.
Review: produce a coverage map per module (which source file has a test, behavior vs
implementation-detail). Actually run the suite — from `sdks/python`: `uv sync --locked && uv run
--no-sync python run-tests.py` (or the narrower `pytest` target for the agents dir); report what
passed. Judge fake/seam discipline (`_fake_runner_backend` — does it duck-type or subclass the real
transport). The wire-contract golden pinning from the Python side. Flag the untested load-bearing
modules (candidates: `op_catalog.py`, `platform/connections.py`, `adapters/vercel/stream.py`) and
name the single highest-value test to add before launch. Note whether this suite runs in CI.

### Lane H — Python idioms and code quality (Fable, high/deep)
Scope: ALL of both trees. Go deeper on the big files (`dtos.py` 1232, `op_catalog.py` 1105,
`stream.py` 675, `connections.py` 543).
Review: native-Python quality — pydantic v2 idioms (validators, model config, `model_dump` vs hand
dicts — note `wire.py` builds a dict by hand while `wire_models.py` is a real model; that split is a
smell), async/await discipline and any sync IO on async paths, typing precision (count `Any`,
`# type: ignore`, `cast`, bare `except` — produce a top-10 offenders table), exceptions-as-control-
flow vs result types, module organization and split candidates, near-duplicate helpers across files,
dead code (exported symbols never imported — verify with grep), naming and convention consistency.
Judge organization against clean-architecture / ports-and-adapters (the package already uses
`interfaces.py` / `adapters/` / `platform/` naming — is the dependency direction actually enforced,
or do adapters import inward-and-outward). Tooling payoff: check `ruff` and `mypy` config for what
is on and what turning each stricter flag on would cost; recommend a concrete ratchet.

## 5. Verified file inventory (scout result, 2026-07-06)

`services/oss/src/agent/` (611 lines): `app.py` 328, `schemas.py` 80, `config.py` 78,
`tools/resolver.py` 50, `tools/gateway.py` 19, `secrets.py` 17, `tools/__init__.py` 14,
`__init__.py` 13, `tools/secrets.py` 12.

`sdks/python/agenta/sdk/agents/` (10,897 lines), top files: `dtos.py` 1232, `platform/op_catalog.py`
1105, `adapters/vercel/stream.py` 675, `platform/connections.py` 543, `wire_models.py` 517,
`tools/models.py` 482, `interfaces.py` 296, `adapters/vercel/messages.py` 290, `__init__.py` 271,
`adapters/agenta_builtins.py` 270, `adapters/claude_settings.py` 262, `utils/ts_runner.py` 258,
`handler.py` 250, `capabilities.py` 238, `tracing.py` 235, `tools/resolver.py` 228,
`connections/models.py` 224, `platform/gateway.py` 208, `adapters/sandbox_agent.py` 206,
`utils/wire.py` 192, `adapters/harnesses.py` 173, `connections/resolver.py` 154,
`platform/connection.py` 151, `fold.py` 151, `platform/secrets.py` 150, `tools/compat.py` 146,
`platform/_schema.py` 128, `connections/errors.py` 128, `platform/workflow.py` 123,
`platform/platform_tools.py` 123, `skills/models.py` 117, `platform/resolve.py` 109,
`streaming.py` 99, plus smaller files under `mcp/`, `skills/`, `connections/`, `adapters/vercel/`.
Subdirs: `adapters/` (+ `adapters/vercel/`), `connections/`, `mcp/`, `platform/`, `skills/`,
`tools/`, `utils/`.

Tests: `sdks/python/oss/tests/pytest/unit/agents/**` (with `golden/`, `adapters/`, `tools/`,
`connections/`, `platform/`, `mcp/`, `skills/` subdirs), `integration/agents/`
(`test_transport_roundtrip.py`, `_fake_runner_backend.py`), `sdks/python/agenta/tests/agents/`.

Re-run the `find | wc -l` yourself before briefing, in case the tree moved.

## 6. The deliverable format every reviewer must follow

Each reviewer writes ONE file to `findings/<lane>.md` (paths in section 8) with this structure. This
format is what made the runner review usable — hold every reviewer to it.

1. **Scope line** — what they read.
2. **"How it actually works" — verified against code.** A short walkthrough of the real behavior of
   their subsystem, with file:line anchors. Note any drift between docs/comments and code
   explicitly (the runner review found a README describing a removed architecture — assume nothing,
   verify everything).
3. **"Strengths — keep this."** Be honest and specific. The roadmap builds on strengths; name them
   so refactors do not destroy them.
4. **Numbered findings.** Each carries: a severity (**blocker / high / medium / low**), file:line
   references, what and why, a **concrete failure scenario** for any correctness or security
   finding (specific inputs/state → wrong result), an **actionable recommendation** (not "consider
   improving" — say what to change), and a **horizon** (**short** = before/at launch, **medium** =
   1-2 months, **long** = structural).
5. **A top-10 priority list** for the lane.

Then each reviewer returns to you, in chat, ONLY: severity counts + their top 5-8 findings, one
line each. Detail stays in the file. Tell them so explicitly, so they do not dump the file into the
chat and blow up your context.

**Severity calibration.** Blocker = do not launch (data loss, credential leak, silent loss of a
shipped feature, wrong output to the user with no error). High = fix in launch window. Medium =
1-2 months. Low = cleanup. Be realistic; do not inflate.

## 7. Reconciliation with the runner review (give this to every reviewer)

Before finalizing, read the relevant runner findings at
`docs/design/agent-workflows/scratch/runner-review-2026-07-05/findings/` and the executive summary
at `reports/00-executive-summary.md`. Where a runner finding names this Python code, verify it from
the Python side and either confirm it (with the Python-side file:line and the fix that belongs
here) or refute it. The load-bearing cross-references: A-14 (duplicated orchestration — lane A),
A-1/A-2 (credential and API base smuggled through telemetry config — lanes B, E), A-7 (no `/health`
version probe, still posts `/run` — lane B), A-9 (the three-mirror contract at its ceiling — lane
B), A-10 (policy default owned by the wrong side — lane C), A-4 (harness knowledge should be one
table — lane F), and the security findings F1/F2/F9 (caller bearer + provider keys reach the agent
environment — lane C). The two reviews must tell one consistent story.

## 8. Workspace layout

Everything lives under `docs/design/agent-workflows/scratch/python-agent-review-2026-07-06/`
(already created):

- `REVIEW-PROMPT.md` — this file.
- `PLAN.md` — you maintain it: the lane table and a status checklist (scout / wave 1 / wave 2).
  Update it as waves complete.
- `findings/` — one file per lane: `arch-boundaries.md`, `wire-contract-dtos.md`,
  `tools-secrets-security.md`, `vercel-stream.md`, `service-config-tracing.md`, `harness-adapters.md`,
  `tests-qa.md`, `python-idioms-quality.md`.
- `reports/00-executive-summary.md` — your synthesis (see section for what it holds).

The executive summary must contain: a one-paragraph verdict; a "what the codebase got right"
section; the blockers called out on their own; the **cross-cutting themes** (the convergence across
lanes — this is the most valuable part); a severity dashboard table (counts per lane); and the
**roadmap** with the short-horizon items triaged into must-gate-launch vs launch-week, then medium
and long. Write it with the `style-editing` skill: active voice, characters-as-subjects, no em
dashes, short sentences, vary the rhythm, lead paragraphs with the claim and end on the strongest
word. Point to each lane's findings file for detail.

## 9. Commit and draft PR (do this at the end, and only the docs)

Commit ONLY the review docs, on a fresh GitButler lane, then open a draft PR. The working tree will
have unrelated unassigned changes from other sessions — do not sweep them in. Verify at every step.

1. `but status` — find your files' cliIds (the 2-4 char codes). Your files are everything under
   `python-agent-review-2026-07-06/`.
2. `but branch new docs/python-agent-review-2026-07-06`.
3. Assign each of your files to the lane by cliId: `but rub <cliId> docs/python-agent-review-2026-07-06`.
   Use cliIds, not paths — paths go stale after any `but` mutation. Untracked/new files can be
   stubborn; if `rub` misroutes a new file, fall back to `but commit <lane>` with only your files in
   the assigned set.
4. `but status` again — confirm ONLY your files are staged to the lane, nothing else.
5. `but commit docs/python-agent-review-2026-07-06 --only -m "docs(agent): ..."`. End the commit
   body with `Claude-Session: <this session's URL>`.
6. **Verify the tree, not the chat:** `git show --stat --name-only docs/python-agent-review-2026-07-06`
   — confirm exactly your files landed and nothing foreign leaked in.
7. `but push docs/python-agent-review-2026-07-06`. It prints nothing on success, so verify:
   `git rev-parse docs/python-agent-review-2026-07-06` must equal
   `git ls-remote --heads origin docs/python-agent-review-2026-07-06`.
8. **PR base gotcha (this bit us on the runner review).** The workspace base is far ahead of
   `origin/main` (roughly 900 commits), so a PR against `main` sweeps in the whole workspace. Find
   your commit's parent (`git rev-parse docs/python-agent-review-2026-07-06^`) and the remote branch
   pointing at it (`git ls-remote --heads origin | grep <parent-sha>`) — it will be `big-agents`.
   Base the PR on that branch so the diff is just your review files.
9. `gh pr create --draft --base big-agents --head docs/python-agent-review-2026-07-06 --title
   "docs(agent): Python agent-service + SDK code review" --body "..."` (use the `write-pr-description`
   skill for the body; end it with the session URL). If `gh pr edit` is ever needed to fix the base,
   it fails here on a classic-Projects GraphQL bug — use
   `gh api repos/Agenta-AI/agenta/pulls/<n> -X PATCH -f base=big-agents` instead.
10. Verify the PR shows exactly your files: `gh pr view <n> --json baseRefName,commits` should show
    base `big-agents` and 1 commit; `gh api repos/Agenta-AI/agenta/pulls/<n>/files --jq '.[].filename'`
    should list only your review docs.

## 10. Learnings from the runner review (apply them here)

- **Scout before you fan out.** The lane boundaries only work if they match the real file tree. The
  inventory in section 5 is the scout; re-verify it.
- **Convergence is signal.** When two reviewers reach the same finding from different lanes, it is
  real and it goes to the top. Look for it deliberately in the reduce step.
- **The reviewers' compact-return discipline protects your context.** Insist on counts + top-N in
  chat, full detail in the file. Read the files yourself in the reduce step; do not ask reviewers to
  paste them.
- **Fable earns its cost on the load-bearing lanes** (architecture, contract, security, the
  UI-facing adapter, the idioms sweep). Sonnet is right for the contained, more mechanical lanes.
  Match effort to stakes.
- **"Verified against code" beats "as documented."** The single most useful move was making every
  reviewer reconstruct real behavior and flag doc drift. The runner's README described an
  architecture that no longer existed. Trust nothing until it is checked against the code.
- **Triage the short horizon.** "Short" is not the same as "launch-blocking." Separate the items
  that lose data / leak credentials / drop a shipped feature from the cheap hardening, so the team
  knows what actually gates the release.
- **Commit hygiene with GitButler.** Assign by cliId, commit `--only`, verify the tree with
  `git show --stat`, and remember the PR base must be the parent lane (`big-agents`), set via
  `gh api ... PATCH` because `gh pr edit` is broken here.
- **Reconcile the two reviews.** This one is new: the Python and TS reviews share a contract and a
  credential design. Feed the runner findings to these reviewers so the two halves agree.

Now: re-verify the inventory, write `PLAN.md`, launch the eight reviewers in one message, wait for
all eight, synthesize, and commit + open the draft PR.
