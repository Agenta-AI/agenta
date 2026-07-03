# Research — agent-chat revision-switch bug

Read-only investigation. Commit `6fb263a671`, branch `gitbutler/workspace`, 2026-06-30.
No code or git changes were made. Live-stack observation was not needed to root-cause —
the two symptoms fall straight out of the render/state code below.

## TL;DR

Both symptoms have **one root cause**: the agent chat conversation subtree is mounted
**inside a host that React keys by the entity (revision) id**. Any revision switch — the
auto-switch after `commit_revision`, *or* a manual revision pick in the config header —
changes a host key and **remounts the whole conversation**. The remount (a) re-seeds the
transcript from localStorage, which is missing the mid-stream assistant output (persist is
skipped while streaming), and (b) runs the unmount teardown `stop()`, which aborts the
in-flight stream. There is no resume, so the live turn dies.

There are **two** host keys that change on a switch, not one (see "Two remount sources"
below): the direct `ExecutionItems key={variantId}`, and the `Splitter` key, which bounces
because the new revision momentarily resolves as non-agent while its flags load. The fix
must close both.

The chat's own identity (session id, message store) is **app-scoped and stable** across a
revision switch — the data is not actually lost from the store, only discarded by the
remount. That is why the owner's instinct is right: the real fix is to **decouple the chat
panel's mount identity from the entity id**, not to paper over the one switch caller.

## The render chain (where the key lives)

```
Playground.tsx
  └ providers.AgentGenerationPanel = AgentChatPanel        (Playground.tsx:86, 25-27)
  └ PlaygroundMainView                                     (Playground.tsx:95)
       └ layoutEntityIds.map(variantId =>
             <ExecutionItems key={variantId} entityId={variantId}/>)   ← REMOUNT KEY
                                                            (MainLayout/index.tsx:339-345)
            └ PlaygroundGenerations (isAgent branch)
                 └ <AgentGenerationPanel entityId={entityId}/>
                                       (ExecutionItems/index.tsx:52, 78-85)
                      └ AgentChatPanel({entityId})          (AgentChatPanel.tsx:1046)
                           └ Tabs items[].children =
                                <AgentConversation entityId sessionId/>  keyed by session.id
                                                            (AgentChatPanel.tsx:1089-1100)
```

- `layoutEntityIds = selectedEntityIds.length>0 ? selectedEntityIds : displayedEntities`
  (`MainLayout/index.tsx:116`). For an agent it is a single id = the open revision id.
- `ExecutionItems` is keyed by `variantId` (= that revision id) at `MainLayout/index.tsx:341`.
  **When the revision id changes, React unmounts the entire `ExecutionItems` subtree —
  including `AgentChatPanel` and every `AgentConversation` tab — and mounts a fresh one.**
- `AgentConversation` is itself keyed by `session.id` (the Tabs item key,
  `AgentChatPanel.tsx:1089-1100`), so *within* a stable panel mount it would NOT remount on
  an entity change. The remount is forced purely by the outer `key={variantId}`.

## What changes the entity id (the two switch callers)

`entityId` ultimately comes from `entityIdsAtom`. Two distinct callers mutate it through the
same `switchEntity → setEntityIds` chokepoint:

1. **Auto-switch after commit** (the #4936 path).
   `AgentChatPanel.tsx:416-431`: an effect scans messages for a `data-committed-revision`
   part and, on first sight, calls
   `switchEntity({currentEntityId: entityId, newEntityId: data.revisionId})`.
   This fires **mid-stream** (the commit part arrives while the turn is still streaming).

2. **Manual revision/version pick** in the config header.
   `PlaygroundVariantConfig/assets/PlaygroundVariantConfigHeader.tsx:133-143` →
   `handleSwitchVariant` → `switchEntity({currentEntityId, newEntityId: value})`, wired to the
   version dropdown `onChange` (`:182`). This is an **independent caller** that the
   `AgentChatPanel` commit effect knows nothing about.

Both funnel through:
- `switchEntityAtom` — `playgroundController.ts:2296-2308` → `set(setEntityIdsAtom, updated)`.
- `setEntityIdsAtom` — `playgroundController.ts:1875+` — rewrites `playgroundNodesAtom`, so
  `entityIdsAtom` → `layoutEntityIds` → `variantId` changes → the `ExecutionItems` key changes.

## Symptom A — chat history loss (commit path)

Sequence when the agent commits a new revision of itself mid-turn:

1. Turn is streaming. `status === "streaming"`, so the persist effect is **skipped**:
   `AgentChatPanel.tsx:404-407` (`if (status === "streaming") return`). The assistant's
   mid-stream output is **never written** to `sessionMessagesAtom`.
   (The *user* message was persisted earlier, during the `"submitted"` phase, so it survives.)
2. The `data-committed-revision` part arrives. The effect at `:416-431` calls `switchEntity`.
3. `entityId` changes → `ExecutionItems` key changes → the conversation **remounts**.
4. On mount, `AgentConversation` seeds its messages **once** from storage:
   `const [initialMessages] = useState(() => store.get(sessionMessagesAtom)[sessionId] ?? [])`
   (`AgentChatPanel.tsx:201`, fed to `useChat({messages: initialMessages})` at `:261`).
   Storage has the user turn but **not** the streamed answer (step 1).
5. Result: the triggering turn's assistant output is gone after the switch.

## Symptom B — "connection lost" on entity switch (new symptom)

There is **no literal "connection lost" string** anywhere in the chat slice, playground,
runner, or API (grepped). It is the owner's description of the visible failure: the live
turn dies and the panel shows a dropped/failed run.

Mechanism, same remount:

- The unmount runs the **D9 teardown** `stop()`:
  `AgentChatPanel.tsx:444-451` (`useEffect(() => () => stop(), [sessionId, stop])`). `stop()`
  aborts the in-flight `useChat` fetch/reader.
- The fresh mount builds a **new** `useChat` + transport (`AgentChatPanel.tsx:230-271`) seeded
  from storage. It does **not** resume the aborted client stream, and there is no
  server-run reattach on this path (the SSE/NDJSON stream is per-fetch; the only reattach
  mechanism is the Session Inspector's coordination-plane attach, which the inline chat does
  not use — see the `setSessionStreaming` note at `:277-284`). The server-side run may keep
  executing, but the browser has stopped listening, so the answer never lands.
- The aborted fetch raises an `AbortError`, surfaced through `onError`
  (`AgentChatPanel.tsx:266-271`) → `parseAgentRunError` (`:103-126`) → the inline error-bubble
  effect (`:374-401`). On the commit path this races the unmount (the old instance's
  `setMessages` is a no-op once unmounted); on the **manual** path the user is on a live panel
  and sees the failed/aborted turn directly.

**Key point:** the manual-switch path (caller 2) hits B with no involvement from the commit
effect. A turn that is streaming when the user switches the revision is always torn down.
Even with **no** active stream, a manual switch still remounts the conversation (re-seed,
scroll reset, fresh `useChat`) — brittle and user-visible.

So A and B are the **same remount**, seen from two angles: A = transcript re-seeded without
the unpersisted output; B = the in-flight stream aborted and not resumed.

## Why the data is not really lost (the decouple is viable)

The conversation's identity and store are **independent of the entity id**:

- Sessions, open tabs, and the active tab are keyed by a **scope key = app id**
  (`defaultScopeKeyAtom = routerAppId || "__global__"`, `state/sessions.ts:47`), not by the
  revision id. A revision switch does not change the scope.
- Messages are keyed by the **globally-unique session id**, with **no scope/entity
  dimension** (`sessionMessagesAtom`, `state/sessions.ts:88-93`).
- So after a revision switch the same session, tabs, and persisted messages still resolve.
  Only the React remount throws away the live (unpersisted, streaming) state.

The entity id is consumed purely as **per-run config/routing**, read fresh at send time:

- `buildAgentRequest(entityId, messages, {sessionId})` reads `invocationUrl`,
  `configuration`, `references`, dirty-state, etc. from the store **on each send**
  (`agentRequest.ts:294-394`). Nothing about a send needs the component to have remounted
  when the entity changed — it only needs the **latest** entity id at send time.
- The transport closes over `entityId` via `useMemo(..., [entityId, sessionId])`
  (`AgentChatPanel.tsx:230-247`). Today that recreates the transport on an entity change; a
  decoupled panel would instead read the latest id via a ref so the closure stays current
  without churn.

## Two remount sources (both must be fixed)

A switch changes **two** host keys, and either one alone remounts the conversation.

1. **`ExecutionItems key={variantId}`** — the runs-panel single-view map
   (`MainLayout/index.tsx:342`, the map at `:339-345`). The revision id is the key, so the
   execution subtree remounts directly.
2. **The `Splitter` key bounces.** The key is
   `splitterKey = `${isComparisonView ? "comparison" : "single"}-${isAgentConfig ? "agent" : "std"}``
   (`MainLayout/index.tsx:143`), applied to the `Splitter` at `MainLayout/index.tsx:224`. It
   derives from `isAgentConfig = useAtomValue(isAgentModeAtomFamily(primaryConfigId))`
   (`MainLayout/index.tsx:140`), which is `workflowType(entityId) === "agent"`
   (`selectors.ts:1253-1258`). During a switch the new revision's flags have not loaded yet, so
   `workflowType` falls through its branch list to the default `return "completion"`
   (`agenta-entities/src/workflow/state/molecule.ts:368-382`). The new revision then looks
   non-agent for a beat, `isAgentConfig` flips `agent → std → agent`, the `splitterKey` changes,
   and the `Splitter` that wraps **both** the config and runs panels remounts the whole subtree —
   conversation included. So keying only `ExecutionItems` is not enough; the splitter key must be
   made stable too (latch `isAgentConfig`, or hold the previous value while flags are unresolved
   rather than defaulting to completion).

## Blast radius facts for the decouple

- The `key={variantId}` at `MainLayout/index.tsx:342` is the host for **all three arms**
  (chat / completion / agent via the `isAgent` branch in `ExecutionItems/index.tsx:69-101`).
  Changing it unconditionally would also change chat/completion remount behavior, so scope the
  change to the agent arm.
- The **config panel** is keyed **separately**: `key={`variant-config-${variantId}`}`
  (`MainLayout/index.tsx:256`). It is independent of the execution-panel key, so the config
  panel will still re-render to the new revision after a switch even if the execution panel's
  key is made stable. Good — decoupling the chat does not break the config view updating.
- **The expanded create/edit drawer is the SAME render path, not a separate one.** The drawer
  renders `PlaygroundMainView` (= `MainLayout`) in `full` view mode when expanded
  (`WorkflowRevisionDrawerWrapper/index.tsx:206-216`). Its `AgentChatScopeProvider`
  (`AgentChatSlice/state/scope.tsx`, applied at `WorkflowRevisionDrawerWrapper/index.tsx:116`)
  only sets a distinct session **storage scope** (`drawer:<id>`) so the drawer and the main
  playground do not share tabs/history; it does **not** change the React mount key. So the
  drawer remounts on a revision switch exactly like the main view, and "the drawer is
  unaffected" is **wrong**. Because both remount sources live in `MainLayout`, the same fix
  covers the drawer — but it must be QA'd, not assumed.
- Agents are effectively a **single-entity arm**: they are excluded from comparison execution
  rows and run-all fan-out (`generationSelectors.ts:606-613, 639`), and the execution header
  is hidden for them (`ExecutionHeader/index.tsx:96-110`). `isComparisonView` is only
  `ids.length > 1` (`displayedEntities.ts:171-173`), so two agents *could* technically be
  selected, but that already shares the one app-scoped session set across both panels — a
  pre-existing latent issue, out of scope here. The fix should target single view.
- `isAgentMode(entityId)` = `workflowType(entityId) === "agent"` (`selectors.ts:1253-1258`).
  `MainLayout` already computes `isAgentConfig` for the primary entity
  (`MainLayout/index.tsx:138-143`) and folds it into the splitter key — so MainLayout already
  has the agent signal needed to choose a stable key for the agent execution panel.

## Files referenced

- `web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx`
- `web/oss/src/components/AgentChatSlice/state/sessions.ts`
- `web/oss/src/components/AgentChatSlice/state/scope.tsx`
- `web/oss/src/components/WorkflowRevisionDrawerWrapper/index.tsx`
- `web/packages/agenta-entities/src/workflow/state/molecule.ts`
- `web/oss/src/components/AgentChatSlice/assets/AgentChatTransport.ts`
- `web/oss/src/components/Playground/Playground.tsx`
- `web/oss/src/components/Playground/Components/MainLayout/index.tsx`
- `web/oss/src/components/Playground/Components/PlaygroundVariantConfig/assets/PlaygroundVariantConfigHeader.tsx`
- `web/packages/agenta-playground-ui/src/components/ExecutionItems/index.tsx`
- `web/packages/agenta-playground/src/state/controllers/playgroundController.ts`
- `web/packages/agenta-playground/src/state/execution/agentRequest.ts`
- `web/packages/agenta-playground/src/state/execution/selectors.ts`
- `web/packages/agenta-playground/src/state/execution/generationSelectors.ts`
- `web/packages/agenta-playground/src/state/execution/displayedEntities.ts`
- Prior context: `docs/design/agent-workflows/scratch/pr-4936-followup/04-chat-history-loss.md`
</content>
</invoke>
