# Project: Agent Turn Inspector (Build-mode tooling)

| | |
| --- | --- |
| **Status** | Design. Approved via brainstorming on 2026-07-02. Not yet planned/implemented. |
| **Type** | Frontend feature (agent playground, Build mode). Sequenced, test-driven. |
| **Audience** | Internal builders — the team actively building the agent system, debugging in the playground. |
| **Scope** | A dedicated, agent-native "Turn Inspector" panel for deep per-turn debugging, plus a per-turn capture of what was actually sent to the agent. The inline Build-mode step log stays as-is. |
| **Owner files (today)** | `web/oss/src/components/AgentChatSlice/components/ToolActivity.tsx`, `.../components/AgentMessage.tsx`, `.../AgentChatPanel.tsx` (transport + temp diagnostic), `web/packages/agenta-playground/src/state/execution/agentRequest.ts` (`buildAgentRequest`). |

## 1. Problem

The agent chat view was deliberately kept calm for non-technical users. That calm hides the
information the team building the system needs to debug it. Across one working session we hit
this repeatedly and could not answer, from the UI alone:

- **Why did the agent misbehave?** e.g. a `commit_revision` loop where it re-committed and
  re-answered "already done" several times in one turn.
- **What did the agent actually run with?** The effective config (instructions / model / tools)
  and the exact `messages` array we sent — *as of that turn*. This is **invisible today**; it
  only exists in a temporary `console.warn` (`[AgentChat OUTGOING]`) added during the loop
  investigation.
- **Were the tool calls correct?** Right input in, right output back — the `{}`-input question,
  malformed args, error payloads.

The root difficulty is that the agent's *actual execution* is not legible: we watch what it
produces, but not what it saw. The re-commit loop, for instance, is best explained by the FE
re-sending a config that had drifted out from under the agent after its own self-commit — a
fact no surface in the app exposes.

## 2. Goals / non-goals

**Goals** (priority order, from the builders):

1. Diagnose *why it misbehaved* (loops, wrong tool, ignored context).
2. See *what it actually ran with* (effective config + exact messages sent, accurate at that turn).
3. Verify *tool-call correctness* (full input/output/error per call).

**Non-goals:**

- Do **not** touch the existing trace drawer (avoid regressions in a working surface).
- Do **not** reduce the inline Build-mode step log — the panel is purely additive.
- No speed/cost analytics (explicitly deprioritized).
- Read-only. No re-running/editing steps from the panel (possible future work).

## 3. Surfaces

Two surfaces with a clean division of labor:

- **Inline step log** — exists (`ToolActivity` `detailed` mode, gated on Build via
  `chatPanelMaximizedAtom`). The fast, in-transcript read: every step with tool I/O. **Unchanged.**
- **Turn Inspector** — new. A dedicated panel opened from a turn, for the deep dive. Its own
  shell and its own Jotai state. It shares only generic UI primitives (e.g. `EnhancedDrawer` from
  `@agenta/ui`); it does **not** import or mutate the trace-drawer store.

## 4. The Turn Inspector

**Gating:** Build mode only (`!chatPanelMaximizedAtom`), same signal the inline log uses.

**Open affordance:** an "Inspect turn" control on each assistant turn (near the existing
`View full trace` link / the turn's hover actions). Opens a right-side drawer focused on that
turn. Optional deep-link: clicking a step in the inline log opens the panel scrolled to that step.

**Three tabs:**

| Tab | Shows | Data source |
| --- | --- | --- |
| **Timeline** | Every interaction in order: reasoning, each tool call with full input/output/error, text, and HITL events (approval requested / approved / denied). The step log, exhaustive and un-truncated. | The turn's `UIMessage.parts` — already on the client. No new plumbing. |
| **Context** | *What the agent ran with this turn* — the effective config (instructions / model / tools) as of that turn, and the exact `messages` array sent (post-`hasAnswer` filter). When a turn made multiple requests (HITL/auto-resume), shows all of them with a diff. | The per-turn capture (§5). |
| **Raw** | The literal outgoing request body and raw response/events, for copy-paste repro and bug reports. Copy-as-JSON. | The per-turn capture (§5) + read-only reads of trace data via existing atoms (no trace-drawer UI). |

The **Timeline** tab ships essentially for free (message parts). **Context** and **Raw** carry
the real new value and the only real new engineering, because "what we actually sent" is not
persisted anywhere today.

## 5. The per-turn capture (the one new data mechanism)

**Decision: capture-at-send, not reconstruct-on-demand.** Reconstructing later re-reads the
*current* config/messages, which have already drifted (exactly the bug we chase). We snapshot at
the moment of sending, so Context/Raw are accurate *at that turn*.

**Where:** in the transport's `prepareSendMessagesRequest` in `AgentChatPanel` — the exact spot
the temporary `console.warn` lives now. The built `req` is already in hand. This **productizes
and replaces the temp `[AgentChat OUTGOING]` diagnostic** with a structured store write.

**Snapshot shape (per send):**

```ts
interface TurnRequestCapture {
    requestId: string          // nonce, generated at send
    at: number                 // Date.now() at send
    triggerUserMessageId: string   // last role:"user" message id in the sent array
    parameters: unknown        // config-as-sent (config-at-turn)
    messages: unknown[]        // exact array sent (post-hasAnswer)
    references: unknown        // as sent
    sessionId: string
    invocationUrl: string      // body/URL only; auth headers + secrets stripped
}
```

**Correlation (the subtle bit):** key each capture by `triggerUserMessageId` = the id of the
last `role:"user"` message in the sent array. The initial send **and every HITL/auto-resume of
that turn share it**, so one turn maps to a *list* of captures. Given an assistant turn, find its
preceding user message → pull all captures for that id.

**Payoff:** keeping *every* send lets the Context tab show "this turn = N requests" and diff
them — which surfaces the re-commit loop and the stale-config re-injection directly. That view
is what was missing all session.

**Storage:** a session-scoped, in-memory Jotai atom (ephemeral — this is a debugging surface),
capped to the last N turns to bound memory. Not `localStorage` (payloads can be large);
persistence is a possible later option.

**Redaction:** capture the request *body* only; strip `Authorization` and any secret-bearing
headers. The body itself must not carry secrets.

## 6. Phasing

1. **Inspector shell + Timeline tab** — no new plumbing (renders `UIMessage.parts`). Ships value
   immediately and is independently useful.
2. **Capture store + Context tab** — the snapshot mechanism (§5) + the config/messages view,
   including the multi-send-per-turn diff. Replaces the temp diagnostic.
3. **Raw tab** — literal payloads, copy-as-JSON, read-only trace correlation.

## 7. Testing

- **Unit:** the capture reducer + correlation — `triggerUserMessageId` grouping, resends
  collapsing into one turn, N-cap eviction.
- **Component:** Timeline renders reasoning / tool-I/O / HITL in order; Context renders config +
  messages; empty/no-capture states (a turn hydrated from a prior session has no capture).
- **Manual:** Build-mode-only gating; a HITL/resume turn shows multiple captures and a usable diff.

## 8. Open questions / future

- Deep-link from an inline step into the panel (nice-to-have, Phase 1 or later).
- Persisting captures across reload (currently ephemeral).
- "Re-run / fork from this turn" actions (out of scope now; the panel is read-only).
- Whether Timeline should also show server-recorded events not present in `UIMessage.parts`
  (would need a read-only trace correlation, same as Raw).

## See also

- `docs/design/agent-workflows/documentation/agent-configuration.md` — the schema-driven config
  the Context tab surfaces.
- The `hasAnswer` filter in `web/packages/agenta-playground/src/state/execution/agentRequest.ts`
  — why the sent `messages` differ from the rendered transcript.
