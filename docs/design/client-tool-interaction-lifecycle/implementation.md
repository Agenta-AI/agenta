# Implementation: slices, anchors, and traps

This is the technical companion to [plan.md](plan.md). The plan says what changes and why in
plain language. This file says which files change, in which order, and what will bite.

Everything below was checked against the working tree on 2026-08-10, on top of the tip of
release/v0.112.0. Where the plan or the research no longer matches the code, the correction is
recorded here and repeated in [Plan corrections](#plan-corrections). Neither plan.md nor
research.md is edited.

## Code reality check

### 1. The interaction row. Confirmed, and no migration is needed

The table is `session_interactions`, declared at
`api/oss/src/dbs/postgres/sessions/interactions/dbes.py:14`. The kinds and statuses in the plan
are exact: `api/oss/src/core/sessions/interactions/dtos.py:10-22` declares
`user_approval | user_input | client_tool` and `pending | responded | resolved | cancelled`.

The outcome column already exists. It is not a column of its own. It is the `resolution` key
inside the JSON `data` blob, declared at `dtos.py:48` (`SessionInteractionData.resolution`) and
written by a JSONB merge at
`api/oss/src/dbs/postgres/sessions/interactions/dao.py:105-118`, which preserves the rest of
`data` while adding the answer. The web side already declares the same key at
`web/packages/agenta-entities/src/session/core/schema.ts:69`, and nothing in the repo reads it
yet. So the plan's "no database migration" constraint holds with room to spare.

One useful side fact: `actionable_only` filters on `status == "pending"` only
(`dao.py:213-217`). A row that goes to `responded` therefore drops out of the mobile inbox and
the desktop activity badge for free, with no extra work.

### 2. The sweep. Confirmed, and it is two sweeps, not one

The one the plan means is the turn-start sweep. The runner calls it at
`services/runner/src/sessions/interactions.ts:188` (`cancelStaleInteractions`), fired from
`services/runner/src/server.ts:494`. It reaches
`api/oss/src/apis/fastapi/sessions/router.py:915`, then
`api/oss/src/core/sessions/interactions/service.py:97`, then the SQL at
`api/oss/src/dbs/postgres/sessions/interactions/dao.py:151-172`.

The SQL filters on `SessionInteractionDBE.status == "pending"` at `dao.py:157`. Nothing else.
A row already at `responded` is invisible to it. Change 1 is therefore race-safe by ordering
exactly as the plan claims, and the sweep needs zero edits.

There is a second, narrower sweep the plan does not mention: the orphaned-gate reconciliation in
the records worker at `api/oss/src/tasks/asyncio/sessions/records_worker.py:96-148`. It calls the
same DAO function but scoped with `only_turn_id`, so it only closes gates of a turn that already
reached its terminal record. It also filters on `pending` (same line, `dao.py:157`), so it is
equally harmless to a `responded` row. Worth knowing because it is the sweep that can fire
milliseconds after a turn ends, and it is the one the runner's own comment at
`services/runner/src/engines/sandbox_agent/run-turn.ts:665-672` is racing.

### 3. The interactions API. Corrected: there are three guards, not one

The guard the brief points at is real and is at
`api/oss/src/apis/fastapi/sessions/router.py:891-895`:

```python
if source.kind != SessionInteractionKind.user_approval:
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Resolution is only valid for user approval interactions",
    )
```

But two more guards block Change 1, and both are in the request model, not the router.

`api/oss/src/apis/fastapi/sessions/models.py:130-134` declares the resolution payload as
approval-shaped and closed:

```python
class SessionInteractionResolution(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verdict: Literal["approved", "denied"]
    tool_call_id: str
```

A form answer or a connection result cannot be expressed in that shape, and `extra="forbid"`
rejects anything else.

`api/oss/src/apis/fastapi/sessions/models.py:144-152` then refuses a resolution on any status
except `resolved`:

```python
if self.resolution is not None and self.status != SessionInteractionStatus.resolved:
    raise ValueError("resolution is only valid when status is resolved")
```

Change 1 wants one call that writes `responded` and the outcome together. Two calls would
reopen the exact race the plan closes, because the row sits at `pending` between them. So this
validator has to accept a resolution on the `responded` edge as well.

Below the router, nothing blocks. The service passes the transition through unchanged
(`api/oss/src/core/sessions/interactions/service.py:78-95`) and the DAO already allows the
`pending -> responded` and `responded -> resolved` edges through the CAS at
`api/oss/src/dbs/postgres/sessions/interactions/dao.py:125`
(`status.in_(("pending", "responded"))`). The JSONB merge at `dao.py:105-118` writes the
resolution regardless of which status accompanies it.

The existing behavior is pinned by
`api/oss/tests/pytest/unit/sessions/test_transition_interaction_resolution.py`, which builds an
approval row and asserts the resolution reaches the domain transition. That test stays valid;
it needs siblings for the other two kinds.

### 4. Corrected: the browser has no write path to the interactions API at all

This is the biggest correction in the file, and it changes how Change 1 has to be built.

The plan says "the approval card already works this way. We extend its pattern; we invent
nothing." That is true of the mobile app and false of the desktop web app.

- Mobile answers approvals through the interactions plane:
  `web/mobile/src/features/chat/useApprovalActions.ts:111` calls `respondInteraction`, which
  reaches `api/oss/src/apis/fastapi/sessions/router.py:992`. That endpoint flips the row to
  `responded` at `router.py:1035-1043` and then dispatches the resume server-side.
- Desktop answers approvals in band, through the message stream. It never calls the
  interactions API to write anything. `web/packages/agenta-entities/src/session/api/api.ts`
  exports `queryInteractions` (line 108), `fetchInteraction` (line 143) and `respondInteraction`
  (line 189), and the desktop chat uses only `queryInteractions`, from
  `web/packages/agenta-entities/src/session/state/interactionStatus.ts:33`. There is no
  `transitionInteraction` wrapper in the entities layer at all, although the generated Fern
  client has the route at
  `web/packages/agenta-api-client/src/generated/api/resources/sessions/client/Client.ts:715`.

What actually moves the desktop's approval rows off `pending` is the runner. It calls
`resolveInteraction` (`services/runner/src/sessions/interactions.ts:153`) from
`run-turn.ts:642` and `run-turn.ts:683`, keyed by the interaction token that the browser echoes
back inside the approval envelope. The SDK stamps that token at
`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:239` (from `part.approval.id`) and
`messages.py:277`, and the runner reads it back through
`services/runner/src/responder.ts:405` (`extractInBandApprovalAnswers`) and
`services/runner/src/permission-plan.ts:62`.

So Change 1's web half is new construction, not an extension: a `transitionInteraction` wrapper
in `web/packages/agenta-entities/src/session/api/api.ts`, called from the desktop chat before
the resume goes out. The server half is small because the endpoint exists.

### 5. Client-tool delivery. Confirmed never resolved, and "resolve on consume" costs more than the plan assumes

`services/runner/src/engines/sandbox_agent/client-tools.ts` creates the row and never settles
it. The create is `recordPendingInteraction(request.id, request.toolName, request.input,
"client_tool")` at `client-tools.ts:298-303`, inside `buildClientToolRelay` (declared at
`client-tools.ts:242`). Grep confirms `resolveInteraction` has exactly three call sites
(`run-turn.ts:642`, `run-turn.ts:683`, and its own declaration), all on the approval path.
No client-tool row is ever transitioned by anyone. The release gate already records this: the
docstring of `.agents/skills/agent-release-gate/resources/matrix_l4_client_tool_lifecycle.py`
observes that a fulfilled client tool still stores as `cancelled` and deliberately asserts only
that no row is left `pending`.

The natural place to resolve on consume is `client-tools.ts:266`, where the responder returns
`verdict.kind === "fulfilled"`. That is the exact moment the browser's answer reaches the
harness, and `resolveInteraction` already exists one import away.

The problem is the key. The row's token is `request.id`, the relay's interaction id
(`services/runner/src/tools/client-tool-relay.ts:13-16`). On the resume turn the stored output
is looked up by `approvedCallKey(name, args)`, not by token
(`services/runner/src/responder.ts:440`, `extractClientToolOutputs`), and the relay mints a fresh
`request.id` for the re-raised call. So at the consume point the runner does not know which row
it just satisfied. Approvals dodge this only because the token rides inside the approval
envelope, and the SDK stamps that token onto approval envelopes only. The client-tool branch at
`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:200-209` carries no token.

Making resolve-on-consume work therefore means a new field through three layers: the browser
stamps the token into the client-tool output, `messages.py` passes it through, and
`client-tools.ts` reads and strips it before handing the output to the model. The API cannot do
it instead, because the API never parses tool result blocks; the resume reaches the runner as an
opaque message list.

**Recommendation: do not build resolve-on-consume in this project.** Treat `responded` plus a
saved resolution as the durable settled state for `user_input` and `client_tool`, and leave
`resolved` as the approval-only edge. Nothing user visible depends on the distinction: Change 2
reads the resolution payload, not the status name, and `actionable_only` already excludes
`responded`. The cost is three layers of new plumbing for a status word nobody renders. If a
reviewer insists, the build is specified above and is a self-contained follow-on slice.

One small runner change is still worth doing, and it belongs in Slice A. Today client-tool rows
carry no `data.request.tool_call_id`, because `recordPendingInteraction` is called with four
arguments at `client-tools.ts:298-303` while the underlying builder accepts a fifth
(`buildInteractionData(request, tool, args, toolCallId)` at
`services/runner/src/sessions/interactions.ts:71`, and the run-turn closure at
`run-turn.ts:598-604` takes `toolCallId`). Passing `correlatedId` there, and widening the
callback type at `client-tools.ts:221-226`, gives the browser a deterministic way to match a row
to a rendered card. Without it the only join key is the empirical claim documented at
`web/packages/agenta-entities/src/session/state/interactionStatus.ts:14-17`, that the row token
equals the record's `toolCallId`. That claim was verified once against one live row. It is
structurally true only when `toolCallIndex.lookup` misses and `correlatedId` falls back to
`request.toolCallId`, and `request.id` happens to equal `request.toolCallId`. It is not a
contract. Legacy rows still need the fallback, so keep both.

### 6. Replay. Corrected: the two copies are already NOT byte-identical

Both files exist:

- `web/oss/src/components/AgentChatSlice/assets/transcriptToMessages.ts`, 504 lines,
  md5 `bfa18c1b008ebd8aa9074d7987919ed7`.
- `web/packages/agenta-chat/src/assets/transcriptToMessages.ts`, 512 lines,
  md5 `547dd832b3defdb664ba0e1eeb964af8`.

`diff` reports 58 changed lines, and three of the differences are behavioral, not cosmetic:

1. The approval sentinel is matched by equality in the OSS copy
   (`transcriptToMessages.ts:101-104`) and by prefix in the package copy
   (`agenta-chat/src/assets/transcriptToMessages.ts:118-124`).
2. The OSS copy emits a `data-approval-manifest` sibling part at
   `transcriptToMessages.ts:323-335`. The package copy has no equivalent, so a replayed
   approval card there loses its manifest body.
3. The OSS default branch covers `attachment_delivery`
   (`transcriptToMessages.ts:400`); the package copy does not
   (`agenta-chat/.../transcriptToMessages.ts:408`).

Their `loadSession.ts` siblings have drifted too
(`web/oss/src/components/AgentChatSlice/assets/loadSession.ts` md5 `77ec1fcf…` against
`web/packages/agenta-chat/src/assets/loadSession.ts` md5 `209e1ea1…`).

So the instruction "keep them byte-identical" cannot be honored, because they never were. The
workable rule is narrower and is what Slice B adopts: **the precedence logic must be identical
in both copies, and the pre-existing divergences above must be left untouched.**

The precedence rule has exactly one landing site in each copy, and it is already the only place
row data touches the transcript. `applyCancelledInteractions` is at
`transcriptToMessages.ts:132-143` in OSS, called at line 483, and at
`agenta-chat/.../transcriptToMessages.ts:153-164`, called at line 491. Its body already encodes
rule 1 implicitly:

```ts
if (part.state !== "input-available") continue          // a tool_result already settled it
if (!cancelledClientToolTokens.has(toolCallId)) continue
part.state = "output-available"
part.output = CANCELLED_CLIENT_TOOL_OUTPUT[partToolName(part)] ?? {}
```

Rule 3 is the bug: `CANCELLED_CLIENT_TOOL_OUTPUT` (OSS lines 124-127) synthesizes
`{connected: false, reason: "cancelled"}` and `{action: "cancel"}`, which is what produces
"Dismissed the request." at
`web/oss/src/components/AgentChatSlice/components/clientTools/ElicitationWidget.tsx:254-259`
and "Connection not completed" with a Retry button at
`web/oss/src/components/AgentChatSlice/components/clientTools/ConnectToolWidget.tsx:99-118`.
That is the code that guesses abandonment. It must become a neutral terminal state instead.

The row fetch that feeds it is `fetchCancelledClientToolTokensAtom` at
`web/packages/agenta-entities/src/session/state/interactionStatus.ts:47`, which today returns a
`Set` of cancelled tokens only (`interactionStatus.ts:32-38`). Rule 2 needs the resolution
payload and the status, so this atom must return a map keyed by token, not a set. Its two
callers are `web/oss/src/components/AgentChatSlice/assets/loadSession.ts:47-61` and
`web/packages/agenta-chat/src/assets/loadSession.ts:55-76`.

### 7. Adoption. Confirmed, with a precise landing site

`web/oss/src/components/AgentChatSlice/hooks/useSessionHydration.ts` has four adoption paths and
one adoption function: `adoptServerTranscript` at line 111. The decision is
`shouldAdoptServerTranscript({...})` at lines 115-122, and the replacement is
`setMessages(serverMsgs)` at lines 137-139. The four triggers are the cache-miss effect
(line 166), the revalidate-on-open effect (line 220), the remote-run poll (line 249), and the
push relay `refreshFromRecords` (line 292).

There is already a guard of exactly the right shape: `shouldSkipRecordsRefresh` at line 40,
which is `busy || pendingResume`, applied both before the fetch (lines 296-302) and again after
it (lines 312-318) because a settle can land mid-flight. `pendingResume` is the caller's
`liveGateInteractionRef`, set in
`web/oss/src/components/AgentChatSlice/hooks/useAgentChatSession.ts:217` and `:227` and cleared
at `:158`. Change 3's rule is the same idea widened from "an answer is in flight" to "a card is
waiting".

Put the rule in `useSessionHydration.ts`, not in the shared
`web/packages/agenta-entities/src/session/core/transcriptAdoption.ts`. The shared
`shouldAdoptServerTranscript` (line 28) is also called by
`web/mobile/src/features/chat/transcriptAdoption.ts:28` with `busy: false` hardcoded, and mobile
cannot answer form or connect cards at all, so a rule about pending cards would be dead weight
there and would need mobile-side inputs it does not have.

The row-change event exists and the desktop does not listen to it. The contract is at
`api/oss/src/dbs/redis/sessions/contract.py:99` and `:105`
(`WATCH_EVENT_INTERACTION = "interaction"`), the publisher is
`api/oss/src/dbs/redis/sessions/watch.py:93`, and it fires from
`api/oss/src/core/sessions/interactions/service.py:56-60` (create, `pending`), `:90-94`
(transition, `resolved`) and `:113-118` (cancel sweep, `resolved`). The SSE endpoint is
`api/oss/src/apis/fastapi/sessions/router.py:547` and the frame is formatted at
`api/oss/src/apis/fastapi/sessions/watch.py:96`. Mobile subscribes at
`web/mobile/src/features/chat/useSessionWatch.ts:110`.

The desktop's subscription belongs in the handler map at
`web/oss/src/components/AgentChatSlice/hooks/useSessionRecordsWatch.ts:31-34`, which currently
registers `ready` and `records-changed` only. The generic transport underneath
(`web/oss/src/hooks/useProjectWatch.ts:19`, `useWatchEventSource`) already fans out arbitrary
named events, so this is a one-key addition plus a handler. Note the effect dependency
`eventNamesKey` at `useProjectWatch.ts:30`: adding an event key recreates the EventSource, which
is fine once at mount but must not be computed from changing data.

The payload carries only `{type, session_id, status}`, so the handler cannot know which card
changed. That matches the plan: refetch the rows, do not try to patch one card.

### 8. The dock. Confirmed last-message-only, and the connect card has no buttons of its own

`web/oss/src/components/AgentChatSlice/components/InteractionDock.tsx:40-52`:

```ts
export const getPendingConnectInteraction = (messages: UIMessage[]): ClientToolMeta | null => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== "assistant") return null
```

It is gated again by the caller at
`web/oss/src/components/AgentChatSlice/AgentConversation.tsx:351-354`. The buttons it owns are
Cancel (line 117), Not now (line 120) and Connect/Retry (lines 121-130), all driven by
`useConnectFlow(meta, settle, active)` at line 83.

The inline connect card renders no buttons at all. Its pending branch at
`web/oss/src/components/AgentChatSlice/components/clientTools/ConnectToolWidget.tsx:133-141` is a
passive "waiting for your response below" marker. That single fact is the dead-card bug.

The move is cheap because the machinery is already shared. `useConnectFlow`
(`web/oss/src/components/AgentChatSlice/components/clientTools/useConnectFlow.ts`) is a
standalone hook whose module docstring at lines 1-27 already states the two-surface contract,
and double settling is guarded by `settledRef` plus `meta.settled` at lines 210 and 264. The
dock's settle mapping at `InteractionDock.tsx:65-82` is a copy of the canonical one at
`web/oss/src/components/AgentChatSlice/components/clientTools/ClientToolPart.tsx:43-60`, with a
comment saying so. The form card is the working precedent: `ElicitationWidget.tsx` already owns
its own Accept, Decline and Dismiss buttons at lines 370-409.

The whole-chat scan model to follow is `AgentConversation.tsx:371-390` (`anyPendingInteraction`,
from PR #5913). The remaining last-message-only scans, in the order they matter:

| Where | What it decides |
|---|---|
| `InteractionDock.tsx:41` | whether the connect dock renders, and on which tool call |
| `web/packages/agenta-playground/src/state/execution/agentMessageQueue.ts:48-49` (`isHitlPending`) | the message-queue hold, the composer waiting state, and `AgentConversation.tsx:620` |
| `web/oss/src/components/AgentChatSlice/components/ApprovalDock.tsx:55` (`getPendingApprovals`) | which approval gates the approval dock shows |
| `web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts:134-141` | whether the resume is dispatched after a settle |
| `AgentConversation.tsx:620` | the per-turn "waiting for you" affordance |
| `web/oss/src/components/AgentChatSlice/components/clientTools/meta.ts:70` | whether an unregistered parked client tool renders its auto-settling fallback |

The package mirrors the same logic and would keep the defect if only `web/oss` is fixed:
`web/packages/agenta-chat/src/model/approvals.ts:30`,
`web/packages/agenta-chat/src/hooks/useAgentChatQueue.ts:80`,
`web/packages/agenta-chat/src/hooks/useAgentConversation.ts:360`.

The `meta.ts:70` case is deliberately left alone: it guards the auto-settling "not handled"
fallback, and widening it to the whole chat would auto-settle old parked parts. It is listed so
the next reader knows it was considered.

### 9. The registry fallthrough. Confirmed, one line, plus one test to invert

`web/oss/src/components/AgentChatSlice/components/clientTools/registry.tsx:52`:

```ts
if (meta.renderKind !== undefined) return BY_RENDER_KIND[meta.renderKind] ?? null
```

The `?? null` makes the `toolName` fallback on line 53 unreachable whenever any render kind
string is present, including an unknown one. The consequence chain is
`registry.tsx:58-59` (`hasClientToolHandler` false) to `meta.ts:67-71` to
`ClientToolPart.tsx:41` falling back to `UnhandledClientTool`, which auto-settles the run as
`not_handled` at `UnhandledClientTool.tsx:20`.

Two things the research does not mention. First, the current behavior is pinned by a test that
must be inverted, not just updated:
`web/oss/src/components/AgentChatSlice/components/clientTools/meta.test.ts:86-89`, named "does
not reinterpret an explicit unknown render kind by tool name". Second, the package copy never
took this change and is still correct
(`web/packages/agenta-chat/src/skin/registry.ts:58-65`), so the fix restores parity rather than
creating it.

### 10. Corrected: the tool-name list exists four times, not twice

| Where | Symbol | Purpose |
|---|---|---|
| `web/oss/src/components/AgentChatSlice/components/clientTools/registry.tsx:45-48` | `BY_TOOL_NAME` | name to React widget |
| `web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts:79` | `CLIENT_TOOL_NAMES` | queue hold and auto-resume policy |
| `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolPermission.ts:127` | `CLIENT_TOOLS` | never auto-allowable in the permission gate |
| `transcriptToMessages.ts:124-127` in both copies | `CANCELLED_CLIENT_TOOL_OUTPUT` | replay's synthesized terminal output |

Two more single-name hardcodes sit on the same axis: `InteractionDock.tsx:33`
(`meta.renderKind === "connect" || meta.toolName === "request_connection"`) and the render-kind
keys at `registry.tsx:37-40`.

The import hierarchy is `shared <- ui <- entities <- entity-ui <- playground <- playground-ui`
(`web/AGENTS.md:444-447` and `.agents/skills/agenta-package-practices/SKILL.md:38-41`). The only
node all four consumers can reach is `@agenta/shared`, and all four already depend on it. So the
shared source is a React-free descriptor in `web/packages/agenta-shared`, exporting the tool
names and their render kinds. The widget map at `registry.tsx:45-48` stays in the app layer and
keys off the shared constants, because it holds React components.

### 11. Tests and gates. Confirmed

API tests are split into `api/oss/tests/pytest/unit/`, `.../integration/` and
`.../acceptance/`. The interaction unit tests live in `api/oss/tests/pytest/unit/sessions/`
(`test_transition_interaction_resolution.py`, `test_respond_interaction_enqueue.py`,
`test_interactions_transition_update.py`, `test_orphaned_gate_reconciliation.py`). Acceptance
tests that hit a live stack live in `api/oss/tests/pytest/acceptance/sessions/`, and they mint
accounts through the fixtures in `api/oss/tests/pytest/utils/accounts.py`.

Gate scripts are standalone `uv run` scripts under
`.agents/skills/agent-release-gate/resources/`, each with a PEP 723 header, a long docstring
that states the tier and what it pins, and imports from `qa_matrix_lib`
(`agent_config`, `create_workflow`, `interactions`, `invoke`, `refs`, `seed_and_baseline`,
`user_msg`). `matrix_l4_client_tool_lifecycle.py` is the closest model and already contains the
defect statement this project fixes, so it must be updated in the same slice.

Replay tests already exist in both copies:
`web/oss/src/components/AgentChatSlice/assets/transcriptToMessages.test.ts` and
`web/packages/agenta-chat/tests/unit/assets/transcriptToMessages.test.ts`. The adoption guard
has `web/oss/src/components/AgentChatSlice/hooks/useSessionHydration.test.ts`.

## The slice map

Build order is dependency order. Each slice ships on its own and leaves the product working.

### Slice A: record the answer first

Change 1. Everything else reads the state this creates.

**API**

- `api/oss/src/apis/fastapi/sessions/models.py:130-134`: widen the resolution payload so a form
  answer and a connection result fit. Keep the approval shape valid and keep it strict for
  `user_approval`; the other kinds need an open dictionary.
- `api/oss/src/apis/fastapi/sessions/models.py:144-152`: allow a resolution on the `responded`
  edge as well as `resolved`, so one call records both.
- `api/oss/src/apis/fastapi/sessions/router.py:891-895`: replace the approval-only kind guard
  with a per-kind check that accepts `user_input` and `client_tool`.
- No service, DAO, migration, or sweep change. `service.py:78-95` and `dao.py:92-135` already
  do the right thing.

**Runner**

- `services/runner/src/engines/sandbox_agent/client-tools.ts:298-303`: pass `correlatedId` as
  the tool-call id, and widen the callback type at `client-tools.ts:221-226` to accept it, so
  new `client_tool` rows carry `data.request.tool_call_id`.

**Web**

- `web/packages/agenta-entities/src/session/api/api.ts`: add a `transitionInteraction` wrapper
  over the existing generated route, in the style of `respondInteraction` at line 189.
- `web/oss/src/components/AgentChatSlice/hooks/useAgentChatSession.ts:225-240`
  (`handleClientToolOutput`): before `addToolOutput`, fire the transition to `responded` with
  the outcome. It must not block the resume: on failure, log and continue, which is exactly
  today's behavior.
- The card widgets need the row token to name what they are answering. Resolve it from the
  rows the browser already fetches (see Slice B's map), matching on
  `data.request.tool_call_id` first and falling back to `token == toolCallId` for legacy rows.

**Acceptance check.** On a live stack, answer a form card and a connect card, then let a new
turn start. Query `/sessions/interactions/query` for the session. Both rows read `responded`
with the answer under `data.resolution`, and neither reads `cancelled`.

**Traps.** The API container's hot reload wedges on edits of this shape; when the endpoint stops
responding, hard restart the container rather than waiting for the reloader. The runner change
means the services container needs a restart. Do not split the transition into two calls
(status, then resolution): the row sits at `pending` between them and the sweep can win.
`ruff format` then `ruff check --fix` in `api/` before committing, and `pnpm lint-fix` in
`web/`.

### Slice B: one rule for what replay shows

Change 2. Depends on Slice A only for rule 2 to have data; the other three rules are
implementable and testable immediately.

- `web/packages/agenta-entities/src/session/state/interactionStatus.ts:27-62`: return a map from
  token to `{status, kind, resolution, toolCallId}` instead of a set of cancelled tokens. Keep
  the best-effort contract, including the empty-result-on-failure behavior at lines 57-60, and
  keep the 15 second stale time.
- `web/oss/src/components/AgentChatSlice/assets/loadSession.ts:47-61` and
  `web/packages/agenta-chat/src/assets/loadSession.ts:55-76`: thread the map through.
- `web/oss/src/components/AgentChatSlice/assets/transcriptToMessages.ts:132-143` and
  `web/packages/agenta-chat/src/assets/transcriptToMessages.ts:153-164`: rewrite
  `applyCancelledInteractions` into the four-rule precedence. Rule 1 is the existing
  `part.state !== "input-available"` skip and stays. Rule 2 renders the saved outcome. Rule 3
  replaces `CANCELLED_CLIENT_TOOL_OUTPUT` (lines 124-127 in both) with a neutral terminal
  marker. Rule 4 is doing nothing.
- `web/oss/src/components/AgentChatSlice/components/clientTools/ConnectToolWidget.tsx:99-118`
  and `.../ElicitationWidget.tsx:254-259`: render the neutral "interaction ended" state without
  a Retry button and without the word "Dismissed", and render the rule 2 outcome when one
  exists.

**Acceptance check.** Load a session whose form row is `cancelled` with no resolution. The card
renders as an inert "interaction ended" chip with no buttons, and the same session rendered from
a warm cache and from a cold cache produces identical output. Load a session whose row is
`responded` with an outcome and the card renders the answer.

**Traps.** The two replay copies are not byte-identical and never were (see anchor 6). Copy the
precedence logic verbatim into both and leave the three known divergences alone. Do not try to
reconcile the files in this slice. Every behavior change here must be added to both
`transcriptToMessages.test.ts` files in the same commit, or the package copy silently rots.

### Slice C: the browser listens, and stops overwriting

Change 3. Independent of A and B; ordered here because its value is visible only once B renders
row state correctly.

- `web/oss/src/components/AgentChatSlice/hooks/useSessionRecordsWatch.ts:31-34`: add
  `interaction` to the handler map, wired to the same refresh the other two events use, plus an
  invalidation of the interaction-rows query key from
  `interactionStatus.ts:27`.
- `web/oss/src/components/AgentChatSlice/hooks/useSessionHydration.ts:111-139`: extend the
  adoption guard so a waiting card blocks adoption unless the incoming transcript settles that
  same card. Follow the existing double-check shape at lines 296-318: check before the fetch and
  again after it.
- Do not touch `web/packages/agenta-entities/src/session/core/transcriptAdoption.ts`. Mobile
  shares it and cannot answer these cards.

**Acceptance check.** With a form card waiting, force a records refresh (or let the poll fire).
The card stays on screen and any typed draft survives. When the server copy contains the
answered form, adoption proceeds and the card renders answered.

**Traps.** `useProjectWatch.ts:30` uses `eventNamesKey` as an effect dependency, so the event
name list must be a stable constant or the EventSource reconnects on every render. The
throttle at `useProjectWatch.ts` is 3 seconds with a trailing flush, so a test that asserts
immediacy will flake.

### Slice D: cards work where they appear

Change 4. Depends on nothing, but lands after C so the live QA journey exercises one coherent
build.

- `web/oss/src/components/AgentChatSlice/components/clientTools/ConnectToolWidget.tsx:133-141`:
  replace the passive marker with the real actions, driven by `useConnectFlow`. The double
  settle guard at `useConnectFlow.ts:210` and `:264` already makes two mounted surfaces safe.
- `web/oss/src/components/AgentChatSlice/components/InteractionDock.tsx`: keep the dock, drop
  the buttons, make it scroll to the card. Mahmoud's decision, recorded in plan.md.
- Whole-chat scans, following `AgentConversation.tsx:371-390`: fix
  `InteractionDock.tsx:41`, `agentMessageQueue.ts:48-49` (`isHitlPending`),
  `ApprovalDock.tsx:55` (`getPendingApprovals`), and
  `agentApprovalResume.ts:134-141`. Mirror each into
  `web/packages/agenta-chat/src/model/approvals.ts:30`,
  `web/packages/agenta-chat/src/hooks/useAgentChatQueue.ts:80` and
  `web/packages/agenta-chat/src/hooks/useAgentConversation.ts:360`. Leave `meta.ts:70` alone and
  say why in the commit.
- `registry.tsx:52`: restore the `toolName` fallback, and invert
  `meta.test.ts:86-89` to assert the fallback instead of forbidding it.
- New React-free descriptor in `web/packages/agenta-shared` holding the client-tool names and
  render kinds. Point `registry.tsx:37-48`, `agentApprovalResume.ts:79`,
  `toolPermission.ts:127`, the two `CANCELLED_CLIENT_TOOL_OUTPUT` maps and
  `InteractionDock.tsx:33` at it.

**Acceptance check.** Park a connect card, then start a new turn so the card is no longer the
last message. The card's own Connect and Not now buttons still work, the dock shows and scrolls
to it, the composer still holds the queue, and answering it resumes the run.

**Traps.** `agentApprovalResume.ts` and `agentMessageQueue.ts` are in `@agenta/playground` and
are consumed by both the desktop chat and `@agenta/chat`. A change there that assumes desktop
data shapes breaks mobile. Widening `agentApprovalResume.ts:134-141` to the whole chat can
re-dispatch a resume for an old settled card; scope the scan to unsettled parts only.
The shared descriptor must not import React or antd, or it violates the `@agenta/shared`
placement rule.

### Slice E: tests and gates

- `api/oss/tests/pytest/unit/sessions/`: a settlement matrix test alongside
  `test_transition_interaction_resolution.py`, covering all three kinds against all three
  outcomes (complete, decline, walk away), asserting the final status and the saved outcome.
- `api/oss/tests/pytest/acceptance/sessions/`: the sweep race test. Create a row, transition it
  to `responded`, run `cancel-stale` for a later turn, and assert the row is still `responded`
  with its outcome intact.
- `web/oss/src/components/AgentChatSlice/assets/transcriptToMessages.test.ts` and
  `web/packages/agenta-chat/tests/unit/assets/transcriptToMessages.test.ts`: golden fixtures for
  every line of the Slice B rule, including pre-fix `cancelled` rows with no resolution, run
  against both copies.
- The geometry test: one fixture whose waiting card is not in the last message, asserting at
  once that the session status is `awaiting`, the message queue holds, and the card is
  clickable. This is the test that makes the Slice D scans stay fixed.
- `web/oss/src/components/AgentChatSlice/hooks/useSessionHydration.test.ts`: the adoption safety
  cases, over refresh-during-answer, adoption-during-park, and reload-mid-answer.
- `.agents/skills/agent-release-gate/resources/matrix_i1_settlement.py`: the settlement table
  against a live API, in the shape of `matrix_l4_client_tool_lifecycle.py`.
- `.agents/skills/agent-release-gate/resources/matrix_i2_card_journeys.py`: the six scripted
  journeys from qa.md.
- Update `matrix_l4_client_tool_lifecycle.py`. Its docstring records the "fulfilled client tool
  stores as cancelled" defect as observed-but-not-asserted, and its assertion is only that no row
  is left `pending`. After Slice A both must change, or the gate keeps documenting a bug that no
  longer exists.
- `.agents/skills/agent-release-gate/resources/coverage.md` and the release-conductor Stage 4
  list gain the two new cells.

**Acceptance check.** `cd api && py-run-tests` and the web unit suites pass, and both new gate
scripts run green against the dev stack with a cheap model.

**Traps.** Gate scripts are `uv run` scripts with PEP 723 headers, not pytest. CI pins ruff
0.15.12 while local environments may run older versions, and the styling job covers `.agents/`
and `docs/` as well as `api/`, so judge formatting with `uvx ruff@0.15.12`. Gate run artifacts
contain probe tokens that trip secret scanners; they are not credentials.

## Plan corrections

None of these change the plan's four changes. They change what the changes cost.

1. **The desktop browser has no write path to the interactions API.** plan.md Change 1 says the
   approval card already works this way and that we invent nothing. That is true of mobile
   (`web/mobile/src/features/chat/useApprovalActions.ts:111`) and false of the desktop chat,
   which answers approvals in band and lets the runner resolve the row
   (`services/runner/src/engines/sandbox_agent/run-turn.ts:642`). Slice A adds a new
   `transitionInteraction` wrapper and a new call site. It is still small, but it is new
   construction.

2. **Three guards block Change 1, not one.** Besides the kind check at
   `api/oss/src/apis/fastapi/sessions/router.py:891-895`, the resolution payload model is
   approval-shaped and closed (`models.py:130-134`) and a validator forbids a resolution on any
   status except `resolved` (`models.py:144-152`). Both must change, or the single-call write
   that makes the ordering race-safe is impossible.

3. **"Resolve on consume" is not cheap and is recommended out of scope.** The consume point is
   `services/runner/src/engines/sandbox_agent/client-tools.ts:266`, but the runner does not know
   which row it satisfied, because client-tool outputs are keyed by name and arguments
   (`services/runner/src/responder.ts:440`) and carry no interaction token
   (`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:200-209`). Building it means a new
   field through the browser, the SDK and the runner, for a status word that nothing renders.
   `responded` plus a saved outcome is the durable settled state this project needs.

4. **The two replay copies are already not byte-identical.** md5 `bfa18c1b…` against
   `547dd832…`, 58 differing lines, three of them behavioral (anchor 6). The instruction to keep
   them byte-identical cannot be met. The rule Slice B follows is that the precedence logic is
   identical and the pre-existing divergences stay.

5. **The tool-name list exists four times, not twice**, plus two single-name hardcodes
   (anchor 10). research.md Finding 4 undercounts.

6. **The registry one-liner also needs a test inverted.** research.md Finding 3 says one line
   fixes it. The line is `registry.tsx:52`, and
   `web/oss/src/components/AgentChatSlice/components/clientTools/meta.test.ts:86-89` currently
   asserts the broken behavior on purpose. Also, the package copy at
   `web/packages/agenta-chat/src/skin/registry.ts:58-65` never took the change, so the fix
   restores parity.

7. **There are two sweeps.** research.md describes the turn-start sweep only. The records
   worker's orphaned-gate reconciliation
   (`api/oss/src/tasks/asyncio/sessions/records_worker.py:96-148`) is a second one. It also
   filters on `pending`, so it is harmless to the plan, but it is the one that can fire
   milliseconds after a turn ends, and any future work on this area must account for it.

8. **The row-to-card join key is empirical, not contractual.**
   `web/packages/agenta-entities/src/session/state/interactionStatus.ts:14-17` documents that the
   row token equals the record's `toolCallId`, verified once against one live row. For
   `client_tool` rows the token is the relay interaction id and the tool-call id can be a
   correlated ACP id (`client-tools.ts:283-290`). Slice A stamps
   `data.request.tool_call_id` on new rows so the join is deterministic, and keeps the equality
   as a legacy fallback.

9. **The pending TTL is 7 days, not absent and not 10 minutes.**
   `api/oss/src/dbs/postgres/sessions/interactions/dao.py:31` sets
   `PENDING_INTERACTION_TTL = timedelta(days=7)`, applied only to `actionable_only` queries at
   `dao.py:213-217`. research.md Finding 4 is right that no timeout changes a card's state; the
   constant exists but only hides old rows from inbox queries.

10. **The release gate already documents the defect.**
    `.agents/skills/agent-release-gate/resources/matrix_l4_client_tool_lifecycle.py` records that
    a fulfilled client tool stores as `cancelled` and deliberately asserts only that no row is
    left `pending`. That cell must be tightened in Slice E, or the gate will keep passing on the
    old contract.

## Nothing blocks implementation

Every anchor resolved to real code. No migration is needed, no new event payload is needed, and
no endpoint has to be created. The only design decision this file makes on its own is
recommendation 3, that resolve-on-consume stays out of scope. If a reviewer overrules it, the
build is specified in anchor 5 and is a self-contained follow-on slice that changes nothing
already shipped.
