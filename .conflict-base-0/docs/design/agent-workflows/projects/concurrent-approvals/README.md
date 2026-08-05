# Concurrent approvals: more than one approval request in a single turn

This workspace plans one change to the agent runtime: let a single agent turn ask the
human to approve more than one tool call at the same time. Today the runtime shows exactly
one approval card per turn even when the agent tried to call several gated tools at once.
The extra calls are cancelled and re-requested on later turns, which the user sees as the
agent stalling and repeating itself.

## Reading order

- [PLAN.md](PLAN.md): the whole plan. Read it top to bottom. It opens with what the user
  sees today, explains why, then gives the design, the file-level changes, the interface
  effect, the test plan, how this composes with three in-flight pull requests, the rebase
  story, rollout and rollback, non-goals, and open questions.

There is only one plan document. This README exists to define the shared vocabulary once so
PLAN.md can lean on it.

## Vocabulary (defined once here)

- **Runner**: the Node/TypeScript service that runs one agent turn: it talks to the model
  harness, streams events back to the browser, and executes or gates tool calls. Code lives
  under `services/runner/`.
- **Harness**: the model driver the runner speaks to over a local protocol called ACP
  (Agent Client Protocol). The two harnesses are Claude (Anthropic's agent SDK) and Pi.
- **Gate**: a point where a tool call needs a human yes or no before it runs. A gate that
  needs a human is an "ask" gate.
- **Approval card / approval request**: the inline "Run this tool? Approve / Deny" widget
  the playground shows for an ask gate. On the wire it is one `interaction_request` event
  with `kind: "user_approval"`.
- **Park**: end the current turn while a gate waits for the human, then continue the same
  logical turn once the human answers. Parking is how the run pauses without failing.
- **Latch**: a one-shot guard object (`PendingApprovalLatch`) that today allows only the
  first approval card in a turn to be shown and silently blocks the rest.
- **Cold path (cold-replay)**: the resume style that rebuilds the whole conversation as
  text and sends it to a fresh model turn. The human's answer is read back out of that
  replayed history.
- **Warm path (keep-alive)**: the resume style that keeps the same harness process and ACP
  session alive across the pause, so the human's answer is delivered live to the waiting
  harness instead of being replayed as text.
- **Force-settle**: mark a gated tool call as "not executed, paused" so it does not hang as
  an open call when its sibling gate parked the turn.
- **Frontend / FE**: the playground UI, in `web/packages/agenta-playground/` and
  `web/oss/`.
- **SDK**: the Python agent SDK in `sdks/python/agenta/`. It converts between the browser's
  message format and the runner's event stream.

Related prior work this plan builds on: [../hitl-fix/](../hitl-fix/) (the original
approve/deny round-trip fix) and [../cold-replay-stopgaps/](../cold-replay-stopgaps/) (the
text-replay hardening). The ground-truth code trace this plan is built on lives at
[../../scratch/research-client-tools-and-concurrent-hitl.md](../../scratch/research-client-tools-and-concurrent-hitl.md),
Question 2.
