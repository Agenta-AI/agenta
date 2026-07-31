# Warm approvals QA — the patched codex-acp bridge

Live verification of the D-008 amendment (2026-07-31): patch codex-acp so the `agent-full-access`
preset sends `approvalPolicy: "on-request"` instead of `"never"`, restoring Codex's native
permission gates so tool approvals park WARM on the runner's keep-alive path.

Deployment: the codex-harness worktree stack (`agenta-ee-dev-codex-harness`, EE dev images, local
sandbox), runner rebuilt from this branch. Agent: harness `codex`, model `gpt-5.6-luna`, default
mode `agent-full-access` (no `harnessMode` override). Tool: the self-contained platform op
`list_connections`. Drivers: `spike/scripts/m3-qa.py` (allow / deny / cold resume) and
`spike/scripts/codex-warm-approval-qa.py` (warm resume).

## The patch is in the image

The image build runs `scripts/patch-codex-acp-approvals.ts` right after the codex pin. Verified in
the built image:

```
static AgentFullAccess = new _AgentMode(
    "agent-full-access",
    ...
    "on-request",
    { "type": "dangerFullAccess" },
    "danger-full-access"
```

Approvals are decoupled; the sandbox policy is untouched, so full access is still full access.

## Scenario 1 — allow: runs with no pause

SSE: `tool-input-available` → `tool-output-available` → `finish=stop`, no approval frame.

Runner log, showing the native gate now fires under the default mode (it never did before the
patch) and is answered in-process:

```
[codex-mode] applied mode=agent-full-access
[HITL] ACP gate id=85d34df9 {"anchor":"list_connections","executor":"relay",...}
[HITL] gate toolName="list_connections" permission=allow outcome=allow    <- codex's own gate
[HITL] gate toolName="list_connections" permission=allow outcome=allow    <- the MCP seam
```

An `allow` tool costs one extra in-process exchange and no human round trip.

## Scenario 3 — deny: refused at the gate, turn continues

SSE: `tool-input-available` → **`tool-output-denied`** → the model recovers ("The connections tool
call was rejected, so I couldn't retrieve your connections") → `finish=stop`.

```
[HITL] gate toolName="list_connections" permission=deny outcome=deny
```

Exactly one gate: the denial lands at codex's gate BEFORE the call is issued, so the seam never
runs. **Frame-shape change worth knowing:** the denial now projects `tool-output-denied`, the same
decline frame Claude produces. Under the old runner-side-only gate the call reached the MCP seam
and came back as `tool-output-error` ("denied by policy"). This is a UX improvement (Codex and
Claude now render identically), but it is a change: `m3-qa.py`'s assertion was updated to match.

## Scenario 2 — ask: parks WARM and resumes in place

Turn 1 parks with a single approval card:

```
[HITL] gate toolName="list_connections" permission=ask outcome=pendingApproval
[keepalive] park-approval key=...:a616d4e8 tool=list_connections
[keepalive] park key=...:a616d4e8 ttl=300000ms state=awaiting_approval poolSize=1
```

`state=awaiting_approval` with the 300s approval TTL is the keep-alive park — the same one Claude
gets. The session stays alive holding the pending ACP permission request.

Resume (unchanged turn-1 history plus the `approval-responded` decision, the shape the playground
sends):

```
[keepalive] resume key=...:a616d4e8 gates=1 answered=1 carried=0 approve=1 reject=0
[keepalive] resume answered gate reply=once tool=list_connections
[HITL] gate toolName="list_connections" permission=ask outcome=allow
```

No eviction, no cold replay. Results:

- tool executed — PASS
- **same tool-call id** `exec-2ad4c886-…` on both the parked card and the resumed output — PASS.
  This is the decisive signal: a cold replay makes the model re-issue the call and it gets a NEW
  id. The `m3-qa.py` cold run shows exactly that (`exec-60b4b631` parked → `exec-4d2b94ab`
  executed); the warm run keeps one id end to end.
- no second approval card — PASS
- codeword `FLAMINGO-42` preserved in the reply — PASS

Reject resume: "The tool call was rejected and not executed", no execution.

## The double-gate the patch would otherwise have caused

Native gates mean one call reaches the runner twice: at codex's ACP gate, then at the loopback
`agenta-tools` MCP seam. Without a handshake an `ask` tool would prompt the human twice. Both
paths were exercised live and neither prompted twice:

- **Warm resume**: the ACP gate is answered by `respondPermission`, so the `{approved}` envelope in
  history is still unconsumed when the seam asks; the seam decides `allow` from the stored
  decision.
- **Cold replay** (the `m3-qa.py` run): the ACP gate consumes the stored decision
  (`outcome=allow`), so the seam's responder returns `pendingApproval` — and the turn still did not
  park, and the tool still executed. That is the execution grant being consumed. Without it the
  seam would have returned `MCP_PAUSED` and surfaced a second card.

## The Daytona half

The runner-image patch alone does not reach Daytona: on a remote run the sandbox-agent daemon runs
INSIDE the Daytona sandbox, so its codex-acp comes from the Daytona snapshot image, not the runner
image. The snapshot recipe (`services/runner/images/sandbox/daytona/build_snapshot.py` — it IS in
this repo, contrary to the m5 note) now pins codex-acp to the same 1.1.7 the runner image pins and
applies the same patch, both asserted at build time. The patch anchor is single-sourced in
`codex-acp-patch.json` so the two images cannot drift.

Measured on the OLD snapshot, before the fix:

- **An `ask` tool ran with NO approval at all.** A live Daytona run with `permission: "ask"` went
  straight through: `tool-input-available` → `tool-output-available` → `finish=stop`, no approval
  frame anywhere. This was a real permission-enforcement hole, not a warm-versus-cold difference.
  It existed because the runner's `agenta-tools` seam gate is off for Daytona, the relay guard
  passes `ask` on the assumption the harness gates it (`relay-guard.ts`), and codex under
  `approvalPolicy: "never"` gated nothing.
- `gpt-5.6-luna` was rejected outright: `does not support value 'gpt-5.6-luna' for category
  'model'. Allowed values: gpt-5.3-codex, gpt-5.4, ...` (the pin gap, #5537).

Both are closed on the rebuilt snapshot, verified live.

## The matrix

`spike/scripts/codex-approval-matrix-qa.py`, default `agent-full-access`, no `harnessMode`
override, `gpt-5.6-luna`, the `list_connections` platform tool. Run cells ONE AT A TIME: back to
back, an earlier cell's sessions sit in the keep-alive pool and can push a parked approval out of
it, which turns a warm resume cold and reads as a failure.

| cell | local | daytona |
| --- | --- | --- |
| allow — runs, no card | PASS | PASS |
| deny — refused, turn continues | PASS | PASS |
| ask — parks with one card, does not execute | PASS | PASS |
| ask → warm resume (same tool-call id) | PASS | PASS |
| ask → cold 1 (session evicted, runner alive) | PASS | PASS |
| ask → cold 2 (runner replica replaced) | PASS (refuses, correctly) | PASS |

Local ran 20/20 checks green as a full sweep.

**Subscription mode re-proved after the patch** (the patch changes subscription runs too — same
bridge, so native gates now raise there as well; M4's QA predated it). With
`CONNECTION_MODE=self_managed` (the operator's mounted ChatGPT/Codex login,
`credentialMode=runtime_provided`): ask parks with one card, the warm resume keeps the parked
tool-call id, the codeword survives, and deny refuses cleanly — 9/9 checks. The runner log confirms
the real subscription path ran: `codex subscription auth.json symlinked <cwd>/.codex/auth.json ->
/codex-home/auth.json`.

**Cold 2 needs its method stated, because the wrong method measures the wrong thing.**

- Use SIGKILL, not `docker restart`. On SIGTERM the runner runs its shutdown handler and DELETES
  every sandbox it owns, parked approvals included (`server.ts` → `pool.destroyAll`). That is
  deliberate, so a `docker stop` cannot leak a running sandbox — but it destroys the session this
  cell wants to resume, and the resume then fails on a sandbox in state `not-found`.
- Then wait out `OWNER_TTL_SECONDS` (120s). The killed replica never released the session-owner
  key, and `claim_owner` never steals from an owner that still looks live, so until it lapses the
  new replica cannot take the session. Inside that window the resume fails with a misleading
  "the in-sandbox tool MCP shim could not be delivered". Filed as a separate pre-existing bug
  (issue #5611) with a candidate fix; it is harness-independent (reproduced with a plain `allow`
  tool, no approval involved) and untouched by this branch.
- On LOCAL, cold 2 correctly REFUSES: `local sandbox requires a single runner: replica X is not
  the owner of session Y`. A local sandbox lives inside the runner process, so another replica
  genuinely cannot adopt it. A refusal is the right outcome, not a completed resume.
- On DAYTONA, cold 2 completes with a NEW tool-call id. That is correct: cold 2 is a cold replay,
  so the model re-issues the call. Only the WARM cell should keep the original id.

## The watchable proof — the real playground UI

`warm-approvals-ui-qa.mp4` (frames from a live chrome-devtools session against the worktree
deployment, agent `New agent`, harness Codex, the `Exact Match` workflow-reference tool, policy
`Ask`): the ask-tool parks with a real approval card ("Approval needed to continue"), and every
Approve resumes the SAME turn in place — visibly, because the model reads each tool result and
reacts mid-turn (it retried the evaluator with corrected arguments after seeing its validation
error, something a dead turn cannot do). The codeword planted in the user message survives to the
final reply. The runner log for the exact window shows the same story with zero cold replays:

```
[keepalive] park-approval key=...:1bc8ddc5 tool=Exact Match
[keepalive] resume key=...:1bc8ddc5 gates=1 answered=1 approve=1 reject=0 tool=Exact Match
[keepalive] resume answered gate reply=once tool=Exact Match
[keepalive] park ... state=awaiting_approval (re-park)        <- the model's next call parks again
```

(repeated for each approve — every one a live `resume`, none an eviction).

## The release gate now covers codex approvals

`agent-release-gate` `qa_product.py`'s `approve`/`deny` journeys no longer skip codex: on codex
they probe with the `list_connections` platform tool (per-tool `ask`) instead of the builtin
shell, same flow and assertions. Verified live: X1 approve PASS + deny PASS, and the untouched
non-codex branch re-verified on C3 (Pi) approve PASS + deny PASS. (C1, Claude-subscription,
cannot run on this stack — no mounted Claude login — and the project vault has no Anthropic key,
so the Claude branch is covered by the byte-identical diff plus the Pi run.)

## Note on `m3-qa.py` and the history guard

`m3-qa.py` can only ever test the cold path: it rewrites the turn-1 text and appends a nudge
message, so the request's prior conversation stops matching what the park recorded and the runner
correctly evicts (`approval-mismatch (history) ...; evict + cold`). That guard is doing its job —
an edited transcript must not continue a live session. `codex-warm-approval-qa.py` re-invokes with
the unchanged history, which is what the playground actually sends.
