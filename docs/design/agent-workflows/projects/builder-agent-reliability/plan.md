# Plan: optimize the build kit against real use cases

## The reframe

The build kit was a proof of concept. It showed that a platform-tool layer can scale: an agent
can use Agenta's own API to build itself. That part is proven. The open question is no longer
"can this work" but "how few tools, steps, tokens, and seconds does it take." This project runs
an optimization loop: take a use case, watch a builder try to solve it against Agenta's real
API, cut what was wasteful, fix what confused it, and try again until the easy path is the only
path it takes. Only once a configuration works well does any of it become a real platform tool.

## The deliverable is one general kit (night-2 reframe, 2026-06-30)

The goal is **one configuration that lets a Sonnet agent solve every use case**, not a separate
instruction file per case. That configuration is the **kit** at `agent-creation-lab/kit/`: a
single ordered playbook (`BUILD-AGENT.md`) plus shell scripts (`kit/scripts/`) that wrap the real
platform-op endpoints. A use case is then "give the subagent the kit + a one-line request" and
measure. The kit stays general; only it improves between rounds. This matches the eventual payoff
— porting the kit's playbook into `agenta_builtins.py` skills and its consolidated scripts into
`op_catalog.py` ops — because those are general, not per-use-case.

The method each round: (1) solve the case myself directly against the live API to find the real
floor (calls, seconds) and the exact known-good path; (2) bake that path into the kit; (3) run a
fresh Sonnet subagent on the kit to prove it makes the case easy; (4) read its short bullet
report, verify independently (trace + spans), fold any friction back into the kit, re-run if it
helps. Solving it myself first de-risks ("if I can't, the subagent can't") and keeps each subagent
run short and scrutable.

**Speed is the headline metric.** The original complaint was a 3-second task taking 5 minutes. The
kit collapses the API plumbing into scripts so a trivial agent is two actions (write config, run
`build.sh`). Every round tracks calls/tokens/seconds, and a subagent must return a 30-second
bullet summary so a bad path gets caught early instead of after ten minutes.

## Who does the building (corrected 2026-06-30)

The builder under test is **my own subagent** (a Claude Code Agent-tool subagent), not the
shipped Claude/Pi builder-agent running inside Agenta's own runtime. We are not testing an agent
within an agent; we are using a coding subagent, the same kind of thing I am, as a fast,
controllable proxy for "an LLM that has to use Agenta's API to build an agent." That subagent:

- gets an Agenta API key and works against Agenta's real HTTP API, not the playground UI;
- works inside one **lab folder**, given an instruction file and whatever shell-script tools the
  round provides, and is told explicitly not to read anything outside that folder;
- is, where practical, run from a working directory **outside this git repository**, so it does
  not auto-load `agenta`'s own `AGENTS.md`/`CLAUDE.md` and end up with engineering context a real
  target agent would never have. (Caveat: a Task/Agent subagent launched from inside this session
  may still inherit this session's project context at the harness level; if a trace shows that
  leaking through, the clean fix is a separate Claude Code session rooted at the lab folder,
  started by hand outside this conversation.)
- must always **test what it built before declaring done** — run it, check the result, then
  report. A claim of success with no check behind it does not count as a finished round.
- **saves its artifacts**: the agent/variant/revision ids it created, so later rounds (and me)
  can inspect or compare a result without rebuilding it.

## What does not change during a round

**No backend or SDK code changes while we are iterating.** `op_catalog.py` and
`agenta_builtins.py` stay untouched through the whole experimentation phase. Whatever a round
needs — a consolidated multi-step script, a clarifying instruction, a schema cheat-sheet — lives
in the lab folder as a script or a paragraph of instruction text, never as a platform-tool
change. Only after a configuration of instructions, scripts, and tool list makes a use case
*easy* do we port that configuration into real platform tools, real skills, and the real catalog.
That porting step is the project's payoff, not a per-round habit.

## The loop

Run this loop once per use case, repeating until the round stops improving anything.

1. **Brief.** Write or update the lab folder's instruction file for this use case: the goal, the
   API key and project to use, any schema guidance or tool hints we already know are needed (see
   "Standing rules" below), and the shell-script tools available so far.
2. **Run.** Spin the subagent on that lab folder. Let it work until it claims the use case is
   done and tested.
3. **Capture.** Read what it actually did: the sequence of API/tool calls, the arguments, the
   results, and (where the stack exposes it) tokens and time per step.
4. **Verify, independently.** Don't take the subagent's word for it. Check the artifact it
   produced against what the use case asked for — the right tools attached, the right schedule
   or instructions, the right report style. Write this check once per use-case shape and reuse it
   on every later round of that shape.
5. **Diagnose.** Compare the trace to the use case's intended path. Name what went wrong: a wrong
   turn, a sequence of calls one new script could collapse into one, a missing piece of context
   that caused the wrong turn, or friction in the API itself worth documenting around.
6. **Refactor the lab, not the product.** Update the instruction file or add/change a shell
   script to fix what step 5 found.
7. **Re-run.** Same use case, same prompt, against the updated lab folder. Compare the new run to
   the old one. Keep iterating while a round still improves something; stop when one doesn't.
8. **Record.** Log what changed and why in this project's build notes, so the next use case
   starts from what this one already learned.

## Standing rules (apply to every use case, not just one)

These came out of Mahmoud's own experience hitting the API by hand, so they go into the lab
instruction file from round one rather than waiting to be rediscovered:

- **Always test before declaring done.** No round ends on an untested claim.
- **Save the artifact.** Every round records the agent/variant/revision id it produced.
- **Give the config schema up front.** Getting the agent-config shape (`parameters.agent`,
  tools, instructions) right by trial and error has reliably failed in manual testing. The lab
  instructions should hand the subagent a correct schema reference rather than let it guess.
- **Hint, don't bootstrap from zero.** Where a use case depends on the subagent discovering an
  internal capability (for example, that there's a tool for annotating its own traces), the
  instruction file says so directly. We are optimizing from a reasonable starting instruction,
  not testing cold discovery.
- **The lab's own tooling stays out of Agenta's skill system.** The experimenter subagent gets
  everything inline, in its instruction file and scripts — it does not use Agenta `SkillConfig`
  workflows itself. Agenta skills only get created where a *use case itself* calls for one (see
  use case 2): that skill belongs to the agent under construction, not to the experimenter.
- **Trust the live API over the public docs site.** `agenta.ai/docs` is known to be stale right
  now (confirmed 2026-06-30, experiment 01 attempt 1). Instructions tell every subagent to use
  `GET {host}/api/openapi.json` and the live `workflows/catalog/*` endpoints, and to treat an
  outright gap in live documentation as a finding to report rather than a reason to reach for
  the public docs. Anything learned from a live discovery gets folded into
  `agent-creation-lab/verified-facts.md` immediately, so the next attempt starts from it instead
  of re-paying the same discovery cost.
- **Checkpoint past the trivial case.** A round that's more than "create, commit, test" runs as
  plan-then-execute: the subagent writes a plan and stops before any mutating call, I review it,
  and only then does it proceed. A literal sub-minute interrupt on a running agent isn't
  something this tooling supports; a reviewed checkpoint between planning and acting is the
  honest equivalent, and it catches a bad path before it costs 60 calls instead of after.
- **Make the subagent report a 30-second bullet summary.** Every subagent run ends with a short
  bullet report — what it built, the artifact ids, what it tested, the result, the honest call
  count, and anything that confused it. That report is the early-warning signal: a high call
  count or a "this was confusing" note is a kit gap to fix before the next round. Keep the run
  short by handing over the exact known-good path; a well-understood case should finish in one or
  two API calls and under a minute, not ten.
- **Clean up after a round.** Delete or note any throwaway resource a failed or exploratory
  attempt left on the live Agenta project (a half-built app from a dead-end path, for example);
  don't let the lab project accumulate debris from attempts that didn't pan out. Scratch files
  on disk get removed too, not left for the next session to puzzle over.

## Lab structure

The lab lives at `/home/mahmoud/code/agent-creation-lab/` (outside the `agenta` repo, see
"Who does the building" above). It now keeps a real experiment record, not just one folder per
round:

- `README.md` — the lab's own index: what's in here, how an experiment is run, a table of every
  experiment and its current status.
- `verified-facts.md` — my cumulative ground truth (schema shapes, the proven invoke contract,
  gotchas), copied into each new experiment's instructions rather than referenced, so an
  experiment folder stays self-contained and a subagent never needs to read outside it.
- `report.md` — the living scientific report: hypothesis, method, result, analysis per
  experiment, plus a running "open findings" section for things (like the reference-only-invoke
  gap) that don't belong to one use case alone.
- `experiments/NN-name/` — one folder per use case (numbered to match `use-cases.md`), with an
  `attempt-M/` subfolder per re-run when a use case gets repeated against improved instructions,
  each holding that attempt's `instructions.md`, `plan.md` (if checkpointed), and `result.md`.

## Use cases

Eight, ordered by complexity, agreed 2026-06-30. Full list with what each one tests and what it
needs (connections, prior learnings it should reuse) lives in `use-cases.md`. Short form:

1. Text summarizer — write to the agent's own identity/instructions, nothing else. The
   "hello world" of the loop: prove the plumbing works.
2. Style/writing editor — must author its own `SKILL.md` (style-editing best practices) and
   attach it. Tests skill-authoring, not just instruction-editing.
3. Self-reflecting agent — annotates its own traces after a conversation. Tests whether a
   hinted-at internal capability gets discovered and used correctly.
4. GitHub-connected lookup (e.g. "what's my GitHub username") — first use case with a
   pre-existing connection. Tests finding and wiring the right tool by name.
5. PR review / QA — reads and reviews a PR over the API only (no filesystem, no clone).
6. Connection round-trip — deliberately missing connection; the subagent must ask the human
   and wait, not guess or fail silently.
7. Trigger creation and testing — create a trigger, check for its connection first, test it
   for real where that's cheap and immediate, otherwise verify config and report back honestly.
8. Telegram bot — hardest, last. Needs a trigger, same-thread replies, and the subagent must
   tell the human how to do the one-time external setup (the bot token) it cannot do itself.

## Scaling from one use case to eight

Start with use case 1 to prove the loop mechanics and get the first real lab-folder tooling in
place. Each later case answers a question the earlier ones can't: does a fix from an earlier
case generalize (a script that also helps a later case), or does the kit still need something
case-specific? A run of nothing-but-case-specific fixes is itself a finding: the kit is missing
a general primitive, not just a sharper instruction.

## Open questions

Blocking use case 1: which local stack and project to run against, and the API key for it. See
the chat reply. Per-use-case connection requirements (which projects need GitHub, Slack,
Telegram, or a deliberately-missing connection) are listed in `use-cases.md`.
