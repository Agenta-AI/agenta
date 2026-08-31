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

uv run resources/qa_product.py --all --custom-slug <vault-slug> --custom-name "<display-name>" --require-store  # everything
uv run resources/qa_product.py --cell P1                         # one cell
uv run resources/qa_product.py --cell C1 --only chat              # one journey
uv run resources/qa_product.py --cell S2 --only warm --only cold1 --require-store  # continuity
```

**EXPORT the three variables, do not just set them.** The driver falls back to an env FILE when
`AGENTA_*` is absent from its environment, which is helpful interactively and dangerous in a
release run: a credentials file of bare `KEY=value` lines sourced with `. file` sets the shell
only, the child `uv run` process inherits nothing, and the driver silently runs the whole gate
against WHATEVER DEPLOYMENT the fallback file names. The failure surfaces as `401 Invalid
credentials` from a stage whose key you just watched answer 200, or worse as a green run
recorded against the wrong stack. Use `set -a` around the source, or `export` each variable,
and confirm the stage in the results before trusting them. (Cost a staging gate run on
2026-08-28; the fallback degrades to "wrong deployment", never to "no credentials".)

Paths are relative to this skill's directory. The deployment's vault must hold the provider keys
the cells use (Anthropic / OpenAI / OpenRouter). If the three env vars are unset the driver stops
immediately and names exactly what is missing; a legacy `--env-file <path>` fallback also exists.
`--all` includes cells P2, P2b, and P3 (a custom OpenAI-compatible provider, with P2 and P2b
running locally and P3 on Daytona), which need a vault slug passed via `--custom-slug`; the driver fails
fast if it's missing. `--custom-name` is also required because `model_keys` is built from the
display name rather than the stable slug. Custom-provider cells skip the credential-rotation
journey because their value is write-only and cannot be safely restored. Cells S1, S2 and C1
additionally need
the subscription sidecar logged in on the target deployment — see `resources/coverage.md` for what
each cell requires. The Daytona cells (C2, C4, P3, X2) additionally run the `secret_opaque`
journey and need the runner's Daytona API key to manage Secrets, because credential hiding is on
by default; without it those cells fail at sandbox creation with an error naming the permission.

**The one flag a release conductor must not skip past.** The continuity journeys
(`warm`, `cold1`, `cold2`) only mean anything on a **store-backed** deployment: with no object
store the runner degrades silently to an ephemeral working directory, so those journeys SKIP by
default and FAIL with `--require-store`. Run the gate against a deployment with `AGENTA_STORE_*`
configured and pass `--require-store`, or the greenest possible run still says nothing about
durability. `cold2` additionally needs an operator hook that SIGKILLs the runner replica
(`--cold2-replace-cmd`) and SKIPs without it.

**The flag that makes the gate fit the release: `--release-base`.** The matrix is fixed, so
without it a release that reworked a subsystem gets exactly the coverage of a release that did
not touch it. Pass the ref the release branches from, and the driver reads the release's own
changed paths, matches them against the rules in `resources/path_triggers.py`, and makes the
cells those rules name MANDATORY for this run:

```bash
uv run resources/qa_product.py --all --release-base origin/main --require-store   # every release run
uv run resources/path_triggers.py --release-base origin/main                      # preview only, runs nothing
```

A mandatory cell that lives in `qa_product.py` is added to the run even when `--cell` did not ask
for it. A mandatory cell that is a standalone `matrix_*.py` script is a separate process the
driver cannot observe, so it is printed, written to `mandatory.json`, and listed in `summary.md`
under "Mandatory for this release" — **the release is not green until each of those has a recorded
result of its own.** If a rule names a cell that does not exist, the driver stops before running
anything and says so: the release changed code a rule protects and the coverage was never
written, which is the one outcome that must never read as green. Add `--changed-path` to state
paths by hand where the checkout is not the release branch. With no `--release-base` and no
`--changed-path` nothing changes, so every existing invocation behaves exactly as before.

Adding a rule is one line in `PATH_TRIGGERS` (a glob, and the cells it makes mandatory) plus the
cell it names. Matching is `fnmatch` over the whole repo-relative path, so `*` crosses directory
separators and `a/b/*` covers the whole subtree; write `**` so a subtree rule reads as one.

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

**Rule: claims of model behavior may only cite mechanism-blind cells.** Most cells in this
directory are coached tier — they test backend paths, correctly, but do not stand in for
model-discovery evidence. The gap this rule exists to close, found live: asked in plain words to
"add the skill I saved in your folder," Haiku invented a nonexistent marker syntax
(`{"@ag.embed": {"@ag.references": ...}}`) and the engine accepted it as literal data — a failure
none of the coached cells (including `matrix_w7.py`, whose prompt names `@ag.file` outright)
could ever have caught, because they never test whether the model reaches for the real mechanism
on its own. `resources/matrix_g1_guidance_discovery.py` is this directory's first mechanism-blind
cell, promoted after the platform-guidance fix closed that exact gap; it reuses `qa_matrix_lib.py`
the same way the separate one-shot benchmark (Tier B) does — check there before writing a new
mechanism-blind cell from scratch, to avoid duplicating scaffolding.

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
- `resources/qa_product.py` — the gate driver (cells × journeys).
- `resources/matrix_gw1_gateway_tools.py` — **[coached, with one mechanism-blind leg]** the
  gateway tool surface against a real provider: search filters by policy (the denied key never
  reaches the model), an allowed tool executes unattended with a genuine provider result, and an
  ask-tier tool parks with the right stored identity and is answered through the **interactions
  API** — the durable plane a reloaded browser uses, which no other cell covers. The fixed
  matrix proves approvals with a builtin, so nothing else notices when the compiled policy and
  the enforced policy drift apart. Defaults to the no-auth `text_to_pdf` connection; `--integration`
  and `--connection` point it elsewhere. SKIPs, naming the fixture, when no valid connection
  exists, and SKIPs rather than failing the release when the model provider itself errors.
  Made mandatory by the gateway rule in `path_triggers.py`.
- `resources/path_triggers.py` — the path-scoped rules: one dict mapping a path glob to the cells
  a release must run when its diff touches that glob, plus the two functions the driver calls.
  Runs standalone as a preview (`--release-base <ref>`). Add a rule here whenever new coverage is
  only meaningful for changes in one part of the tree.
- `resources/qa_probe.py` — a one-turn wire probe: `uv run resources/qa_probe.py` confirms the
  product path answers at all before running the full gate.
- `resources/qa_commit_approval.py` — **[coached]** the mandatory pre-handoff commit-approval
  round trip (see above). Self-contained; does not import `qa_product.py`.
- `resources/qa_matrix_lib.py` — shared helpers (session/turn plumbing, workflow/revision REST
  calls, the multi-round approval loop) for the `matrix_w*.py` adversarial cells below. Import
  only, no CLI. It also holds the two cross-cutting invariants every cell should fold into its
  verdict — `check_no_blank_success_on_refusal` and `check_no_silent_turn` (see below). **If you
  write a new cell, wire `check_no_silent_turn` into its PASS condition.**
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
  in any release summary. `--only <harness>` runs a single leg without re-spending budget on the
  others. Verified PASS on claude (2026-08-06). codex/pi initially SKIPPED on this shared preview
  stack because its vault held zero — then, transiently, an ambiguous multiple — OpenAI candidates
  (other concurrent agents' activity on the same shared project); resolved 2026-08-06 by stocking
  one unambiguous OpenAI `provider_key` secret (no stale entries existed to remove). Re-verified
  PASS on codex after stocking the key (session 58ce3a58-8d04-40ac-99e4-c44eaa5d7b06).
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
- `qa_matrix_lib.check_no_silent_turn(turns)` — **[mechanism-level invariant; no cell of its
  own]** no turn may come back completely bare: no text, no tool call, no approval gate, no file
  or data payload, and no error. That combination is a swallowed provider failure (ASD-EST100) —
  the model call is rejected, the error is dropped on the way back, and the turn is reported as a
  clean empty finish, so the user sees a blank bubble with no reason anywhere. It matters most in
  cells whose PASS depends on something NOT appearing (no error, no leak, no blank success): a
  turn that produced nothing satisfies those by doing nothing at all. Its content definition
  deliberately mirrors `content_parts_emitted` in the product's own Vercel egress
  (`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`) — reasoning does NOT count, so a
  turn that only thought is still a violation. Wired into `matrix_w7*.py`, `matrix_t8_saved_files.py`,
  `matrix_b1_builtin_find.py`, `matrix_invariant_commit_auth_refusal.py`,
  `matrix_l3_abandoned_approval.py`, `matrix_w3.py`, `matrix_w4.py` and `matrix_w5.py` as
  `... and not silent["violations"]`; add the same conjunct to any new cell. The one thing a cell
  must exclude itself is a turn it deliberately aborted or interrupted, which legitimately ends
  bare — `matrix_w5.py` shows the pattern (it checks only its post-interrupt turns).
- `resources/matrix_g1_guidance_discovery.py` — **[mechanism-blind]** does the platform guidance
  actually change what the model does? The trial prompt is Mahmoud's own verbatim phrasing from
  the live session that found the bug ("can you add gstack-autoplan skill to your skills (i saved
  it in your folder)") — no tool, operation, or marker syntax named. Before the guidance existed,
  this exact phrasing made a model copy the skill into its own harness-local skills folder and
  claim success without ever proposing a commit, 3/3 live (session b59cb549). Two parts per
  harness/model/sandbox leg: PROBE reads the rendered instructions file out of the workspace and
  asserts the fenced platform-guidance block and the skill-location sentence are really there;
  TRIALS run the prompt N times, PASS only when a commit_revision gate fires, is approved, and the
  STORED revision carries the skill (copying into the harness's own folder is a FAIL). Setup
  gotchas baked into `qa_matrix_lib.py` (`PI_CORE_HARNESS_KIND`, `PI_CORE_HAIKU_MODEL`): the Pi
  harness kind enum is `"pi_core"` (bare `"pi"` 500s), and `pi_core` rejects a bare `"haiku"` model
  id (needs `"claude-haiku-4-5"`); codex accepts its curated short alias (`"gpt-5.6-luna"`) bare.
  Both legs need `sandbox=daytona` + a vault key (codex: OpenAI; pi_core: the same Anthropic key
  `matrix_w1_daytona.py` documents) and SKIP with the exact reason when the credential is missing
  or ambiguous. `--only <leg>` runs a single leg without re-spending trial budget on the other.
  Neither leg has yet scored a clean 4/4 live, and both failure modes are real, reproducible model
  mechanics misses, not noise or infra flake — treat this cell's discovery rate as a genuine open
  quality question, not a settled pass:
  - **pi_core: 2/3** (2026-08-06). Trial 2's model ran `cp -r agent-files/gstack-autoplan
    .agenta-imports/` (copying the whole directory) then referenced a marker path that didn't
    match where the file landed; the engine correctly denied it fail-closed
    (`approved-content resolution failed ...: gstack-autoplan/SKILL.md does not exist under
    .agenta-imports/.; deny`). Not a product bug — the deny is doing its job — but evidence the
    model fumbles the exact copy-then-reference mechanics some of the time.
  - **codex: 2/3** (2026-08-06, re-verified after stocking a clean OpenAI vault key — the earlier
    SKIP was purely the missing/ambiguous credential, now resolved). Trial 1 didn't attempt the
    mechanism at all: zero gates approved, the model just replied "I can't add skills by simply
    placing files in the skills folder; skills must be enabled through the agent configuration"
    (session 4fa17164-3ada-4ef6-86b5-63bf1c64f10b) — it named the right concept but never called
    read_config/commit_revision to act on it. Trials 2 and 3 passed cleanly (sessions
    4c6a758b-39a3-4789-890e-06f3d68196b6, bf8a1283-667c-45c7-ab0d-b112e12106db).

  Worth a call: whether the guidance text needs to be more directive (e.g. explicitly say "copy
  the FILE, not the directory" and "always attempt the tool calls, don't just describe the
  mechanism"), or whether ~2/3 is an acceptable bar for this feature's launch.

### Builtin capability cells (`matrix_b*.py`) — does the harness's own tooling still work

- `resources/matrix_b1_builtin_find.py` — **[coached, harness-mechanism test]** one native
  file-search call per harness (write three known marker files, then ask the model to locate
  them via its own search capability — never a manual directory listing), asserting the exact
  filenames come back in the TOOL OUTPUT payload, never the reply. Exists because nothing else in
  the gate ever exercised a harness builtin: verify-runner's overnight diagnosis found Pi's
  `find` builtin dead 52/52 across two benchmark runs (it shells out to the vendored `fd` binary
  with a flag that only exists from fd 9 onward; the runner image ships fd 8.6.0) — a total
  capability loss that sat invisible with nothing calling it. This cell closes that discoverability
  gap for the class, not just this one instance. **Open discrepancy, not yet reconciled**: this
  cell's own pi_core leg PASSED twice, live, with real filenames back
  (2026-08-07, sessions dd9c51ef-92d0-4780-855e-da6f48e07d9f and
  47f02ab1-61ec-4db8-a0d6-2d96e98b9188) — which does not match "52/52 failed". Either the break is
  conditional on a flag/option this cell's simple case never exercises, or something already
  changed; needs reconciling with verify-runner before Pi's `find` gets called either fixed or
  still broken. **Codex SKIPs by design**, not tested: its exec output doesn't land in the
  `tool-output-available` payload's `.output` field (the same quirk `qa_product.py`'s `j2_mount`
  already names and skips codex for), so this cell's evidence extraction cannot see codex's real
  results — a codex-shaped extraction is a follow-up. Claude PASSED cleanly on the two-turn
  version (session 4081e9ee-11c1-4f12-8245-6c390f90e9d8). Needed two EXPLICIT turns (write, then
  search) — one combined instruction left claude stopping after the write step without
  attempting the search at all.

### The lifecycle cells (`matrix_l*.py`) — cold ↔ warm, and what survives each transition

These four cover the session-lifecycle work: which config changes are applied to a RUNNING
sandbox and which tear it down, and what happens to a pending approval, a client tool and the
durable mount across each transition. They all assert the STORED turn ledger
(`POST /sessions/turns/query` → one `sandbox_id` per turn) or the STORED interaction rows
(`POST /sessions/interactions/query`), never the SSE echo — nothing about warm-versus-rebuilt
ever reaches the stream. An empty ledger FAILS a cell; missing evidence is not evidence.

- `resources/matrix_l1_lifecycle_routes.py` — **MANDATORY. [mechanism-blind]** the routing matrix
  itself: for each kind of mid-conversation config change, assert the route the runner took. One
  sandbox id = applied in place, two = rebuilt. Blocks on six cases: no change must stay warm; an
  instructions edit, a permissions edit and a tool-catalog edit must escalate; and a
  same-connection model switch must stay warm on BOTH claude and pi_core. The pi_core model case
  (added 2026-08-29) is the standing trap for the wire-spelling bug class: the router once keyed
  its table on the bare "pi" literal while the wire carries "pi_core", every playground model
  switch silently rebuilt, and the claude-only case could not see it (#6364). This is the cell
  that would have caught the `cold1` rot described below.
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
  (claude/local) and now passes** — see the finding note below. Extended 2026-08-06 (overnight
  gate run) to all three harnesses in one invocation (`--only <harness>` for a single leg) —
  this MANDATORY blocker cell had only ever run on claude; codex and pi_core were a named gap.
  Verified PASS on all three the same night the harness matrix landed.
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

### The incident checks — born from the free-credits 401 of 2026-08-30

A free-credits user on cloud hit a 401 because a fresh Daytona sandbox's first model call raced
the asynchronous substitution of its Daytona Secret: the provider got the raw `dtn_secret_<id>`
placeholder. The product then blamed the user's own key, which was wrong. The same release fixed a
family of warm-session over-evictions caused by drift between two identity views in the runner.
These four checks make each layer's failure loud instead of silent. Run all four on every gate.

- `resources/matrix_c5_first_call_race.py` — **[mechanical]** the placeholder race, and whether it
  is reported honestly. Mints a new workflow so the sandbox is necessarily cold, sends one short
  message so the first model call lands as early as possible, and asserts the STORED turn row came
  back. PASSes when the turn succeeds or when the failure carries the runner's
  `credential_delivery_failed` code with its retry copy. FAILs when the run advises adding a key
  while the underlying refusal carries the placeholder signature (`Received=dtn_`/`dtn_secret_`) —
  the incident itself. The assertion is deliberately body-INDEPENDENT: only the litellm proxy
  echoes a placeholder, so on a direct provider (where BYO-key cloud users live) an echo test is
  blind, and F6 shipped a user-blaming 401 straight through the first version of this cell. A
  credential refusal on this cell's necessarily-fresh sandbox must never advise adding a key, echo
  or no echo; with PR #6408 the honest classification is `credential_delivery_failed`. Against a
  deployment predating #6408 that assertion fails by construction — pass `--pre-6408` to report it
  as a SKIP naming the known gap instead of an unexplained failure. It also counts `Received=dtn_`
  lines in the credits proxy and reports the
  count as diagnostic, never as a verdict. The proxy is never guessed by name across the box: it
  must be named with `--proxy-container`, or belong to the target stack's compose project
  (`--compose-project`, else derived from whichever container publishes the port in
  `AGENTA_BASE`). With no match it prints "no credits proxy in this deployment; count not
  applicable" and carries on. Reading a foreign project's proxy invents evidence about a
  deployment that was never under test, which is worse than reading none. A run that dies on an
  exhausted provider key SKIPs with "environment: provider key out of credit" rather than
  failing — but only when the stored error carries a credit or billing signature, and never
  when a placeholder refusal is present, because that combination is the incident itself.
- `resources/sweep_disagree.py` — **[mechanism-level invariant; run AFTER a gate session]** greps
  the runner log for `[reconcile] shadow ... DISAGREE ...`, the line `logReconcileShadow` writes
  when the coordinator's `configFingerprint` decision and the router's facet digests disagree.
  That drift is the over-eviction signature and it is invisible from the wire — the turn still
  succeeds, it just paid for a rebuild it did not need — so a log sweep is the only way to catch
  it. `--since <iso-timestamp>` is required; `--container` defaults to autodetecting the local
  stack's runner. Exits 0 PASS, 1 FAIL (printing the offending lines), 2 SKIP when the log is not
  reachable. Three line shapes are excluded as known SHADOW-COMPARATOR gaps (triage 2026-08-31,
  `f7-disagree-triage.md`): the coordinator is correct and pinned, only the shadow's model of it
  disagrees, and the comparator fixes are a post-release follow-up — without the exceptions the
  sweep fails on the runner's own expected behavior on every loaded window. They are never
  silent: each excluded line is printed with its shape and the triage marker, the excluded count
  is reported separately, each shape is anchored on both halves of the line so it cannot swallow
  a real disagreement, and any line matching no shape still FAILS. Delete a shape when its fix
  lands; `--no-exceptions` fails on every DISAGREE line and is how you prove one can go.
- `resources/matrix_h1_bad_harness.py` — **[mechanical]** a malformed harness must fail closed.
  Drives three unreadable `harness` blocks (a wrong-type value, an unknown string, a null kind) at
  both the commit API and the live invoke, and records WHICH boundary refused (`commit_api`,
  `invoke_http`, or `runner_stream`) rather than demanding a particular one — a refusal further
  out is better, not worse. The invariant is that some boundary refuses attributably and no turn
  ever runs on a defaulted harness. FAILs if a turn executes and stores output.
- `resources/check_secrets_teardown.py` — **[mechanical]** a Daytona Secret must not outlive its
  run. Inventories the Daytona organization's Secret NAMES (never values) before a short Daytona
  journey, forces the teardown with a config-change eviction, then asserts every `agenta_*` Secret
  the run created is gone within a bounded settle window. Needs a Daytona API key in the
  environment (`DAYTONA_API_KEY` or `AGENTA_RUNNER_DAYTONA_API_KEY`) and SKIPs with the exact
  reason without one. Run it alone: a concurrent Daytona run against the same organization looks
  the same as a leftover. The listing walks `GET /secret/paginated` by cursor to exhaustion —
  `/secrets` does not exist, plain `/secret` is deprecated and fails above 1500 secrets, and a
  `page` parameter is silently ignored, so anything less than real cursor pagination is noise
  against an organization this size. The settle loop polls `GET /secret/{secretId}` per created
  Secret rather than re-enumerating. `test_check_secrets_teardown_pagination.py` pins the walk.
  A journey that dies on an exhausted provider key never creates a Secret, so it SKIPs with
  "environment: provider key out of credit" instead of failing the teardown path it never
  exercised.
- `qa_matrix_lib.out_of_credit(error_text, codes)` — **[shared classification; no cell of its
  own]** the SKIP reason when a run failed ONLY because the provider key has no credit left, and
  `None` for everything else. An exhausted key is an environment condition: a cell that renders
  it as FAIL spends a reviewer's attention on a topped-up balance, and teaches the reader that
  this cell's FAIL is sometimes noise, which is how a real regression gets waved through later.
  Recognition is narrow in both directions — the `starter_credits_*` codes plus the runner's own
  credits copy and the provider's billing refusal, and deliberately NOT a bare 401, a rate limit,
  or the placeholder refusal. Wired into `matrix_c5_first_call_race.py` and
  `check_secrets_teardown.py`; `test_out_of_credit_skip.py` pins the boundary from both sides.

## Contributing

Before committing any resource script, run the repo-pinned ruff (`uv run --no-sync ruff format`
then `uv run --no-sync ruff check` from the repo root covers it) — not `uvx`, whose pulled
version has different defaults and produces a false block. Unformatted resource files break the
repo-wide format CI job.

When you add a cell, ask whether it is only meaningful for changes in one part of the tree. If it
is, add the rule to `resources/path_triggers.py` in the same change. A cell whose subsystem can be
rewritten without anyone remembering to run it is coverage on paper.

Release-night findings and the full evidence history are archived in
`docs/design/agent-workflows/projects/qa/` (STATUS.md, findings.md, matrix.md).
