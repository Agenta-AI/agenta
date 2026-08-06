---
name: agent-release-gate
description: >-
  Run the agent release gate — a portable, wire-level QA harness for the agent runtime.
  Drives the same product endpoint the playground drives and asserts on the SSE frame
  stream and real side effects, never on model prose, so it works against any deployment
  (cloud or self-hosted) from three env vars. Use before an agent-workflows release, or
  after changing the runner, the SDK agent adapters, the runner Docker images, or the
  agent service. Triggers: "run the release gate", "QA the agent runtime", "does the
  agent still work end to end", "pre-release agent QA".
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
user-invocable: true
---

# Agent release gate

Product-level sanity QA for the agent runtime, one layer below the playground UI. The question
is not "is every detail right" — it is "**if a user opens the product and does the obvious first
things, do they work?**" This is the gate a release passes before shipping.

Every check asserts on the **wire** (the SSE frame types the browser sees) and on **side effects**
(the file really persisted, the revision really incremented) — never on what the model says. That
makes it deployment-agnostic: point it at any stack and the assertions still hold.

## Run it

Set three environment variables for the deployment under test, then run the gate:

```bash
export AGENTA_BASE=https://your-stack.example.com   # deployment origin
export AGENTA_PROJECT_ID=...                         # target project
export AGENTA_API_KEY=...                            # project API key

uv run resources/qa_product.py --all --custom-slug <vault-slug> --require-store  # everything
uv run resources/qa_product.py --cell P1                         # one cell
uv run resources/qa_product.py --cell C1 --only chat              # one journey
uv run resources/qa_product.py --cell S2 --only warm --only cold1 --require-store  # continuity
```

Paths are relative to this skill's directory. The deployment's vault must hold the provider keys
the cells use (Anthropic / OpenAI / OpenRouter). If the three env vars are unset the driver stops
immediately and names exactly what is missing; a legacy `--env-file <path>` fallback also exists.
`--all` includes cell P2 (a custom OpenAI-compatible provider), which needs a vault slug passed
via `--custom-slug`; the driver fails fast if it's missing. Cells S1, S2 and C1 additionally need
the subscription sidecar logged in on the target deployment — see `resources/coverage.md` for what
each cell requires. The Daytona cells (C2, C4) additionally need the runner's Daytona API key to
have permission to manage Secrets, because credential hiding is on by default; without it those
cells fail at sandbox creation with an error naming the permission.

**The one flag a release conductor must not skip past.** The continuity journeys
(`warm`, `cold1`, `cold2`) only mean anything on a **store-backed** deployment: with no object
store the runner degrades silently to an ephemeral working directory, so those journeys SKIP by
default and FAIL with `--require-store`. Run the gate against a deployment with `AGENTA_STORE_*`
configured and pass `--require-store`, or the greenest possible run still says nothing about
durability. `cold2` additionally needs an operator hook that SIGKILLs the runner replica
(`--cold2-replace-cmd`) and SKIPs without it.

**Reading the result.** Each journey prints `PASS`, `FAIL`, or `SKIP` with a one-line reason, and
a per-cell markdown table lands with the full JSON in `./qa-gate-runs/<timestamp>/` (override the
location with `AGENTA_QA_RUNS_DIR`). Runs are written to the current working directory, never into
the skill. `SKIP` is expected where a journey does not apply to a cell (for example `mcp` on any Pi
cell — user MCP is Claude-only). Any `FAIL` blocks the release until triaged.

**A SKIPped integration test in a security- or concurrency-bearing area is a FAILURE in your
summary line, not green.** State it as "N passed, M skipped OF WHICH k are untested claims" and
name the k. A commit-lock race test skipping for want of a reachable Postgres is exactly how a
one-line syntax error (`SET LOCAL lock_timeout` with a bind parameter, which Postgres rejects
outright) survived 1911 green tests before a human hit it as his first live action.

**Before a human gets a deployment URL, run `resources/qa_commit_approval.py` too.** It is not
part of `qa_product.py`'s cell × journey matrix — none of that matrix's journeys drive a live turn
against a REAL, saved workflow revision (the `commit` journey only exercises the REST API; `chat`,
`tool`, `approve`/`deny` all run against an inline, unsaved config), so nothing else in the gate
observes the S3b single-use execution-authorization gate actually firing around a real config
mutation. This script does: create a real workflow + revision, invoke a live agent turn that calls
`read_config` then `commit_revision`, expect the pause, approve it in-band, and verify the new
revision landed with REST fetch-back. Treat a FAIL here as blocking, the same as any other gate
FAIL.

## Tiers: coached vs. mechanism-blind

Every cell in this gate (`qa_product.py`'s journeys, `qa_commit_approval.py`,
`qa_probe.py`, and all `matrix_w*.py` cells) declares which of two tiers it belongs to, in its
own docstring:

- **Coached (backend-path test).** The prompt names the mechanism verbatim — which tool, which
  operation, which target path. This proves OUR CODE works (the gate, the base check, the
  authorization handoff, the sandbox path) when the right call is made. It proves NOTHING about
  whether a model finds that call from a plain-language human ask.
- **Mechanism-blind (model-behavior test).** The prompt is phrased the way a real user types —
  no tool names, no operation names, no schema hints. Only these cells license a claim about
  what the model can do unprompted.

**Rule: claims of model behavior may only cite mechanism-blind cells.** Every cell currently in
this directory is coached tier — they test backend paths, correctly, but do not stand in for
model-discovery evidence. The gap this rule exists to close, found live: asked in plain words to
"add the skill I saved in your folder," Haiku invented a nonexistent marker syntax
(`{"@ag.embed": {"@ag.references": ...}}`) and the engine accepted it as literal data — a failure
none of the coached cells (including `matrix_w7.py`, whose prompt names `@ag.file` outright)
could ever have caught, because they never test whether the model reaches for the real mechanism
on its own. The mechanism-blind tier is being built separately as the one-shot benchmark (Tier
B), reusing `qa_matrix_lib.py` — do not duplicate it here.

## When results lie

The runtime **fails open**: a component can break, get logged, and the turn still succeeds with a
normal-looking answer. A green turn is therefore not proof on its own. Before trusting a pass,
read `resources/LESSONS.md` — every trap there produced a green test that proved nothing. The three
that bite hardest: replay conversation history byte-faithfully (tool parts included) or every turn
silently goes cold; re-run any prior blocker-level finding after a redeploy before believing it;
and a multi-turn check that never leaves the warm daemon, on a deployment with no object store,
proves nothing about the durable working directory (LESSONS #16).

## Resources (read on demand)

- `resources/coverage.md` — the cells (harness × sandbox × auth), the journeys (chat, mount, tool,
  approve, deny, commit, warm, cold1, cold2, mcp) with a one-line meaning for each, the continuity
  tiers and their method, and a table of what each cell needs beyond the three env vars.
- `resources/LESSONS.md` — the traps. Read before writing or trusting any agent QA test.
- `resources/qa_product.py` — the gate driver (cells × journeys). **Currently broken**: two
  unresolved git merge conflicts sit inside the `CELLS` dict (P2/P3 definitions), a SyntaxError
  that fails the whole file on import, not just those cells. Needs a human to pick the correct
  side per cell before this driver runs again; do not resolve it blind.
- `resources/qa_probe.py` — a one-turn wire probe: `uv run resources/qa_probe.py` confirms the
  product path answers at all before running the full gate.
- `resources/qa_commit_approval.py` — **[coached]** the mandatory pre-handoff commit-approval
  round trip (see above). Self-contained; does not import `qa_product.py`, so it still runs
  while that file is broken.
- `resources/qa_matrix_lib.py` — shared helpers (session/turn plumbing, workflow/revision REST
  calls, the multi-round approval loop) for the `matrix_w*.py` adversarial cells below. Import
  only, no CLI.
- `resources/matrix_w3.py` — **[coached, with a narrow mechanism-blind sliver]** two sessions,
  disjoint edits; session B is given a stale `base_revision_id` and ZERO coaching on recovery.
  Two-tier pass: autonomous correct recovery passes outright; a model that diagnoses the 409
  correctly and asks before re-attempting a config write ALSO passes (that is desirable caution,
  not a failure) once one bare "yes, retry" permission (no mechanics) completes the recovery.
  Guards both the optimistic-concurrency base check and the instructive-error design (a 409 must
  be readable without coaching). The initial action in both sessions is still coached — only the
  RECOVERY step is mechanism-blind; don't cite this cell for "the model finds commit_revision
  unprompted."
- `resources/matrix_w4.py` — **[coached]** a pending approval whose base goes stale while it
  waits (a second session commits first); the EXECUTE-time check must catch it, not just the
  gate-time check.
- `resources/matrix_w5.py` — **[coached]** interrupt a running turn (steer) then use the session
  again. Caught a real bug: the durable mount never gets re-established after a steer, breaking
  every subsequent turn on that session. Distinct from Mahmoud's own steer repro (that one is a
  turn-currency/heartbeat bug; this is a mount-lifecycle bug) — keep the two separate when
  triaging.
- `resources/matrix_w7.py` — **[coached]** an agent writes a workspace file and commits it via an
  `@ag.file` marker; asserts the approval manifest carries digest+bytes and the commit lands with
  the exact bytes. Caught a real bug (fixed, PR #5763-adjacent runner fix): the gate approved
  cleanly but execution always refused with `authorization_missing` — no file-marker commit could
  land. Re-verified PASS after the fix. Note: `DEFERRED_NOT_EXECUTED` on a queued second tool
  call is benign (another gate is already pending), not a real tool error — don't let it fail
  this cell. Naming `@ag.file` verbatim in the prompt is correct for this cell's backend-path
  purpose but means it cannot catch a model failing to find the marker syntax unprompted — see
  Tiers above.
- `resources/matrix_w1_daytona.py` — **[coached]** the commit round-trip on `sandbox=daytona`
  (every other cell runs local). Needs a funded provider vault key (see the file's own docstring
  for the exact vault-secret shape and the `provider_key` slug gotcha). PASS confirms
  `DaytonaWorkspaceReader` and the placeholder-secrets flow live.
- `resources/matrix_t8_saved_files.py` — **[coached]** T8: the Daytona remote agent mount (the
  durable `agent-files/` folder the playground file drawer writes into), which needs the ngrok
  tunnel the runner discovers at sandbox-acquire time. Writes a marker file into the mount via
  the mounts API (`POST /mounts/agents/sign` + `PUT /mounts/{id}/files`) before the run, then
  asserts the runner log line `remote agent mount active for artifact=<id>` appears, a tool
  output actually carries the real marker content (not hallucinated), and the commit lands with
  it. Verified PASS 3/3 runs after the tunnel-seat fix (2026-08-06); this line was absent on
  every attempt before that fix landed.
- `resources/matrix_w7_per_harness.py` — **[coached]** matrix_w7.py's exact scenario run
  identically on all three harnesses (claude, codex, pi_core), each classified PASS/FAIL/SKIP
  independently. Exists because W7 originally ran on Claude only, and that scenario-coverage gap
  is exactly what let the Codex approve-then-fail P0 (2026-08-06) ship: commit_revision + file
  marker + HITL approval on a harness this suite never exercised. claude uses subscription auth
  (no vault dependency); codex and pi_core need a funded OpenAI `provider_key` vault secret
  (mirrors cells X1/C3 in `qa_product.py`) and correctly SKIP with the exact reason when it's
  missing or ambiguous — a SKIP here is an untested harness, not a pass, and must be named as such
  in any release summary. Verified PASS on claude (2026-08-06); codex/pi SKIPPED on this shared
  preview stack because its vault held zero — then, transiently, an ambiguous multiple — OpenAI
  candidates (other concurrent agents' activity on the same shared project); provisioning a
  dedicated, unambiguous OpenAI key for this project is an open follow-up.
- `resources/matrix_w7_daytona.py` — **[coached]** matrix_w7.py's exact scenario with
  `sandbox=daytona` instead of local. The local-only original W7 is exactly why this bug hid: the
  Daytona transport rejects NUL bytes in argv, which the `@ag.file` manifest walk was emitting, so
  no workspace-file commit could EVER land on Daytona, on any harness, until the 2026-08-06 fix
  (found during the same P0 triage, live-verified twice on codex+Daytona: sessions f3fa4335,
  f2f22056). This cell is the sandbox-axis regression guard, staying on the claude harness. Needs
  the same funded Anthropic vault key as `matrix_w1_daytona.py`. Verified PASS (2026-08-06).
- `resources/matrix_invariant_commit_auth_refusal.py` — **[coached scenario; the invariant itself
  is mechanism-level]** the generic invariant: no `tool_result` with empty output and
  `isError:false` may exist for a call whose runner log says `[commit-auth] refused` (the
  silent-blank-success class — the P0's actual failure shape, distinct from the scenario-coverage
  gap `matrix_w7_per_harness.py` addresses). The check itself
  (`qa_matrix_lib.check_no_blank_success_on_refusal`) reads the runner's own log line against the
  wire outcome and is meant to be reusable by any cell that exercises marker-carrying commits, not
  just this one. This cell's trigger is best-effort: run W7's flow, let the legitimate commit
  consume its authorization record, then REPLAY the byte-identical approval-carrying request
  (a duplicate submission) hoping to force a second, doomed `authorizeExecution` attempt. Verified
  2026-08-06: the replay did NOT reproduce a refusal (the runner treats the identical replayed
  history as already-resolved and answers conversationally instead of re-invoking the tool), so
  the cell correctly SKIPped rather than claiming a false pass on an invariant it never exercised.
  A reliable deterministic trigger (e.g. a genuine cold-resume stale-approval replay, or a crafted
  duplicate `toolCallId`) is an open follow-up; until then, treat any SKIP from this cell as "the
  invariant was not tested this run," never as green.

### The lifecycle cells (`matrix_l*.py`) — cold ↔ warm, and what survives each transition

These four cover the session-lifecycle work: which config changes are applied to a RUNNING
sandbox and which tear it down, and what happens to a pending approval, a client tool and the
durable mount across each transition. They all assert the STORED turn ledger
(`POST /sessions/turns/query` → one `sandbox_id` per turn) or the STORED interaction rows
(`POST /sessions/interactions/query`), never the SSE echo — nothing about warm-versus-rebuilt
ever reaches the stream. An empty ledger FAILS a cell; missing evidence is not evidence.

- `resources/matrix_l1_lifecycle_routes.py` — **MANDATORY. [mechanism-blind]** the routing matrix
  itself: for each kind of mid-conversation config change, assert the route the runner took. One
  sandbox id = applied in place, two = rebuilt. Blocks on the four unambiguous cases (no change
  must stay warm; an instructions edit, a permissions edit and a tool-catalog edit must escalate)
  and reports the `model` case rather than guessing at a deployment's connection shape. This is
  the cell that would have caught the `cold1` rot described below.
- `resources/matrix_l2_approval_across_config_change.py` — **MANDATORY. [coached]** the killer
  combination: an approval answered while a config change rides along in the SAME request. It is
  the regression test for the applied-state bug (the pool used to stamp the INCOMING fingerprint
  on the approval-resume path, so the next turn continued warm on an environment running
  something else). Asserts the gated commit lands, the approval row ends `resolved`/`responded`,
  and — the real tell — the config change is not swallowed: it takes effect on the FOLLOWING
  turn, via a rebuild, in both the instructions and the permissions variant.
- `resources/matrix_l3_abandoned_approval.py` — **MANDATORY. [coached]** the user sends a new
  message instead of answering the card. Asserts the gated tool does NOT run (an unanswered
  approval is not consent), the row is swept to `cancelled` rather than left `pending`, and the
  session still works. `cancelled` vs `pending` is the loud-vs-silent distinction: a `pending` row
  is a card sitting on the page that no process is waiting on.
- `resources/matrix_l5_live_route_observed.py` — **MANDATORY. [mechanism-blind, with a control]**
  the other half of L1: an instructions edit made mid-conversation must actually be OBSERVED by
  the harness, not merely written to disk. Runs the same configuration on a fresh cold session as
  a control, so a failure isolates the runner rather than blaming the model; when the control also
  fails it reports INCONCLUSIVE instead of a confident wrong verdict. It asserts the edit, never
  the route, so it stays meaningful if the facet is ever made live again. **Failed 2026-08-06
  (claude/local) and now passes** — see the finding note below.
- `resources/matrix_l4_client_tool_lifecycle.py` — **nice-to-have. [coached]** the client-tool
  round trip, and the only cell that covers client tools at all. Asserts the browser's result
  reaches the model and the `client_tool` interaction is stored. It RECORDS rather than asserts
  the sandbox count, which is two today: a client-tool pause is deliberately not parkable
  (`"warm-hold": RESERVED, not built`, #5384), so every client-tool round trip currently costs a
  rebuild. If that number ever reads one, the warm hold landed and the docstring needs updating.

**Finding the lifecycle cells surfaced (2026-08-06, claude on local, reproduced 3×) — FIXED:** the
`workspaceFiles` live route rewrote the instruction file and advanced applied state, but the
running harness never re-read it. A warm session kept obeying the instructions it started with
while the pool reported the NEW fingerprint, so every later turn matched and continued warm and the
user's edit had no effect until something else evicted the session. A cold session with the
identical configuration obeyed it immediately, which is what isolated the runner. This was the
failure `desired-state.ts` refuses to allow for the `prompts` facet ("refreshing them and claiming
the model saw the change would be a lie") reappearing on the facet that WAS made live — and note
the direction: before the live route existed, an instructions edit forced a rebuild and therefore
took effect on the next turn, so it was a regression in what the user sees, not a speedup.
`matrix_l5_live_route_observed.py` is the repro.

The fix withdrew the route: `workspaceFiles` now routes to `rebuild-sandbox` in the capability
table, and `refresh-workspace` left `LIVE_ACTION_KINDS` so restoring the table alone fails closed.
An instructions edit costs a sandbox again, which is what it cost before the optimisation. **L1's
`instructions` case therefore expects TWO sandbox ids, and L2's first variant expects two as
well** — if you are reading an old green from before 2026-08-06, those cells expected one. The
intended next shape is refresh THEN reopen the session, which needs the reopen to build its
session init from the incoming request first, and needs proving on L5 rather than asserting.

**Why `cold1` changed (read before trusting an old green):** that tier used to force its eviction
by editing `instructions.agents_md`, which the lifecycle work briefly made a LIVE route — the tier
would have gone on passing while measuring warm reuse, and `park`'s "one sandbox id is meaningful"
argument rests on `cold1` reporting two on the same deployment. It now moves `harness.permissions`
(the `harnessSession` facet → `reopen-session`, deliberately not live) and ASSERTS two distinct
sandbox ids. It stays there even though an instructions edit escalates again today: a forcing
function should depend on a route that is escalated by POLICY, not by current capability. Any
future forcing function needs the same check.

**Known verification gap, recorded rather than pretended away:** the cold-resume
stale-approval-regate path (`shouldRegateStaleApproval`, acp-interactions.ts — a stored `allow`
for a marker call whose frozen bytes no longer exist must raise a FRESH gate, not execute on
stale content) has unit coverage through the real wiring (the F8 tests) but no live wire-level
cell. A scripted client cannot force "gate pending → environment evicted → gate answered"
without violating the message-history contract real clients honor (confirmed: inserting an
intervening turn triggers `approval-mismatch(history)` eviction correctly, but the runner then
silently drops the stale decision on resume rather than raising a new card or executing —
itself worth a second look, separate from the original regate question). Do not write a new
wire cell for this without a different approach (e.g. a runner-side hook) than a pure HTTP
client.

*A candidate approach, found while building the `matrix_l*` cells and not yet tried:* a turn that
raises an approval gate AND a client-tool pause together takes the `mixed-gate-no-park` branch in
`session-coordinator.ts` (`approvalToPark` refuses when `nonParkablePauseCount > 0`), so the
environment is destroyed with the approval still pending — "gate pending → environment evicted"
without any intervening user turn and without touching the message history. Answering afterwards
lands on a pool miss and takes the cold decision-map path, which is exactly the state
`shouldRegateStaleApproval` guards. Worth a spike before concluding this needs a runner-side hook.
- `resources/qa_longctx.py` — optional long-context / Gmail / concurrent-session probes. Needs
  live Gmail and GitHub Composio connections in the target project; skip it otherwise.
- `resources/seeds/` — representative green `results.json` files kept as regression-seed references.

## Contributing

Before committing any resource script, run the repo-pinned ruff (`uv run --no-sync ruff format`
then `uv run --no-sync ruff check` from the repo root covers it) — not `uvx`, whose pulled
version has different defaults and produces a false block. Unformatted resource files break the
repo-wide format CI job.

Release-night findings and the full evidence history are archived in
`docs/design/agent-workflows/projects/qa/` (STATUS.md, findings.md, matrix.md).
