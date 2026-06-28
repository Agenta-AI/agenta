# Agent chat: scroll-engineering review

Reviews the agent chat playground (`oss/src/components/AgentChatSlice/`) against the streaming-chat
scroll principles. Branch for the fixes: `fe-feat/agent-chat-scroll-engineering` (off
`fe-feat/agent-config-section-drawers`).

## How it works today (facts)

- Scroll container: the `role="log"` div (`AgentChatPanel.tsx:312`), `onScroll` (`:237`) sets
  `stickRef = (scrollHeight - scrollTop - clientHeight < 24)` and `showJump = !atBottom`.
- Auto-scroll: `useEffect(() => { if (stickRef.current) scrollToBottom() }, [messages, status])`
  (`:233`) — `scrollToBottom` sets `scrollTop = scrollHeight` (`:228`). Gated on being at the edge.
- Submit (`:251`): sets `stickRef = true` + `showJump = false`, then the effect jams to the bottom.
- Jump pill (`:367`): shown when `showJump`; `jumpToLatest` (`:245`) re-sticks + scrolls to bottom.
- Session restore (`:117`,`:233`): `stickRef` defaults true → scrolls to absolute bottom on mount.
- List: `messages.map` (`:328`), each `AgentMessage` does `parts.map`; tool output uses a per-token
  `requestAnimationFrame` typewriter. Not virtualized.
- a11y: `role="log"` + `aria-live="polite"` on the whole transcript; no `aria-busy`.

## Scorecard

| # | Principle | Status | Gap |
| --- | --- | --- | --- |
| 1 | Move only when asked | Pass | Auto-scroll gated on `stickRef`. |
| 2 | Follow only while following | Pass | 24px live-edge threshold. |
| 3 | Every interaction is intent | Fail | Only `scroll` pauses follow; not selection/keydown/link/focus. |
| 4 | New turn near the top | Fail | Submit jams to bottom; the new user turn isn't anchored at top. |
| 5 | Stream into the space | Partial | Streams into the bottom edge (tied to #4). |
| 6 | Keep previous turn in context | Partial | Jamming can push the prior turn off-screen. |
| 7 | New content arrives offscreen | Pass | Scrolled-up → no auto-scroll. |
| 8 | Show what's happening out of view | Partial | Loading bubble + status tags + a static jump pill; no "streaming/N new". |
| 9 | Easy return to latest | Pass | `jumpToLatest`. |
| 10 | Jump anywhere | Fail | No in-thread search / message anchors / unread markers. |
| 11 | Reopen where they left off | Fail | Restores to absolute bottom, not the last user message. |
| 12 | Keep place on layout change | Fail | No scroll anchoring; media has no reserved height; growth shifts content. |
| 13 | Interruptions don't steal position | Pass | Stop/rewind/regenerate don't force-scroll. |
| 14 | Responsive in long threads | Fail | Not virtualized; per-token rAF typewriter; tool parts not memoized. |
| 15 | Accessible without noise | Partial | `aria-live` on the streaming transcript (token spam); no `aria-busy`. |

Net: 5 Pass / 4 Partial / 6 Fail. Core stick-to-bottom is sound; the gaps are the scroll-engineering
signatures — new-turn positioning, place preservation, reopen point, long-thread performance.

## Work packages

| WP | Principle | Change | Status |
| --- | --- | --- | --- |
| SC-1 | 4,5,6 | Pin the new user turn to the top; the answer streams into the fill below. | **Done** |
| SC-2 | 11 | Reopen a saved thread at the last user message, parked (not following). | **Done** |
| SC-3 | 12 | Preserve the reader's place when content above changes height. | **Done** |
| SC-4 | 3 | Selection / link-click also release follow (not just scroll). | **Done** |
| SC-5 | 14 | Virtualize the list; throttle the typewriter; memoize tool parts. | Open (High) |
| SC-6 | 15 | Move the live region to a small status node, throttle, add `aria-busy`. | Open (Med) |
| SC-7 | 8 | State-aware jump pill: "responding ↓" / "N new" when offscreen. | Open (Low) |
| SC-8 | 10 | In-thread search / message anchors / unread marker. | Open (High) |

Branch: `fe-feat/agent-chat-scroll-engineering` (off `fe-feat/agent-config-section-drawers`). All four
done WPs live in `AgentChatPanel.tsx` (the inner `AgentConversation` component). `tsc` + `eslint` clean;
not yet QA-signed-off by the user beyond the storyboard flows.

## Implemented foundation (SC-1–SC-4) — read before extending

Everything rests on one invariant: **the view only moves when the user is at the live edge (following);
new content arriving, growing, or settling must never move it.** The pieces, all in `AgentConversation`:

- **`stickRef` (follow)** — true only when the user is at the very bottom of the *scrollable* area
  (`scrollHeight - scrollTop - clientHeight < 24`), set in `onScroll`. NOT visibility-based (that was the
  yank bug — it's true right after a pin). Default value is SC-2: `initialMessages.length === 0` (a new
  empty session follows; a restored thread opens parked).
- **The fill** — `min-h-full` on the **active-turn wrapper** (the last user message + its response,
  grouped via `activeStart = lastUserIndex`). Present whenever `activeStart > 0` (there is prior
  conversation), derived from **layout, not `busy`** — so it persists when the turn settles. This is the
  CSS form of `fill = max(0, viewport − content-below-question)`: it lets the question sit at the top and
  is the empty space below a short answer. Removing it on settle was the "jump on completion" bug; do NOT
  re-gate it on streaming state. Grouping the whole turn keeps the fill on one stable element (it doesn't
  hop user→assistant mid-stream).
- **The pin** (`armPinRef` + a `useLayoutEffect`) — one-shot scroll of the **last user message** to the
  top. Armed on submit (SC-1) and on mount when a restored thread has a user message (SC-2). Sets
  `programmaticScrollRef` around its `scrollTop` write.
- **`programmaticScrollRef`** — set while WE move the scroll (pin, follow, SC-3 compensation); `onScroll`
  early-returns on it so our own scrolls aren't mistaken for the user reaching the edge. Cleared on the
  next frame. Any new programmatic scroll MUST set this.
- **Jump pill (`showJump`)** — tracks the **real latest message** via `atLiveEdge` (last `[data-mid]`
  child's bottom vs the container bottom — ignores the fill). Shown only when that message is below the
  fold AND not following; only *raised* by a real scroll/recompute, never by the fill.
- **SC-3 anchoring** — `[overflow-anchor:none]` (we own it; Safari has none) + `recordAnchor` (topmost
  visible `[data-mid]`, recorded on scroll and after each pin) + a `ResizeObserver` on the message
  wrappers that compensates `scrollTop` by the anchor's drift when content above changes height. Growth
  below the anchor (the streaming answer) yields `delta ≈ 0`, so it's untouched.
- **SC-4 release** — a `selectionchange` listener (non-empty selection whose `anchorNode` is inside the
  log) and an `<a>`-click listener release follow. Composer is exempt (its nodes aren't in the log).
- **Stopped/Resend** — gated on **position**, not id: `stopped && isLast && role === "assistant"`. A
  boolean (`stopped`), set on stop, cleared on send/resend. Do NOT key this on `message.id` — restore /
  error-carrier paths can produce missing/duplicate ids that smear the tag onto every turn.

Gotchas for any extension: never write `scrollTop` without setting `programmaticScrollRef`; the
`[data-mid]` attribute on each message wrapper is load-bearing (pin, anchor, atLiveEdge, ResizeObserver
all query it); the `messages.length` dep on the ResizeObserver re-subscribes when turns are added (parts
growing fire on the already-observed wrapper).

## Next steps (SC-5–SC-8) — ready to pick up

- **SC-5 — responsiveness in long threads (High).** Not virtualized: `messages.map` renders every turn,
  each `AgentMessage` renders every part, and `useTypewriter` (`ToolPart.tsx`) re-renders on every rAF.
  Plan: (a) `React.memo` `AgentMessage`/`ToolPart` keyed on message identity so settled turns don't
  re-render while the last one streams; (b) throttle/curb the typewriter (cap rAF rate or disable for
  long output); (c) only then consider windowing. Windowing is hard here because the SC-1 fill needs
  `min-h-full` against the scroll container and SC-3 measures real wrapper geometry — a windowing lib that
  unmounts off-screen turns breaks `recordAnchor`/`atLiveEdge`/the pin's `querySelector`. If virtualizing,
  keep stable `data-mid` sentinels and feed the lib our follow/anchor model rather than its own.
- **SC-6 — accessible without the noise (Med).** Today `role="log" aria-live="polite"` is on the whole
  transcript, so every streamed token is announced. Plan: drop `aria-live` from the transcript; add a
  small visually-hidden status node that announces coarse events only ("Agent is responding…",
  "Response ready", "Run failed") on a throttle; add `aria-busy={busy}` to the log; ensure the jump pill
  and composer keep keyboard focus order. Verify with VoiceOver/NVDA.
- **SC-7 — state-aware jump pill (Low).** The pill is a static "Jump to latest". Make it reflect state:
  "Agent is responding ↓" while `busy` and below the fold; "N new messages" when assistant turns arrived
  while parked. Pure presentation on top of the existing `showJump`/`busy`; no scroll-model change.
- **SC-8 — jump anywhere in a thread (High).** No in-thread search, message anchors, or unread markers.
  Larger feature; lowest priority for a playground. Would build on `data-mid` for deep-linking.

## QA checklist (for SC-1–SC-4 before merge)

- New turn in an overflowing thread → question pins to top, answer streams below; short/long/huge all
  hold (no jump on arrival or on settle); error/fast reply doesn't jump on settle.
- Scroll partially mid-stream → place held; reach the very bottom → follows; jump pill returns to the
  latest message (never whitespace) and is legible over text.
- Reopen a saved thread / switch tabs / open from history → lands at the last user message, parked.
- Select text or click a link mid-stream while following → follow releases, selection preserved.
- Image/markdown/tool-card height change above the reader → reading line holds.
- Stop a turn then ask again → Stopped/Resend on only that one turn, gone after the next send.
