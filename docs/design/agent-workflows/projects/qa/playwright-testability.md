# Making the agent UI testable

The agent playground has no test hooks. A `grep` for `data-testid` across the whole frontend
returns 15 hits, and none are in the agent surface: `AgentChatSlice/`, `pages/agent-home/`,
`pages/agents/`, and `@agenta/playground` contain zero.

Exactly two agent affordances have a stable accessible name today:

- the chat input — `aria-label="Chat message"` (`packages/agenta-ui/src/RichChatInput/RichChatInput.tsx`)
- the send button — `aria-label="Send"`, which morphs into `aria-label="Stop"` while a turn is
  streaming (`packages/agenta-ui/src/RichChatInput/plugins/SendButton.tsx`)

Everything else is reachable only through English UI copy or Tailwind classes. A Playwright suite
built on those breaks the first time someone rewords a button or restyles a status icon, and —
worse — some of it breaks *silently green*, which is the failure mode that matters. Details in
"Traps" below.

This document is the backlog to fix that. It has two tiers, and the distinction is load-bearing.

## The two tiers

**Tier 1 — always on.** Test IDs and state attributes. These cost nothing in production, leak
nothing, and must NOT be behind a flag. Gating them means the DOM you test is not the DOM you
ship, and the flag becomes its own source of "green in CI, broken in prod."

**Tier 2 — behind a flag.** Internal state that has no business in a production DOM: session and
run ids, warm/cold, turn timings, wire frames. This tier exists because of a real gap, not a
convenience: **the UI has no concept of warm vs cold**. `sessionStatusAtomFamily` models only
`running / awaiting / error / idle`. So no number of test IDs will let Playwright assert the
warm/cold journey — that assertion has no DOM source at all today. Tier 2 gives it one.

## Tier 1: attributes to add

Ranked by what a QA suite actually needs. `data-testid` names an element; `data-state` /
`data-*` make its *state* machine-readable, so a test never has to match a CSS class or a
sentence of copy.

### Blocking — the suite cannot be trusted without these

| # | Affordance | Component | Add |
|---|---|---|---|
| 1 | Approval dock | `oss/src/components/AgentChatSlice/components/ApprovalDock.tsx` | `data-testid="approval-dock"` + `data-state="open\|collapsed"` on the wrapper; `data-testid="approval-approve"` and `data-testid="approval-deny"` on the buttons; `data-approval-id` and `data-tool-name` on the dock |
| 2 | Tool call in transcript | `oss/src/components/AgentChatSlice/components/ToolActivity.tsx` | `data-testid="tool-call"` + `data-tool-name={name}` + `data-status="pending\|success\|error"` on each row |
| 3 | Assistant / user message | `oss/src/components/AgentChatSlice/components/AgentMessage.tsx` | `data-testid="chat-message"` + `data-role="user\|assistant"`; on the failure bubble `data-testid="run-error"` |
| 4 | Session status | `oss/src/components/AgentChatSlice/components/SessionTagBar.tsx` (and `SessionRail.tsx`) | `data-testid="session-status"` + `data-status="running\|awaiting\|error\|idle"` — replaces matching `.bg-colorWarning` |
| 5 | Commit / revision approval body | `oss/src/components/AgentChatSlice/components/approvals/CommitRevisionApproval.tsx` | `data-testid="commit-approval"`, and `data-testid="commit-changes-summary"` on `AgentChangesSummary` |

### Needed to reach the above (config controls)

All three selectors live behind accordions in a drawer, so a test must open the section before
the control is even in the DOM. Add an ID to the section headers too.

| # | Affordance | Component | Add |
|---|---|---|---|
| 6 | Harness selector | `packages/agenta-entity-ui/src/DrillInView/SchemaControls/HarnessSelectControl.tsx` | `data-testid="harness-select"` + `data-value={kind}` (`pi_core` / `pi_agenta` / `claude`); on the card variant, `data-testid="harness-option-{kind}"` |
| 7 | Sandbox selector | `packages/agenta-entity-ui/src/DrillInView/SchemaControls/EnumSelectControl.tsx` as hosted by `.../agentTemplate/useModelHarness.tsx` | `data-testid="sandbox-select"` + `data-value="local\|daytona"`. The enum labels are auto-derived by `formatEnumLabel`, so the visible text is NOT a stable hook |
| 8 | Model picker | `packages/agenta-entity-ui/src/DrillInView/SchemaControls/GroupedChoiceControl.tsx` | `data-testid="model-select"` + `data-value={model}` |
| 9 | Config sections | `ConfigAccordionSection`, `SectionDrawer` | `data-testid="config-section-{title-slug}"` |
| 10 | Create agent | `oss/src/components/pages/agent-home/components/AgentComposer/index.tsx`; `oss/src/components/pages/agents/AgentsTableSection.tsx` | `data-testid="create-agent"` on both (the agents-list one currently collides with other "Create" buttons) |

### Nice to have

Session tab controls already carry aria-labels (`New session`, `Rename session`, `Close
session`) and are fine as-is. The chat input and send button are fine as-is — but the existing
spec at `web/oss/tests/playwright/acceptance/agent-chat/tests.ts` uses
`getByRole("textbox").last()`, which should become
`getByRole("textbox", {name: "Chat message"})` today, for free.

## Tier 2: the debug state bridge

Gated behind one flag. Proposed: `NEXT_PUBLIC_AGENTA_TEST_HOOKS=1` (dev and CI only; never
enabled on a production deploy).

When on, render a single hidden node that mirrors the state the DOM otherwise hides:

```html
<div
  data-testid="agent-debug"
  hidden
  data-session-id="…"
  data-turn-id="…"
  data-turn-status="running|awaiting|error|idle"
  data-harness="pi_core|pi_agenta|claude"
  data-sandbox="local|daytona"
  data-model="…"
  data-warm="true|false"        <!-- see below -->
  data-turn-ms="1234"
  data-frames="start,tool-input-available,tool-approval-request,finish"
/>
```

Why each field earns its place:

- **`data-warm`** — the whole point. There is no other DOM source. Today the only way to know
  whether a session was loaded or silently restarted cold is to grep the runner log for
  `[keepalive] … cold`. That makes the warm/cold journey untestable from Playwright, and it makes
  a regression here invisible to CI forever. **This requires the wire to carry it first** — the
  frontend cannot know it. See "Open question" below.
- **`data-turn-ms`** — lets a perf regression be a test failure instead of a vibe.
- **`data-frames`** — the ordered list of stream frame types seen this turn. Turns a whole class
  of "the UI rendered something plausible but the wire was wrong" bugs into a one-line assertion.
- **`data-harness` / `data-sandbox` / `data-model`** — asserts the cell under test is *actually*
  the cell you configured. Guards against the exact failure we already hit in QA: a run silently
  falling back to `local` because Daytona was unconfigured, while the UI looked entirely normal.

## Traps a Playwright author will otherwise hit

These are the ones that produce a *passing* test that proves nothing, which is worse than a
failing one:

1. **The approval dock is always mounted.** When idle it is collapsed with `grid-rows-[0fr]
   opacity-0` and `inert` — it is not unmounted. So `expect(dock).toBeVisible()` can pass on a
   turn where no approval ever appeared. Assert on the *buttons*, which are absent from the tree
   when there is no current approval — or, better, on `data-state` from item 1.
2. **The reject button says "Deny", not "Reject".**
3. **The approve button's label is dynamic.** `renderer.approveLabel` (registry at
   `components/approvals/registry.tsx`) overrides it per tool, so a commit approval may not say
   "Approve" at all. A name-based selector is not just brittle, it is wrong.
4. **Tool status is icon-only.** Success vs failure is `text-colorSuccess` vs `text-colorError`
   with no text and no role. Asserting a tool *succeeded* today means matching a Tailwind class.
5. **The sandbox label is auto-derived** from the backend enum by `formatEnumLabel`, so the
   visible string is not a contract. The collapsed accordion header does render a stable-ish
   summary (`Sandbox: daytona`) which is usable until item 7 lands.
6. **Config controls are lazily mounted** behind accordions and drawers. `getByRole("combobox")`
   finds nothing until the section is opened.
7. **A paused turn finishes with `finishReason: "other"`,** not a distinct status — so "the turn
   ended" does not mean "the turn completed". Fixture:
   `web/oss/tests/playwright/acceptance/agent-chat/assets/elicitationStream.ts`.

## Open question

`data-warm` needs a source. The runner knows (it logs `[keepalive] … cold`), but nothing carries
it to the client. Options: add it to the `finish` frame's metadata, or emit it as a `data-*`
stream part. Until then, warm/cold is assertable only from the runner log, i.e. only in a test
that has host access — which a browser-driven Playwright suite does not.
