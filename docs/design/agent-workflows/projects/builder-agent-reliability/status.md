# Status

## 2026-06-30

Project created. Context captured from Mahmoud's description of one informal live session
testing the shipped build kit against a worked example (twice-daily repo-changes digest ->
Slack report). See `context.md` for the full writeup, the worked example, and the open
questions.

Not yet done:

- Reproduce the session as a real, citable transcript (or a fresh one against the same prompt).
- Turn the observation ("confused", "doesn't take the easy path") into named, specific failure
  points against the intended step list in `context.md`.

## 2026-06-30 (later)

Mahmoud reframed the goal: this is an optimization loop, not a one-off fix. Run a real agent
against a use case through Agenta's API, read its trace, refactor the kit (tools, scripts,
instructions) to cut steps and wrong turns, re-run, and repeat across 6-8 use cases. Methodology
written up in `plan.md`.

Blocked on his answers to: which use case starts the loop, which environment/project/API key to
run against, which connections already exist there, and how kit changes should land (committed
per round vs. batched for review). Asked in chat; not yet answered.

## 2026-06-30 (correction)

Mahmoud corrected a key assumption: the builder under test is **my own Claude Code subagent**,
working in an isolated local lab folder against Agenta's real API, not the shipped product
agent running inside Agenta's own chat runtime. Also: **no backend/SDK code changes during the
loop** — `op_catalog.py`/`agenta_builtins.py` stay untouched until a winning configuration is
found; everything iterates as lab-folder scripts and instructions until then.

He also gave the full set of 8 use cases (now in `use-cases.md`) and several standing rules
(always test before declaring done, save artifacts, give the config schema up front, hint
internal capabilities rather than testing cold discovery). `plan.md` rewritten to match.

Use case 1 (text summarizer) needs no connections — just any OSS project and an API key.
Still blocked on: which local stack/project to run it against (a port number got garbled in
dictation; asked Mahmoud to confirm) and that API key.

## 2026-06-30 (round 1 launched)

Mahmoud gave a live cloud project instead: `bighetzner.agenta.dev`, with an API key, workspace
id, and project id, plus a fixed requirement for round 1: Claude harness, self-managed key,
Sonnet model.

- Credentials saved to `/home/mahmoud/code/agent-creation-lab/.env` (mode 600), outside the
  `agenta` repo so a lab subagent's working directory doesn't pick up this repo's
  `AGENTS.md`/`CLAUDE.md`. Verified the key against `GET /api/profile` (200) before using it.
- Pulled the live schema grounding for the "give the config schema up front" standing rule
  directly from the running stack: `GET /api/workflows/catalog/templates/agent` (a concrete
  valid default `parameters.agent`), `GET /api/workflows/catalog/types/agent-template` (the
  full JSON Schema), and `GET /api/workflows/catalog/harnesses/claude` (confirms Claude's model
  selection is alias-based: `sonnet`/`opus`/`haiku`/`default`, and that `self_managed` is a
  valid connection mode). Folded the worked example into the round's instructions.
- Wrote `/home/mahmoud/code/agent-creation-lab/round-1-summarizer/instructions.md`: the goal,
  the fixed harness/model/auth requirement, the credential-loading steps, the schema grounding,
  what "done" means (created, committed, **tested for real**, artifact ids saved), and the
  standing rules from `plan.md`.
- Launched the round-1 subagent (a fresh Claude Code subagent, no inherited context) against
  that instruction file, explicitly told not to read this repo's `AGENTS.md`/`CLAUDE.md` or
  anything outside the lab folder. Running in the background; not yet returned.

Next: read its `result.md`, independently verify the created agent against the live API myself
(don't just take the subagent's word), then diagnose and decide what round 2 needs.

## 2026-06-30 (attempt 1 done, lab restructured, attempt 2 in flight)

Attempt 1 finished: PASS, but expensive (62 tool calls, 143k tokens, ~10 min). Independently
re-verified the application, its committed config, and the test claim — all checked out. The
real cost was testing, not building: the agent microservice's invoke contract isn't documented
in `/api/openapi.json` (confirmed: no live OpenAPI on the service either), every wrong request
body silently fell back to the service default instead of erroring, and the subagent eventually
found the real contract by reading the public docs site. It also surfaced a real open finding:
reference-only invocation never loads the committed config on this deployment; only inlining the
full config on every call works. Full account in
`agent-creation-lab/experiments/01-text-summarizer/attempt-1/result.md`.

Mahmoud flagged two things live: the public docs site is currently unreliable (don't send
subagents there), and to checkpoint a subagent's plan before it acts so he can correct course
mid-round rather than only after. Acted on both:

- Restructured the lab: `experiments/NN-name/attempt-M/` per use case/attempt,
  `verified-facts.md` as my cumulative ground-truth copy, `report.md` as a living scientific
  report, `README.md` as the lab's own index. Migrated attempt 1 in. Cleaned up scratch files
  from my own API exploration; confirmed the live project holds no stray duplicate apps.
- Folded everything attempt 1 paid to learn (the schema, the proven invoke contract, the
  reference-only gap, the docs-distrust rule) into `verified-facts.md` and from there into
  attempt 2's instructions, copied in full so the folder stays self-contained.
- Launched attempt 2 as a checkpoint: phase 1 (plan only, no mutating calls) is running now;
  phase 2 (execute) waits for review of the plan before it proceeds.
- `plan.md` (this project) now carries both as standing rules, plus a "Lab structure" section
  describing the new layout, so the methodology doc stays in sync with what the lab actually is.

Next: review attempt 2's plan when it lands, correct or approve it, let it execute, then compare
its cost against attempt 1's to see whether the fix actually worked.

## 2026-06-30 (experiment 01 complete)

Reviewed attempt 2's phase-1 plan (clean: 3 core calls + 2 safety checks), approved it with two
small corrections (use a distinct app slug so it doesn't collide with attempt 1's; gave the
"confirmed correct" test bar since none was specified), and let phase 2 run.

**Result, independently re-verified:** PASS. 38 tool calls vs. attempt 1's 62 (-39%), ~4.9 min vs.
~10 min (-51%), tokens roughly flat (+5%, 150,524 vs 143,235). The invoke-contract detour that
dominated attempt 1 is fully gone. The token wash is not waste: attempt 2 hit a real, independently
confirmed finding attempt 1's test phrasing happened to miss — a committed `agents_md` saying "no
questions back, no extra commentary" did not stop the `claude` harness from responding to a bare
pasted paragraph as a coding-CLI assistant ("a coding task, question, or something else?") instead
of summarizing it. Confirmed via trace it wasn't a misconfiguration; confirmed by retry it wasn't a
fluke; fixed by reframing the test input as an explicit instruction. Recorded in
`agent-creation-lab/verified-facts.md` since it likely matters for every future `claude`-harness
use case, not just this one. Full comparison and analysis in `agent-creation-lab/report.md`.

Both apps (`round-1-summarizer`, `round-1-summarizer-attempt-2`) are left live intentionally as
the experiment record, not yet cleaned up.

Experiment 01 is done. Next: decide whether to start use case 2 (style/writing editor) now, or
have Mahmoud weigh in on the persona-override finding first, since it could change how every
later use case's `agents_md` should be written and tested.

## 2026-06-30 (floor check)

Mahmoud pushed back on attempt 2's cost: 5 minutes for a near-trivial case seemed off. Right
call — I ran the literal minimum sequence myself, directly, not through a subagent: create+
commit (1 call), invoke with the known-good test framing (1 call), verify the trace (1 call).
**3 calls, 11.2 seconds.** Confirmed correct.

So the gap between attempt 2 (38 calls, ~5 min) and the real floor (3 calls, 11s) is almost
entirely this lab's own process overhead, not the product: the plan-then-execute checkpoint was
the wrong call for a use case that's already the defined trivial case (`plan.md`'s own rule says
checkpoint *past* the trivial case — mis-applied, not a rule problem), phase 1 re-verified
already-settled facts instead of trusting them, and some of the 5 minutes is an LLM subagent
genuinely reasoning through and documenting ~38 tool-call turns, not waiting on the API. Archived
the throwaway floor-check app afterward (`POST /simple/applications/{id}/archive`); the two
named-attempt apps stay for comparison. Full account in `agent-creation-lab/report.md`.

Correction for every later use case: checkpoint only where there's real ambiguity or risk, not
by default. A well-understood, trivial case should run straight through on known-good facts.

## 2026-06-30 → 07-01 (overnight: general kit built and validated)

Mahmoud went to sleep and asked for an autonomous run: build the instructions/tools/config that
let a Sonnet agent solve all the cases, optimize hard for speed, reflect and improve after each
run, and have a summary ready in the morning. He connected GitHub + Slack to the live project and
asked for one more connection-using case. Full record in the lab (`agent-creation-lab/report.md`,
`verified-facts.md`, `experiments/*/result.md`); judgment calls in this project's `build-notes.md`.

What got done:

- **Reframed to one general kit** (`agent-creation-lab/kit/`): a single ordered playbook
  (`BUILD-AGENT.md`) plus 12 shell scripts wrapping the real platform-op endpoints. This replaces
  night 1's per-case instruction files and is what ports back into `agenta_builtins.py` /
  `op_catalog.py`. Read the live `op_catalog.py` + `agenta_builtins.py` first to ground the
  scripts in the actual endpoints and to improve on the four shipped skills (whose split-across-
  files structure is a prime suspect for the live agent wandering).
- **Established the floor for all nine cases myself** against the live API, then **validated the
  kit with fresh Sonnet subagents**. Headline: the summarizer that took 62 / 38 calls and 10 / 5
  minutes before now takes a Sonnet subagent **1 API call and 50 seconds**. GitHub lookup: 2
  calls / 56s, real username via the tool. Missing-connection (Notion): 1 call / 43s, correctly
  stopped and built nothing. Style editor: the optimization loop closed in front of us — run 1
  cost 10 calls because the playbook lacked the inline-skill schema; I added it; run 2 dropped to
  one `build.sh` call / 65s with "no guessing".
- **Capstone (the original GitHub→Slack digest)** proven end to end by direct test: the agent
  wires 4 gateway tools, fetches GitHub activity, and posts to Slack (`SEND_MESSAGE` → `ok:true`),
  and a twice-daily UTC schedule creates/verifies cleanly. Subagent validation run measured
  separately.
- **Findings to carry** (all in the lab report): gateway tools and inline skills both work under
  the claude harness; multi-tool runs return an unreliable invoke OUTPUT even when every tool
  succeeded (no max-turns knob — verify via spans, kit ships `check-tools.sh`); `find_capabilities`
  discovery is approximate (commits→GraphQL, discussions→issues); trace annotation has no
  agent-facing tool (gap to port for case 3); Telegram isn't connected and has no real trigger
  here, so case 8's correct outcome is "explain BotFather + stop".
- **No backend/SDK changes**, per the standing constraint. Porting recommendations written down.

## 2026-07-01 (isolated test of the SHIPPED skill)

Tested the shipped skill (`agenta-skills/skills/build-agent/`, draft PR #1) in faithful isolation
— per use case: its own folder outside the agenta repo, a copy of the skill, the creds, and a
fresh Sonnet subagent told to read ONLY the skill. Ran UC1 (summarizer), UC4 (GitHub username),
UC6 (Notion stop-and-ask), and UC9 (the capstone digest). Re-verified every subagent claim against
the live API. Full writeup: `skill-isolated-test-2026-07-01.md`.

Results: the simple cases work (UC6 correct stop in 3 calls; UC4 built+tested in ~87s; UC1 one
`build.sh` call after the fix below). The capstone does NOT work reliably today, and the reason is
a platform bug, not the skill.

Found and FIXED in the shipped skill (working tree, not yet committed):

- **`test-agent.sh` died silently on any zero-tool-call run** (the flagship no-tools case):
  `grep -c .` exits 1 on no matches and `set -e` killed the script before printing anything.
  Guarded with `|| true`. Same bug in the lab kit's `test-agent.sh` (ports to `agenta_builtins.py`)
  — fixed there too.
- **`check-tools.sh` reported PASS on the capstone's undelivered Slack write.** Its `ok:true` grep
  never matched the real span payload, and it keyed only on the tool NAME. Rewrote it to verdict on
  result presence (`attributes.output.value`): PASS / UNCONFIRMED (dispatched, no result =
  stalled approval) / FAILED / INCOMPLETE. Corrected the SKILL.md Verify claim it disproved.
- A real env slug `github-08f` was hardcoded in two reference docs (live discovery resolves
  `github-fa1`) → placeholder + multi-connection guidance. Discovery headline `READY: true` can
  point at the wrong integration → strengthened the "discovery is a search" rule (CONNECTIONS block
  is authoritative). Big list payloads (`LIST_ALL_CHANNELS` ~200KB) derail the run into code tools
  → added narrow-tool guidance. Two shipped scripts referenced lab-only files → repointed.

Load-bearing finding (report only, NOT baked into the public skill): **`instructions.agents_md` is
ignored on the claude harness** — confirmed with four direct probes (BananaBot, pirate, [EOF] tag,
the capstone channel). The model runs as a default coding-assistant driven only by the invoke
message. This is the known `AGENTS.md`→`CLAUDE.md` runner bug (fix in flight, PRs #5000/#5007),
confirmed still live on bighetzner. It undermines the skill's premise and is the same bug behind
the original digest fumble. Recommend prioritizing the platform fix; the skill can't fully
compensate. Proposed (not done): `update-agent.sh` re-commit script; document `create-schedule`
`inputs_json` shape; TZ worked example; create-order note.

All live resources cleaned up (6 apps archived, capstone schedule removed); no schedule spams Slack.
