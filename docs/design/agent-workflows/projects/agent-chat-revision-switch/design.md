# Design: decouple the agent chat from the revision id

Status: proposed. No code or git changes yet. Live QA runs later, when the dev stack is free.
File:line citations are against `origin/big-agents`; another agent may be editing these files,
so re-verify the exact lines at implement time. Evidence with full citations is in `research.md`.

## Problem, in one line

The agent conversation lives inside a host that React keys by the **revision id**. Every
revision switch changes that key, so React **remounts** the whole conversation. The remount
loses the unpersisted mid-stream output (symptom A) and aborts the in-flight stream with no
resume ("connection lost", symptom B).

## Two symptoms, two switch callers, two remount sources

**Two symptoms, one remount.**

- **A: transcript loss.** While a turn streams, the persist effect is skipped
  (`AgentChatPanel.tsx:407-409`), so the assistant's mid-stream output never reaches storage. The
  remount re-seeds `useChat` from storage (`AgentChatPanel.tsx:204`), which holds the user turn
  but not the streamed answer. The answer disappears.
- **B: dropped stream.** The unmount runs the teardown `stop()`
  (`AgentChatPanel.tsx:450-454`), which aborts the in-flight reader. The fresh mount builds a
  new `useChat` and does not resume, so the live turn dies.

**Two callers change the revision id.** Both funnel through `switchEntity → setEntityIds`, which
rewrites the entity id that feeds the host key.

- The commit auto-switch fires mid-stream when the agent commits a new revision of itself
  (`AgentChatPanel.tsx:420-434`).
- The manual version pick in the config header is an independent caller
  (`PlaygroundVariantConfigHeader.tsx:133-143`). A user who switches the revision while a turn
  streams hits B with no involvement from the commit effect.

**Two remount sources in the host, not one.** Both must be fixed, or the bug survives.

1. **`ExecutionItems key={variantId}`** in the runs panel single-view map
   (`MainLayout/index.tsx:342`). The revision id is the key, so a switch remounts the execution
   subtree directly.
2. **The `Splitter` key bounces** during the switch. The key is
   `splitterKey = "single|comparison-agent|std"` (`MainLayout/index.tsx:143`), applied at
   `MainLayout/index.tsx:224`. It derives from `isAgentConfig`, which reads
   `isAgentModeAtomFamily(primaryConfigId)` (`selectors.ts:1253-1258`). When the new revision's
   flags have not loaded yet, `workflowType` falls through to its default of `"completion"`
   (`workflow/state/molecule.ts:368-382`), so the new revision momentarily looks non-agent.
   `isAgentConfig` flips `agent → std → agent`, the `splitterKey` changes, and the `Splitter`
   that wraps both the config and runs panels remounts the entire subtree, taking the
   conversation with it. Keying only `ExecutionItems` is not enough.

## The interface lens

The defect is a **role confusion** in the host layout: the revision id is used as both the
conversation's **mount identity** and the run's **config**.

- As config and routing, the revision id chooses each run's `invocationUrl`, `configuration`,
  and `references`. `buildAgentRequest` reads these from the store on each send
  (`agentRequest.ts:294-394`). The id changes per run and the playground selection owns it.
- It is **not** identity for the conversation. The conversation's identity is its **session**,
  scoped by the app (`state/sessions.ts:47`). Messages key by the globally-unique session id
  with no entity dimension (`state/sessions.ts:88`).

A React `key` is an identity contract: a different key means a different thing, so remount. The
conflation lives in **`MainLayout`** (the host that builds the key), not in `AgentChatPanel`.
So the fix splits responsibilities by layer: fix mount **identity** in the host layout; keep run
**config** in `AgentChatPanel` and `buildAgentRequest`, where it already belongs.

## The design

Three parts. Parts 1 and 2 remove the two remount sources. Part 3 keeps the now-stable panel
correct as the revision changes underneath it.

### 1. Give the agent execution panel a stable mount identity

Stop keying the agent arm of `ExecutionItems` by the revision id. Key it by a token that stays
stable across a revision switch within one surface, is unique per panel, and differs per surface.

The right token is the **lineage/scope identity**, not the revision id and not a bare constant. A
bare constant collides the moment two agent panels render as siblings. Two candidates carry the
needed properties:

- The **artifact/variant lineage id** the revision belongs to. A commit creates a new revision in
  the same lineage; a manual pick selects another revision of the same variant. The lineage is
  stable across both and unique per panel.
- The **chat scope key** (`useChatScopeKey()`), which is the conversation's own identity:
  app-scoped in the main playground, `drawer:<id>` in the drawer. This reads as the most correct
  identity, but the app scope is shared if two agent panels ever sit side by side, so combine it
  with the lineage id to stay unique per panel.

`MainLayout` already computes `isAgentConfig` for the primary entity (`MainLayout/index.tsx:140`),
so it has the agent signal it needs to choose the key for the agent arm. Keep the change in
`MainLayout`: it is the smaller edit and keeps the package generic. Chat and completion arms keep
`key={variantId}` and their current behavior, so the blast radius on them is zero.

Net effect: a revision switch no longer changes the agent panel's key. `ExecutionItems`,
`AgentChatPanel`, and `AgentConversation` stay mounted; only the `entityId` prop changes.

### 2. Stop the splitter key from bouncing

Make `isAgentConfig` stable across a same-lineage revision switch so the `splitterKey` does not
flip while the new revision's flags load. Two ways, both acceptable:

- **Latch it.** Once the surface resolves as an agent lineage, keep `isAgentConfig` true for that
  lineage. A revision switch within an agent lineage never produces a non-agent revision, so the
  latch is safe.
- **Treat unresolved as unchanged.** While the new revision's flags are still loading, hold the
  previous `isAgentConfig` value instead of letting `workflowType` default to `"completion"`.

Either keeps the `Splitter` key steady through the switch, so the subtree no longer remounts from
this path. The splitter's real job stays intact: it still re-reads antd's `defaultSize` when the
layout genuinely changes between the agent (550px) and standard (50%) modes.

### 3. Read the revision id as a live prop at send time

With no remount, `AgentConversation` now receives a changing `entityId` prop. Today the transport
memoizes on `[entityId, sessionId]` (`AgentChatPanel.tsx:233-250`), so an entity change rebuilds
the transport. Recreating it mid-life is probably harmless, but read the latest id through a ref
inside `prepareSendMessagesRequest` and drop `entityId` from the memo deps:

```ts
const entityIdRef = useRef(entityId); entityIdRef.current = entityId
// transport memo deps: [sessionId] only; the closure calls buildAgentRequest(entityIdRef.current, …)
```

This gives the desired run semantics: an in-flight turn finishes against the revision it started
on, and the next send uses whatever revision is current. The run config stays where it belongs,
in `AgentChatPanel` and `buildAgentRequest`; only its read becomes live.

**Caveat to state plainly:** a **queued** message uses the revision that is current when the
message is **released** to the runner, not the revision that was current when it was typed. The
send reads `entityIdRef.current` at dispatch. This is the correct behavior for a
commit-then-continue conversation, but call it out so it is a decision, not a surprise.

`AgentConversation` is keyed by `session.id` in the `Tabs` items (`AgentChatPanel.tsx:1095-1101`),
so it does not remount on an `entityId` change. The `stop()`-on-unmount teardown
(`AgentChatPanel.tsx:450-454`) now fires only on a real session or tab close, which is correct.

Persisting on settle already happens (`AgentChatPanel.tsx:407-409`). Once the panel no longer
remounts, a lost transcript is impossible by construction, so keep that persist as cheap
defense-in-depth and add no "defer the switch until settled" gate. The commit effect can keep
calling `switchEntity` immediately; it now only repoints the config panel to the new revision and
is safe mid-stream.

## Surfaces this covers

- **Main playground, single view.** The primary target. Parts 1 and 2 keep the conversation
  mounted; part 3 keeps the config live.
- **Expanded create/edit drawer.** This surface uses the **same** render path: the drawer renders
  `PlaygroundMainView` (= `MainLayout`) in `full` view mode when expanded
  (`WorkflowRevisionDrawerWrapper/index.tsx:206-216`). Its `AgentChatScopeProvider`
  (`scope.tsx`, applied at `WorkflowRevisionDrawerWrapper/index.tsx:116`) only changes the session
  **storage scope** (`drawer:<id>`); it does **not** change the React mount key. So the drawer is
  **not** automatically unaffected: it remounts on a revision switch exactly like the main view.
  Because parts 1 and 2 live in `MainLayout`, the same code fixes the drawer too. Verify the drawer
  during QA rather than assuming it.
- **Config panel.** Keyed separately by `variant-config-${variantId}` (`MainLayout/index.tsx:256`),
  so it still tracks the revision and re-renders to the new version after a switch. The stable
  execution-panel key does not change this.
- **Comparison view.** Agents are a single arm: excluded from comparison rows and run-all
  (`generationSelectors.ts:610-613,639`). Two agents could technically be selected, but they
  already share one app-scoped session set, a pre-existing latent issue that is out of scope here.
  The fix targets single view.

## Blast radius

- **Touched:** `MainLayout/index.tsx` (agent execution-panel key, single view; stable
  `isAgentConfig` for the splitter key) and `AgentChatPanel.tsx` (entity id via ref in the
  transport). Both small.
- **Shared `ExecutionItems` key:** `key={variantId}` is shared by chat, completion, and agent. The
  change is scoped to the **agent arm only**; chat and completion keep `key={variantId}` and their
  current remount-on-switch behavior.
- **Config panel:** unchanged, still tracks the revision (separate key).
- **Other `AgentChatPanel` mounts:** the create/edit drawer is the same `MainLayout` path and is
  covered by parts 1 and 2 (see above).

## Risks

- **R1: entity-derived reads other than the transport.** Audit `AgentConversation` for any value
  captured once at mount from `entityId` that would now go stale. Today
  `simulatedAgentRunAtomFamily(entityId)` reads live via `useAtomValue`, and the session-scoped
  refs are fine; the transport is the only mount-captured `entityId` consumer (fixed by part 3).
  Re-verify at implement time.
- **R2: `references` across a mid-stream switch.** An in-flight turn keeps its starting revision;
  the next turn uses the new one. Confirm this is intended for commit-then-continue (it is: the
  run that performed the commit completes as itself).
- **R3: key uniqueness.** A too-broad key (a bare constant, or the app scope alone) collides if
  the surface ever hosts two agent panels. Use the lineage id (optionally combined with the scope
  key) so the key stays unique per panel.
- **R4: splitter regression.** Confirm the splitter still re-reads `defaultSize` on a genuine
  agent↔standard layout change after the `isAgentConfig` value is made stable.
- **R5: comparison regression.** Verify a non-agent comparison still keys by `variantId` (only the
  agent arm changes).

## Test plan

Unit and component tests with vitest + RTL, at the package and app layer. Follow the existing
`web/packages/agenta-playground/tests/unit/agentRequest.test.ts` style for the request builder.

- **T1 (A, transcript survives).** Mount the agent panel with a streaming, not-yet-persisted turn.
  Change the `entityId` prop. Assert `AgentConversation` does **not** remount (same instance) and
  the streamed messages remain in `messages`.
- **T2 (B, no teardown on switch).** With a stream in flight, change `entityId`. Assert `stop()` is
  **not** called and the stream/transport instance is preserved.
- **T3 (in-flight finishes on the old revision).** An already-started send completes against the
  revision it began with; assert that send issued `buildAgentRequest` with the **old** id.
- **T4 (next send uses the new revision).** After an `entityId` change with no remount, trigger a
  send and assert `buildAgentRequest` was called with the **new** id (ref read).
- **T5 (agent key is stable).** Render `MainLayout` single view with an agent entity; assert the
  execution-panel key does not change across a `variantId` change, while a chat/completion entity
  still keys by `variantId`.
- **T6 (splitter key does not bounce).** Simulate a switch where the new revision's flags are
  briefly unresolved; assert `splitterKey` stays constant (no `agent → std → agent` flip), so the
  `Splitter` does not remount.
- **T7 (config panel still remounts by revision).** Assert the config-panel key
  (`variant-config-…`) still changes with `variantId`, so the left panel re-renders to the new
  version.
- **T8 (expanded drawer).** Render the expanded drawer (same `MainLayout` path) with an agent
  entity; switch the revision and assert the conversation stays mounted, matching the main view.

## Live-QA plan (run later, when the dev stack is free)

Use `debug-local-deployment` (EE `--dev`, hotel-agent project) and a cheap model per the
QA-credit rule. Reproduce both symptoms before the fix, then re-run after.

- **QA-A (commit path).** Send a prompt that makes the agent call `commit_revision`. After the fix:
  the triggering turn's answer stays, the stream completes, and the config panel and header show
  the new version. Watch the network panel: the `/invoke` SSE must not abort and no fresh `/invoke`
  must replace it.
- **QA-B1 (manual switch, idle).** Have a multi-turn conversation, then pick a different version in
  the config header. After the fix: the same conversation stays mounted; only the next send targets
  the new revision.
- **QA-B2 (manual switch, mid-stream).** Start a long turn, switch the revision while it streams.
  After the fix: the in-flight turn finishes against its original revision; the next send uses the
  new one.
- **QA-C (no regression).** Repeat a revision switch on a completion app and a chat app; confirm
  their behavior is unchanged.
- **QA-D (expanded drawer).** Open the create/edit drawer, expand it, run an agent, switch the
  revision; confirm the conversation behaves like the main view.
- Cross-check container logs (`<project>-api-1`, `<project>-services-1`) and the Session Inspector
  streaming indicator (`setSessionStreaming`, `AgentChatPanel.tsx:281-287`) to confirm the live
  watcher survives the switch.
