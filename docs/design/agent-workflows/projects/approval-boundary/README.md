# Approval boundary: how agent tool approvals work, the bug, and the fix plan

An agent configured to auto-approve tools still stops at the first gated tool and waits for
a human who is not there. This workspace explains the permission/approval system end to end,
pins that bug, reviews the code behind it, and proposes a plan that fixes the bug and the
design weaknesses that produced it.

Everything here is documentation and planning. No code changes ship with this PR.

## TL;DR

- **The system.** Authors set a global permission default plus per-tool
  `allow | ask | deny`. Enforcement happens at three gates: Claude Code's own settings file
  (rendered by our SDK), the runner's answer to Claude's permission requests, and the
  runner's "relay" for tools it executes itself. When a run pauses for an approval (the
  code calls this a "park"), the playground shows Approve/Deny buttons and re-sends the
  conversation with the answer inside it.
- **The bug.** The runner decides "pause for a human" from whether the request carries a
  session id. The SDK now mints a session id for every request, so every fresh gate pauses,
  the `auto` policy is dead code, and a headless run (any caller without a chat UI: curl,
  agent-as-tool, evaluations, triggers) dies at the first gate. Batch responses hide the
  pause entirely: HTTP 200, mid-sentence text. See [the-bug.md](the-bug.md).
- **The fix direction.** Park only on authored intent. One resolved permission plan
  (default + per-tool + builtin rules, vocabulary `allow | ask | deny`) is computed by the
  SDK and enforced by both runner gates; the session-id inference is deleted; the approval
  event fires only when the run actually pauses; batch shows the paused state. Recommended
  as one shot (POC, no compat constraints); an independent Codex review concurred. See
  [plan.md](plan.md).
- **One expectation to reset.** The fix does not make the original reproducing agent run
  unattended under default config. Its `SEND_MESSAGE` tool is a write, and writes default
  to `ask` by design, so the run still pauses there until the author marks that tool
  `allow`. What changes: the pause happens for the authored reason, it is visible, and the
  `auto` policy genuinely governs the tools it applies to.
- **Beyond the bug.** The correctness review found 4 high, 6 medium, and 2 low issues in
  the same code (a swallowed reply failure that can hang runs, stale client-tool replay,
  and more). The organization review found good invariant discipline but four enforcement
  sites with no map, one knob with three names, and a false load-bearing comment.

## Reading order

1. [context.md](context.md): why this workspace exists, scope, decisions already taken.
2. [how-approvals-work.md](how-approvals-work.md): the whole flow in plain words. Read
   this first if you read only one file.
3. [the-bug.md](the-bug.md): the root cause chain, the history that produced it, why
   nothing caught it.
4. [design-review.md](design-review.md): the structural problems and the principles the
   fix follows.
5. [code-review.md](code-review.md): correctness findings (H1-H4, M1-M6, L1-L2).
6. [code-organization-review.md](code-organization-review.md): naming, ownership,
   docstrings, maintainability.
7. [plan.md](plan.md): options, the recommended design, execution phases, test plan,
   behavior deltas.
8. [status.md](status.md): current state and the decisions needed.

## How this was produced

Four parallel code-research passes (runner, SDK+service, frontend, API interactions plane)
with every claim cited to current file:line; a dedicated correctness review and a dedicated
organization review of the permission code; an independent design review by OpenAI Codex
(xhigh reasoning) that stress-tested the fix options; and a cold-reader clarity pass over
these documents. All paths verified against the current tree (`services/agent/` was renamed
to `services/runner/`; several older docs cite the stale paths).
