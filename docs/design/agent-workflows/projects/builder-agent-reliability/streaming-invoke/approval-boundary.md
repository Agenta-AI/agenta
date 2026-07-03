# Approval boundary — an auto-approved run stops at the tool gate (bug)

This page investigates a specific behavior the streaming reproduction exposed, decides whether it is
a bug, shows how the frontend hides it, pins when it was introduced with a commit, and recommends a
fix. It is the detailed companion to `context.md` and `research.md`.

## The behavior we see

Same run as the rest of this workspace: the `uc9-digest` agent with tools `LIST_COMMITS`,
`LIST_REPOSITORY_ISSUES`, `LIST_ALL_CHANNELS`, then the side-effecting `SEND_MESSAGE`. The agent is
configured headless with `runner.interactions.headless: "auto"` (auto-approve).

- **Streaming** trace `894862fe8af0c3aae9e63e2637babab9`: the stream runs `LIST_COMMITS`,
  `LIST_REPOSITORY_ISSUES`, `LIST_ALL_CHANNELS` with their `tool_result`s, then emits
  `tool_call SEND_MESSAGE`, an `interaction_request` (`kind: user_approval`), `usage`, `done`. Four
  `tool_call`s, only three `tool_result`s. The run **stops at the `SEND_MESSAGE` gate**; the terminal
  tool's result never streams.
- **Batch** trace `901d24c25f3491fe3badbbb521ea5a55`: the same run, so the assistant text ends
  mid-sentence right before the terminal tool. Batch returns only the final assistant text, so the
  stop is invisible except that the reply is cut off.

The puzzle the user raised: the tool is set to **auto-approve**, and the auto-approval happens inside
the sidecar. That is not a real human interaction. So the run should just continue — approve in
place, run the tool, stream its result, finish. Instead it emits an `interaction_request` and stops.
This page confirms that is a bug and shows exactly why it happens.

## Why the run stops — the root cause, in one chain

The stop is not the `auto` policy running the tool out of band. The `auto` policy is never consulted.
One line short-circuits it.

1. **The permission event is emitted unconditionally, before any policy decision.** When the harness
   raises an ACP permission request, `attachPermissionResponder` first emits the
   `interaction_request(user_approval)` event, then asks the responder what to do
   (`services/agent/src/engines/sandbox_agent/permissions.ts:63-77`). This is the only emitter of
   `kind: user_approval` in the codebase, so the event in the trace fires for every gate the harness
   raises, regardless of policy.

2. **The responder parks on a "human surface" before it checks the policy.**
   `HITLResponder.onPermission` (`services/agent/src/responder.ts:254-259`):

   ```ts
   async onPermission(request: PermissionRequest): Promise<ResponderOutcome> {
     const stored = this.lookupPermission(request);
     if (stored) return stored;
     if (this.hasHumanSurface) return "park";               // line 257 — parks REGARDLESS of policy
     return this.basePolicy === "deny" ? "deny" : "allow";  // headless-only, unreachable in practice
   }
   ```

   Line 257 returns `park` whenever `hasHumanSurface` is true, *before* it ever looks at
   `basePolicy`. The auto-allow branch on line 258 is only reachable when there is no human surface.
   `PermissionPolicy` is only `"auto" | "deny"` (`responder.ts:33`) — there is no `ask` value — so the
   responder cannot tell "this specific tool needs a human" from "the policy auto-approves
   everything." It parks on all of them.

3. **`hasHumanSurface` is just "is there a sessionId".**
   `services/agent/src/engines/sandbox_agent.ts:511`:
   `const hasHumanSurface = !!(request.sessionId && request.sessionId.trim());`
   The responder is built with that flag (`sandbox_agent.ts:537-544`).

4. **The SDK mints a sessionId for every invoke, headless or not.** The running-middleware normalizer
   resolves a session id once before the handler runs and mints one when it is absent
   (`sdks/python/agenta/sdk/middlewares/running/normalizer.py:302-308`,
   `sdks/python/agenta/sdk/models/shared.py:13-22` — `resolve_session_id` returns `uuid4().hex`). It
   flows into `SessionConfig.session_id` (`services/oss/src/agent/app.py:216, 254`) and becomes the
   runner's `AgentRunRequest.sessionId`.

**Put together:** every productized invoke carries a `sessionId`, so `hasHumanSurface` is always true,
so `onPermission` always short-circuits to `park` at `responder.ts:257`, so the `auto` policy is dead
code for any harness that raises gates. A "headless one-shot invoke" parks at the first gated tool
exactly like an interactive one.

## What "stops" actually means — park ends the turn

Park is not "await a reply on the same stream." It tears the turn down and expects a *new* turn (a
resume) to carry the decision:

- On park the responder sends **no** `respondPermission`, so the gated tool is never approved
  (`permissions.ts:85-93`).
- `onPark` sets `parked = true`, aborts the loopback MCP, and cancels the in-flight prompt with
  `sandbox.destroySession(session.id)` (`sandbox_agent.ts:524-536`).
- The turn loop races the prompt against the park signal and, on park, sets
  `stopReason: "paused"` (`sandbox_agent.ts:616-632`), then reads usage and finishes
  (`sandbox_agent.ts:638-699`).

That produces the `usage` then `done` tail we saw, with the terminal tool's `tool_result` absent
because the tool was never run this turn. Over a one-shot HTTP invoke there is no resume, so the run
simply ends at the gate.

## Harness nuance — this is a Claude run, not Pi

Only Claude gates tool use. Pi never raises ACP permission requests (`permissions: false`), so a Pi
run never parks and never emits `user_approval`
(`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useModelHarness.tsx:111`;
`.../ClaudePermissionsControl.tsx:12`). The trace that emits `interaction_request(user_approval)` is
therefore a Claude run. Claude auto-runs the read-only `LIST_*` tools via its rendered
`.claude/settings.json` allowlist (no ACP gate), and raises a gate on the side-effecting
`SEND_MESSAGE` — which is why we see three `tool_result`s for four `tool_call`s, with the park landing
on the fourth. `permission_policy: "auto"` is explicitly *not* a blanket bypass of Claude's per-tool
gates (`sdks/python/agenta/sdk/agents/adapters/claude_settings.py:30`).

The tool relay has a separate per-tool permission layer for runner-executed (gateway/code) tools
(`services/agent/src/tools/relay.ts:101-110`). It does not emit `interaction_request`, and `ask` there
"degrades to the run policy" with an explicit `TODO(S5): surface ask to HITL` (`relay.ts:108`). So the
per-tool `permission` field never reaches the ACP responder — a second reason the responder can only
park all-or-nothing on the presence of a session id.

## How the frontend hides it (why the playground works)

The playground does not see this because it auto-answers each park and re-sends the conversation,
which cold-replays the run to completion. A one-shot HTTP caller has no equivalent.

- The chat panel drives the run with Vercel AI SDK `useChat` and an auto-resume predicate:
  `useChat({ ..., sendAutomaticallyWhen: agentShouldResumeAfterApproval })`
  (`web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx:259-265`; same wiring in
  `AgentChatConversation.tsx:96`).
- `agentShouldResumeAfterApproval` returns true once a parked interaction is freshly resolved and
  every non-provider tool part is settled
  (`web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts:108-122`). When true,
  `useChat` re-sends the whole conversation.
- `agentMessageQueue.ts:39-61` holds typed-ahead messages during the paused window so they do not
  inject mid-gate.

The event round-trip that closes the loop:

1. SDK egress turns the runner's `interaction_request(user_approval)` into the Vercel
   `tool-approval-request` chunk on the tool part, state `approval-requested`
   (`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:390-434`).
2. The frontend decision becomes a `tool_result` whose output is an `{ "approved": bool }` envelope
   (`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:192-227`).
3. On the resumed turn the runner reads that envelope back via `extractApprovalDecisions`
   (`services/agent/src/responder.ts:384-408`); `HITLResponder.lookupPermission` (`responder.ts:255,
   268-282`) resolves the re-raised gate to `allow`/`deny`, sends `respondPermission`, the tool runs,
   and the run finishes.

This is the same ingress/egress path hardened in the merged PR #4859 ("Resume HITL Deny end-to-end"),
which fixed the deny case by emitting the `{approved}` envelope for the inline tool-part shape. The
approve/resume machinery it relies on is exactly what a one-shot HTTP invoke lacks: there is no
`sendAutomaticallyWhen`, nothing re-POSTs the envelope, so the turn stays at `stopReason: "paused"` and
the tool result never arrives.

## When this was introduced

Before this, the runner always answered the gate inline and continued in-band. The stop was introduced
with the HITL path and finalized as a true no-reply park.

| Commit | Date | Change |
| --- | --- | --- |
| `965e180562` | initial | `responder.ts` created with only `PolicyResponder`: a hardcoded auto-approve answered the gate **inline**; the run always continued. |
| `3ecd43704b` | 2026-06-23 | Split the emit into `permissions.ts`; owns today's `interaction_request(user_approval)` emit. |
| `34026d2670` | 2026-06-24 | First `HITLResponder` + `hasHumanSurface`; the human-surface branch was `return "deny"` (deny-park). |
| **`b109cc51ef`** | **2026-06-25** | **Decisive change.** `if (this.hasHumanSurface) return "park"` (was `"deny"`); park sends no `respondPermission`. This is where auto-approve stopped continuing in-band. |
| `558423025e` | 2026-06-26 | `onPark → destroySession` so a parked turn ends gracefully instead of hanging (F-040). |
| `d271ee0fa7` | 2026-06-30 | `onCreateInteraction`/`onResolveInteraction` plumbing (JP Vega). |

The decisive diff (`git show b109cc51ef -- services/agent/src/responder.ts`):

```diff
-    if (this.hasHumanSurface) return "deny"; // park: do not run the unapproved tool this turn
+    if (this.hasHumanSurface) return "park"; // human must decide; end the turn, tool pending
     return this.basePolicy === "deny" ? "deny" : "allow"; // headless: PolicyResponder parity
```

Answer to "was there a version where auto-approve continued in-band?" — yes, before 2026-06-24. The
park was made conditional only on `hasHumanSurface`, never on the resolved policy, and because the
normalizer always mints a `sessionId`, `hasHumanSurface` is always true, so `auto` runs park too.

## Verdict — this is a bug

For the `auto` policy on any non-interactive path, this is a bug, not intended behavior.

- The documented intent of `permission_policy: "auto"` is to auto-approve tool prompts in a headless
  run (`sdks/python/agenta/sdk/agents/dtos.py:846`, `responder.ts:504-506`). The `HITLResponder`
  docstring even claims its headless branch is byte-identical to `PolicyResponder`, so `/invoke` is
  unchanged.
- That headless branch is unreachable in practice. The always-minted `sessionId` makes
  `hasHumanSurface` always true, so `onPermission` short-circuits to `park` at `responder.ts:257` and
  never consults `basePolicy`. `auto` is silently overridden into "park and wait for a human," which
  for any non-interactive caller means "stop at the first gated tool and never finish."
- The responder cannot even tell whether a given gate genuinely needs a human, because per-tool
  disposition is not plumbed to it (`PermissionPolicy` is only `auto|deny`; per-tool `permission` is
  handled only in `relay.ts` with `TODO(S5)`).

## Recommended fix

**Consult the policy before parking**, at `services/agent/src/responder.ts:254-259`, so an `auto` run
streams through in-band and only a genuine human-decision policy parks:

```ts
async onPermission(request: PermissionRequest): Promise<ResponderOutcome> {
  const stored = this.lookupPermission(request);
  if (stored) return stored;
  if (this.basePolicy === "deny") return "deny";
  if (this.basePolicy === "auto") return "allow";   // continue in-band, stream the tool_result
  if (this.hasHumanSurface) return "park";           // only when the policy genuinely defers to a human
  return "allow";
}
```

With `auto` answering `allow`, `permissions.ts:97-100` sends `respondPermission("once")`, the tool
runs, its `tool_result` streams, and the turn finishes. This is exactly the user's read: an
auto-approval inside the sidecar is not a real interaction, so the responder should answer in place and
keep going. The `interaction_request` emit at `permissions.ts:63-75` can stay as a passive
notification; it just must not terminate the run.

**Necessary caveat (why the one-liner is not the whole story).** Today `PermissionPolicy` is only
`auto|deny`, so the playground relies on the gate *parking* to show its approval prompt. If `auto`
streams through, an interactive `auto` session stops prompting. The complete fix needs a third
disposition — `ask` — or it must plumb the per-tool `permission` field already resolved in `relay.ts`
into the ACP responder, and park **only** when the resolved disposition is `ask`. That is the
`TODO(S5)` at `relay.ts:108`. So: the reported symptom (an `auto` run must not stop) is fixed at
`responder.ts:257`; keeping HITL working in the playground is fixed by giving the responder an `ask`
signal.

## Key files

- `services/agent/src/responder.ts` — `HITLResponder.onPermission` (254-259, the park at 257),
  `PermissionPolicy` (33), `policyFromRequest` (507-515), `extractApprovalDecisions` (384-408).
- `services/agent/src/engines/sandbox_agent/permissions.ts` — unconditional emit (63-75), responder
  consult (76-77), park with no reply (85-93), `respondPermission` (97-100).
- `services/agent/src/engines/sandbox_agent.ts` — `hasHumanSurface` (511), responder build (537-544),
  `onPark`/`destroySession` (524-536), prompt-vs-park race and `stopReason:"paused"` (616-632).
- `services/agent/src/tools/relay.ts` — per-tool permission layer (101-110), `TODO(S5)` (108).
- `sdks/python/agenta/sdk/middlewares/running/normalizer.py:302-308`,
  `sdks/python/agenta/sdk/models/shared.py:13-22` — the always-minted `session_id`.
- `services/oss/src/agent/app.py:216, 254` — `session_id` into the runner.
- Frontend resume: `web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx:259-265`;
  `web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts:108-122`;
  `.../agentMessageQueue.ts:39-61`.
- SDK egress/ingress: `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:390-434`;
  `.../vercel/messages.py:192-227`.
- Related merged work: PR #4859 (Resume HITL Deny end-to-end).
</content>
</invoke>
