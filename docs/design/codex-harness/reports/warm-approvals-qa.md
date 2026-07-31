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

## Note on `m3-qa.py` and the history guard

`m3-qa.py` can only ever test the cold path: it rewrites the turn-1 text and appends a nudge
message, so the request's prior conversation stops matching what the park recorded and the runner
correctly evicts (`approval-mismatch (history) ...; evict + cold`). That guard is doing its job —
an edited transcript must not continue a live session. `codex-warm-approval-qa.py` re-invokes with
the unchanged history, which is what the playground actually sends.
