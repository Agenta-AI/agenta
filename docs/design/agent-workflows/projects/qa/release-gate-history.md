# Agent release gate history

This file holds the dated incidents, version facts, verification logs and pass rates that used to live in
`.agents/skills/agent-release-gate/SKILL.md` and its `resources/LESSONS.md`. The skill keeps the durable
rule from each block. The text below is kept word for word as it was in the skill, so the session ids,
versions and dates still match the run records in this folder.

## Env file fallback ran a staging gate against the wrong deployment (2026-08-28)

**EXPORT the three variables, do not just set them.** The driver falls back to an env FILE when
`AGENTA_*` is absent from its environment, which is helpful interactively and dangerous in a
release run: a credentials file of bare `KEY=value` lines sourced with `. file` sets the shell
only, the child `uv run` process inherits nothing, and the driver silently runs the whole gate
against WHATEVER DEPLOYMENT the fallback file names. The failure surfaces as `401 Invalid
credentials` from a stage whose key you just watched answer 200, or worse as a green run
recorded against the wrong stack. Use `set -a` around the source, or `export` each variable,
and confirm the stage in the results before trusting them. (Cost a staging gate run on
2026-08-28; the fallback degrades to "wrong deployment", never to "no credentials".)

## Runner replace hook without an explicit start (2026-09-10)

This is not theoretical. A hook without the explicit start left the runner down for about seven
minutes mid-gate on 2026-09-10, and every cell after it failed for a reason that had nothing to
do with what it was testing. With the start and the health wait, later cold2 and hook cells
restored the runner in about forty seconds each. The same rule governs the session-control hook
cells, and `DockerComposeHooks.kill_runner` already implements it as `compose restart -t 0`
rather than a bare kill, with `ensure_runner_healthy` in a `finally` as the backstop.

## `stop-approval` and the missing `Idempotency-Key` (v0.117.0)

**`stop-approval` sends an `Idempotency-Key`, and it has to (fixed after the v0.117.0 run).** The
cell answers an approval after a Stop and asserts the answer is refused with a 409. The durable
approval path validates the `Idempotency-Key` header BEFORE it decides whether the execution is
still continuable, so an answer without that header comes back 422 and can never reach the 409.
A real browser always sends one, so nothing user-facing was ever affected — but for one release
this read as a product FAIL on a stage where the product was fine, and clearing it cost a
hand-run diagnostic. The cell now sends a stable key derived from the interaction id, a 422 there
names the missing header in its own failure line, and two tests in `test_session_control.py` pin
both halves. The general lesson is wider than this cell: when a gate asserts a specific status
code on a durable endpoint, send the headers the browser sends, or the assertion measures the
validation layer instead of the behavior.

## Preview stage facts measured on v0.117.0

### Running the gate against a preview stage

The cells were written on a dev box, where the operator's own Claude and Codex logins are mounted
and the local sandbox is free. A cloud stage is neither of those things, and the mismatch does not
announce itself as an environment problem — it arrives as a red cell that reads like a release
regression. Three facts, all measured on the v0.117.0 preview stages, settle most of it.

**Each stage runs exactly one kind of sandbox, and they are opposites.** oss.preview is
local-sandbox-only by design, the OSS default posture, and refuses Daytona. Staging is the mirror
image: it refuses the LOCAL sandbox with a 403 naming
`AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS`. So no local-sandbox cell can run on staging at all, and
no Daytona cell can run on oss.preview. For the hosted-subscription pair that means H1, which is
local, can only run on oss.preview, and H2, which is Daytona, can only run on staging. The reverse
pairing cannot be made to work by fixing anything.

**Pre-flight Daytona with one cheap sandbox create before planning around it.** The organization's
availability changes with its credit balance, and a suspended organization 403s at sandbox create,
which looks nothing like the cell's subject. One probe cell answers the question for the whole run.

**The managed provider keys on a stage may be out of credit.** Both stages' vault Anthropic and
OpenAI keys were exhausted during the v0.117.0 run, so every managed-key cell was blocked on
billing rather than on the product, and the Claude legs of several scripts could not run at all.
The funded path on those stages was the custom OpenAI-compatible connection fronting OpenRouter.
Check the vault before scheduling cells around it, and read an exhausted-key red as blocked
coverage, never as a pass and never as a regression.

## Runner `/run` contract changes in v0.117.0

### Calling the runner's `/run` directly

Most cells drive the product endpoint, which is the point. A few diagnostics post to the runner's
own `/run`, and that contract moved in v0.117.0:

- The runner requires a shared token, sent as an `X-Agenta-Runner-Token` header and matching the
  stack's `AGENTA_RUNNER_TOKEN`. Without it the container refuses to start at all.
- A top-level `credentialMode` is rejected outright with "Legacy top-level model credential fields
  are not supported". The credential now rides a `modelConnection` object carrying `provider`,
  `deployment`, `credentialMode` and `credentials`.
- A single fresh user message is the last-message-only shape, so the runner tries to rebuild the
  conversation from the durable record log and fails with "record log is unreadable". Send a short
  multi-turn history instead. This bites direct callers only; the product endpoint carries the
  transcript itself.
- `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini` and `gpt-5.3-codex-spark` are refused by ChatGPT accounts
  ("not supported when using Codex with a ChatGPT account"). Use `gpt-5.6-luna` for subscription
  cells.
- The runner's health endpoint advertises `pi_core` and `claude` only. `codex` dispatches and
  answers normally; the list is a stale hardcoded constant. No cell should gate on it.

## `matrix_w5.py`: the steer bug it caught

- `resources/matrix_w5.py` — **[coached]** interrupt a running turn (steer) then use the session
  again. Caught a real bug: the durable mount never gets re-established after a steer, breaking
  every subsequent turn on that session. Distinct from Mahmoud's own steer repro (that one is a
  turn-currency/heartbeat bug; this is a mount-lifecycle bug) — keep the two separate when
  triaging.

## `matrix_w7.py`: the `authorization_missing` bug

- `resources/matrix_w7.py` — **[coached]** an agent writes a workspace file and commits it via an
  `@ag.file` marker; asserts the approval manifest carries digest+bytes and the commit lands with
  the exact bytes. Caught a real bug (fixed, PR #5763-adjacent runner fix): the gate approved
  cleanly but execution always refused with `authorization_missing` — no file-marker commit could
  land. Re-verified PASS after the fix. Note: `DEFERRED_NOT_EXECUTED` on a queued second tool
  call is benign (another gate is already pending), not a real tool error — don't let it fail
  this cell. Naming `@ag.file` verbatim in the prompt is correct for this cell's backend-path
  purpose but means it cannot catch a model failing to find the marker syntax unprompted — see
  Tiers above.

## `matrix_t8_saved_files.py`: verification after the tunnel-seat fix (2026-08-06)

- `resources/matrix_t8_saved_files.py` — **[coached]** T8: the Daytona remote agent mount (the
  durable `agent-files/` folder the playground file drawer writes into), which needs the ngrok
  tunnel the runner discovers at sandbox-acquire time. Writes a marker file into the mount via
  the mounts API (`POST /mounts/agents/sign` + `PUT /mounts/{id}/files`) before the run, then
  asserts the runner log line `remote agent mount active for artifact=<id>` appears, a tool
  output actually carries the real marker content (not hallucinated), and the commit lands with
  it. Verified PASS 3/3 runs after the tunnel-seat fix (2026-08-06); this line was absent on
  every attempt before that fix landed.

## `matrix_w7_per_harness.py`: the Codex approve-then-fail P0 and its verification (2026-08-06)

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

## `matrix_w7_daytona.py`: the NUL byte bug (2026-08-06)

- `resources/matrix_w7_daytona.py` — **[coached]** matrix_w7.py's exact scenario with
  `sandbox=daytona` instead of local. The local-only original W7 is exactly why this bug hid: the
  Daytona transport rejects NUL bytes in argv, which the `@ag.file` manifest walk was emitting, so
  no workspace-file commit could EVER land on Daytona, on any harness, until the 2026-08-06 fix
  (found during the same P0 triage, live-verified twice on codex+Daytona: sessions f3fa4335,
  f2f22056). This cell is the sandbox-axis regression guard, staying on the claude harness. Needs
  the same funded Anthropic vault key as `matrix_w1_daytona.py`. Verified PASS (2026-08-06).

## `matrix_invariant_commit_auth_refusal.py`: the replay that did not reproduce (2026-08-06)

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

## `matrix_g1_guidance_discovery.py`: origin and pass rates (2026-08-06)

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

## `matrix_b1_builtin_find.py`: the Pi `find` discrepancy (2026-08-07)

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

## `matrix_l1_lifecycle_routes.py`: the pi_core model case (2026-08-29)

- `resources/matrix_l1_lifecycle_routes.py` — **MANDATORY. [mechanism-blind]** the routing matrix
  itself: for each kind of mid-conversation config change, assert the route the runner took. One
  sandbox id = applied in place, two = rebuilt. Blocks on six cases: no change must stay warm; an
  instructions edit, a permissions edit and a tool-catalog edit must escalate; and a
  same-connection model switch must stay warm on BOTH claude and pi_core. The pi_core model case
  (added 2026-08-29) is the standing trap for the wire-spelling bug class: the router once keyed
  its table on the bare "pi" literal while the wire carries "pi_core", every playground model
  switch silently rebuilt, and the claude-only case could not see it (#6364). This is the cell
  that would have caught the `cold1` rot described below.

## `matrix_l5_live_route_observed.py`: failure, fix and harness extension (2026-08-06)

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

## `matrix_l4_client_tool_lifecycle.py`: stage runs (v0.117.0)

- `resources/matrix_l4_client_tool_lifecycle.py` — **nice-to-have. [coached]** the client-tool
  round trip, and the only cell that covers client tools at all. Asserts the browser's result
  reaches the model and the `client_tool` interaction is stored. It RECORDS rather than asserts
  the sandbox count, which is two today: a client-tool pause is deliberately not parkable
  (`"warm-hold": RESERVED, not built`, #5384), so every client-tool round trip currently costs a
  rebuild. If that number ever reads one, the warm hold landed and the docstring needs updating.
  It builds its config through `agent_config`, so the `AGENTA_QA_*` variables point it at a
  cloud stage; it passed on pi_core over Daytona on staging and over the local sandbox on
  oss.preview during the v0.117.0 run, and two sandboxes per round trip is still what it records.

## `matrix_n1_session_context.py`: why it exists (#6661, v0.115.3)

- `resources/matrix_n1_session_context.py` — **MANDATORY. [journey, with two controls]** the
  per-turn session facts on the path the PRODUCT uses. Renames a session between two turns and
  asks the agent for the name, asks the agent for its own display name, and posts a forged
  `meta.session_context` that the service must ignore. Every expected value carries a random
  token minted for the run and spoken nowhere in the conversation, so a transcript-derived
  answer cannot match; the second ask is the exact shape of #6661, because by then the FIRST
  name is in the transcript and the current one is only in the stored header. This is the one
  cell that asserts on model prose, and it does so because nothing else can: `turnContext` is a
  prompt string on the service-to-runner payload, the runner logs nothing, and it is
  deliberately kept out of `request.messages` and out of persisted input. Two controls keep a
  FAIL honest — an echo probe (a model that cannot repeat a literal token makes the cell report
  INCONCLUSIVE) and a read-back of the stored header after every rename. Mandatory (via
  `path_triggers.py`) when the SDK session-context module, the platform-prompt renderer, the
  agent handler, or the API's session-context resolver changes. **The gate could not see this
  class at all before v0.115.3**: #6661 shipped green because the API stamped the facts in its
  invoke prelude, which never runs for a playground turn, and no cell renamed a session
  mid-conversation or asserted on the facts.

## Lifecycle findings: the `workspaceFiles` live route, `cold1`, and the stale-approval gap (2026-08-06)

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

## LESSONS: two Daytona-era traps for the lifecycle (L*) cases (2026-08-31)

### Two Daytona-era traps for the lifecycle (L*) cases — 2026-08-31

**Fixture connections must be vault-backed.** A fixture built by copying the Claude defaults and
changing only the harness keeps `llm.connection = {"mode":"self_managed","slug":null}`. A
self_managed Pi run needs the `PI_CODING_AGENT_DIR` mount, which a gate deployment does not have,
so turn 1 errors and the case fails before it tests anything. Set
`llm.connection = {"mode":"agenta","slug":null}` on every non-default-harness fixture (caught on
#6371; the Pi fixtures in `matrix_l5_live_route_observed.py` and `bench_lib.py` already do this).

**A stuck-substitution rebuild is not an eviction.** Since the credential preflight (#6370), a
fresh Daytona sandbox whose Secret wiring failed (a vendor-side per-sandbox fault, a few percent
of creates) is convicted at ~10s and rebuilt ONCE. A warm-reuse case that counts sandbox ids can
therefore see two ids without any lifecycle regression. Before ruling a warm case failed, grep
the runner log for `[credential-preflight] STUCK`: if it fired inside the run, re-run the case
instead of reporting the eviction.

## LESSONS: the placeholder 401 incident (2026-08-31)

### On a placeholder 401, read the proxy log before you blame a key — 2026-08-31

A free-credits user on cloud hit a 401 on their first message. The product told them to add the
project's OpenAI key. That advice was wrong three ways: their key was fine, adding one would not
have helped, and the run was retryable. The real cause was the first-call race. On a Daytona run
the real key never enters the sandbox — it is a Daytona Secret, and the sandbox holds a
`dtn_secret_<id>` placeholder that Daytona substitutes into egress asynchronously, with no
confirmation signal, 10-24s after the Secret is created. A cold sandbox whose FIRST model call
beats that propagation sends the raw placeholder, and the provider refuses it with a 401.

**The rule.** A 401 from a Daytona run is not evidence about the user's key until you have read
the litellm-proxy log. Grep it for `Received=dtn_`. If the line is there, the key was never the
problem and no key change will fix it: the run needed a retry.

**An ABSENT marker proves nothing.** The marker is one-directional evidence — present, it
confirms a placeholder refusal; absent, it is silence, and silence has many causes. A direct
provider never emits it at all (`api.anthropic.com` answers "Invalid bearer token" and echoes
nothing), a remote deployment has no reachable proxy log, and incomplete log access looks
identical to a clean window. Reading an empty grep as "so it really was the user's key" is how F6
survived a whole release. When the marker is absent, judge on the other evidence instead: the
stored error's CODE (`credential_delivery_failed` is the runner's own verdict and outranks any
grep), whether the sandbox was freshly created, and whether the copy contradicts itself by
advising a key change on a run whose key was delivered seconds earlier. The runner classifies
this correctly as `credential_delivery_failed`
(see `PLACEHOLDER_CREDENTIAL` in `services/runner/src/engines/sandbox_agent/errors.ts`), so a
run that reports an add-a-key message over a placeholder refusal is a product bug, not a user
error. The related trap already recorded above still holds: a stuck-substitution rebuild is not an
eviction, so grep `[credential-preflight] STUCK` before calling a warm case failed.

Four standing checks came out of this incident. Run all four on every gate; each one is described
in full in the skill's resource inventory.

1. `matrix_c5_first_call_race.py` — forces a cold Daytona sandbox and sends one message
   immediately, so the first model call lands as early as it can. FAILs when a placeholder refusal
   is reported as the user's key problem.
2. `sweep_disagree.py` — run AFTER a gate session. Greps the runner log for
   `[reconcile] shadow ... DISAGREE ...`, the over-eviction signature that never shows on the wire.
3. `matrix_h1_bad_harness.py` — a malformed harness must be refused at some boundary and must
   never run as a silent defaulted turn.
4. `check_secrets_teardown.py` — a Daytona Secret must not outlive its run. Names only, never
   values.

## LESSONS: two traps the incident checks hit on their first live run (2026-08-31)

### Two traps the incident checks hit on their first live run — 2026-08-31

**The Daytona Secrets API is singular, paginated, and lies about `page`.** `/secrets` does not
exist; it 404s with "Cannot GET". The real paths are `/secret`, `/secret/paginated` and
`/secret/{secretId}` (verified against `@daytona/api-client@0.198.0` inside the runner). Plain
`/secret` is deprecated and, per the client's own docs, "fails for organizations with more than
1500 secrets" — and the org holds ~3510, so it is unusable. The paginated listing returns 100 per
response and a `page` parameter is SILENTLY IGNORED: the same 100 ids come back every time, which
makes a page-based walk loop forever on identical data while looking like progress. Follow
`nextCursor` to exhaustion, refuse a cursor that repeats, and bound the walk. A useful side
effect: because `/secret` and `/secret/paginated` return 403 for an under-scoped key while
`/secrets` returns 404, you can confirm the right path without any list access at all.

**Never pick a container by name match on a shared box.** `matrix_c5` originally took the first
`docker ps` name containing "litellm" and found `starter-litellm-proxy` — a different project's
container — while the stack under test had no proxy at all. A foreign container's log is worse
than no log: it invents evidence about a deployment that was never under test. Resolve a
container by its `com.docker.compose.project` label against the target stack's project (derive
the project from whichever container publishes the port in `AGENTA_BASE`), or take it explicitly.
When nothing matches, say so and continue.

## LESSONS: standing reds and finding SF2 (v0.114.4)

### Standing reds: expected, named, never softened

A check that goes red for a filed finding stays red — softening it would hide the next real
break behind the same shape. What it gets instead is a NAME in its failure message, so a reader
scanning a gate report recognizes it in one line instead of chasing it as fresh breakage. This is
how the W5 steer red is handled, and it now applies to one more:

- **`matrix_h1_bad_harness.py`, the `null_kind` case — finding SF2.** A cleared harness
  (`{"kind": null}`) is not rejected: it silently defaults to `pi_core`, so on any config whose
  model spelling suits Pi the turn runs and the cell correctly fails. Filed for the next release,
  not fixed in v0.114.4. The failure message says so. When SF2 is fixed the case turns green on
  its own and the `known_finding` key stops appearing — that is the signal to delete the note.
  A wrong-type or unknown-string harness that runs is a DIFFERENT, unfiled defect and is
  deliberately not covered by the name.
