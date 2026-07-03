# Isolated skill test — `build-agent` (2026-07-01)

Faithful isolation test of the SHIPPED skill at `agenta-skills/skills/build-agent/` (draft PR #1).
Each use case ran in its own folder outside the agenta repo, with a copy of the skill and the
creds, driven by a fresh Sonnet subagent told to read ONLY the skill. Live target: the bighetzner
project (GitHub `github-fa1`/`github-08f` + Slack `slack-1vh` connected; Notion + Telegram not).
Every subagent claim was re-verified against the live API (traces, spans, channel read-back).

## Headline

The simple cases work. The flagship multi-tool/scheduled case does not work reliably today, and
the reason is a **platform bug, not the skill**: `instructions.agents_md` is being ignored on the
claude harness, so an agent only behaves as intended when the invoke *message* carries the task.
I also found and fixed a real script bug that broke the skill's simplest path, and a verification
script that reported false success on an undelivered write.

## Metrics

| Case | Outcome | Cost | Notes |
|---|---|---|---|
| UC1 summarizer (1st) | ✅ correct, but hit a script crash | ~16 calls / 160s | wasted ~11 diagnosing **F-D** |
| UC1 summarizer (after fix) | ✅ first shot | 1 `build.sh` / ~55s | restored floor |
| UC4 GitHub username | ✅ built + tested (real username via tool) | ~9 actions / ~87s | surfaced **F-A** |
| UC6 Notion (stop-and-ask) | ✅ correctly built nothing | 3 script calls / ~49s | surfaced **F-C** |
| UC9 capstone digest | ⚠️ agent+schedule built; reached SEND_MESSAGE 4/7 tries; **post never delivered** | 87 calls / ~25 min | surfaced **G-1..G-7** |

## Findings — fixed in the shipped skill (working tree)

- **F-D (HIGH): `test-agent.sh` died silently on any zero-tool-call run** — the skill's own
  flagship no-tools case. `grep -c .` exits 1 on no matches; `lib.sh`'s `set -e` then killed the
  script inside a command substitution before printing OUTPUT/TOOLS/RESOLVED/TRACE. `build.sh`
  printed only `CREATED: {...}` then exit 1, a total mystery failure. Only fired when the run made
  zero tool calls, which is why UC4 (1 call) passed and UC1 (0 calls) crashed. Reproduced, fixed
  (`grep -c . || true`), re-verified. Same bug existed in the lab kit's `test-agent.sh` (which
  ports to `agenta_builtins.py`) — fixed there too.
- **F-A (MEDIUM): a real env slug `github-08f` was hardcoded in two shipped reference docs**, but
  live discovery for this project resolves `github-fa1`. An agent copying the doc wires the wrong
  connection. Replaced with a `<connection-slug>` placeholder and added multi-connection guidance
  (a project can have several connections for one integration; use the slug discovery prints).
- **F-C (MEDIUM): discovery's headline `READY: true` can point at the wrong integration.** "Save
  notes to Notion" matched Slack `SEARCH_MESSAGES` as primary and still said `READY: true`; the
  real Notion state (`needs_auth`) was only in the `CONNECTIONS:` block. Strengthened the
  "discovery is a search" rule: the `CONNECTIONS:` block is authoritative, and confirm the matched
  integration is the one you asked for.
- **F-B (LOW): two shipped scripts referenced lab-only files** (`BUILD-AGENT.md`,
  `verified-facts.md`) not in the package. Repointed to shipped files.
- **G-2 (MEDIUM, SKILL BUG): `check-tools.sh` reported `VERDICT: PASS` on the capstone's
  undelivered Slack write.** Two causes: its `"ok?": true` grep never matches the real span payload
  (so `ok:true markers` was always 0, even for genuine successes), and the verdict keyed only on
  the tool NAME appearing in an `execute_tool` span. But that span appears as soon as the tool is
  CALLED; the result lives in `attributes.output.value`, which is present for a completed tool and
  absent for one stalled at an approval gate (verified: UC4 read has it, capstone SEND_MESSAGE does
  not). Rewrote `check-tools.sh` to verdict on result presence — PASS / UNCONFIRMED (dispatched, no
  result) / FAILED (returned an error) / INCOMPLETE (never ran) — plus a per-tool "returned vs NO
  RESULT" line. Validated against both real traces. Corrected the SKILL.md Verify section, whose
  claim that "the terminal tool being in the executed list is proof" is disproven.
- **G-3 (SKILL): big list payloads derail the run.** `LIST_ALL_CHANNELS` (~200 KB) pushed the model
  to spawn `python3`/`jq` to parse, tripping a separate code-execution approval gate — even after
  forceful bans. Added "prefer narrow, filtered tools" guidance (`FIND_CHANNELS`, not
  `LIST_ALL_CHANNELS`) to writing-instructions.md.

## Finding — the load-bearing one (report only; NOT baked into the public skill)

- **G-1 (HIGH, PLATFORM): `instructions.agents_md` is ignored on the claude harness.** Confirmed
  with four direct probes I ran myself:
  - "Always reply only BANANA" + message "What is 2+2?" → replied **"4"**.
  - Pirate persona + "Hello, how are you?" → **generic coding assistant** ("Ready to help with
    whatever you're working on").
  - "End every reply with [EOF]" + "capital of France?" → **"Paris."** with no tag.
  - Capstone: the Slack channel pinned in `agents_md` was ignored; the agent said *"since no
    channel was specified... I'll use general."*

  So `agents_md` has zero effect; the model runs as a default coding-assistant driven only by the
  invoke message. This is the known runner bug (the Claude SDK auto-loads `CLAUDE.md`, the runner
  writes `AGENTS.md`; fix in flight, live PRs #5000/#5007), confirmed still live on bighetzner
  today. It undermines the skill's entire premise (define the agent through `agents_md`). UC1/UC4
  only "passed" because their test message carried the task; the night-1 coding-assistant-persona
  surprise and the original digest fumble are the same bug. A configured agent invoked with a vague
  message, or fired by a schedule, will not behave as configured.

  I did **not** rewrite the skill's core narrative around a transient bug. The right fix is the
  platform fix; if we want the skill to work before it lands, the interim is to carry the persona
  and numbered procedure in the invoke message (and, for a schedule, in `inputs_json`) rather than
  `agents_md`. Flagged for a decision.

- **G-2b (PLATFORM): the `headless: auto` approval gate did not resolve for the gated write** over
  a one-shot invoke; the post never completed in-session. Softened the SKILL.md line that implied
  the headless policy "later auto-runs it."

## Proposed (not implemented)

- **G-4:** add an `update-agent.sh` that commits a new revision to an existing variant. Today
  `create-agent`/`build.sh` commit only at creation, so fixing instructions needs a new app or a
  throwaway probe (the capstone subagent had to do this). Needs the commit endpoint confirmed.
- **G-5:** document `create-schedule.sh`'s `inputs_json` shape. The subagent guessed
  `{"messages":[{role,content}]}`; historical (subscription) deliveries show
  `{"message":[{type,text}]}`. No schedule-triggered delivery existed to confirm. This matters more
  under G-1 (a scheduled agent's instructions must ride in `inputs_json`). Verify by firing once
  and inspecting `triggers.sh deliveries`.
- **G-6:** add a worked TZ→UTC example (the subagent's shell `date -d` silently failed to convert).
- **G-7:** state the create-order constraint — resolve ids before finalizing the config, because a
  committed revision can't be edited in place (ties to G-4).

## Live resources / cleanup

All created apps archived (`st-uc1-summarizer`, `st-uc1-summarizer-v2`, `st-uc4-gh-username`,
`st-uc9-digest`, `st-uc9-digest-probe`, `st-probe-bananabot`). The capstone's twice-daily schedule
was removed immediately. Only the pre-existing baseline schedule (`019f1eb9…` "test") and the
pre-existing "PR Events" subscription remain — neither is mine. No live schedule spams Slack. The
capstone posted no message to Slack (the write never delivered), so no stray messages landed.

## Files changed (agenta-skills, working tree)

- `scripts/test-agent.sh` — F-D guard (`grep -c . || true`).
- `scripts/check-tools.sh` — rewritten verdict on result presence (G-2).
- `scripts/annotate-trace.sh`, `scripts/check-tools.sh` — F-B stale refs repointed.
- `SKILL.md` — F-C discovery rule; G-2/G-2b Verify section.
- `references/tools-and-connections.md`, `references/config-schema.md` — F-A slug placeholder + F-C.
- `references/writing-instructions.md` — G-3 narrow-tools guidance.
- (lab) `agent-creation-lab/kit/scripts/test-agent.sh` — same F-D guard, so the platform port is clean.
