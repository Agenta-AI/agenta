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

| WP | Principle | Change | Effort |
| --- | --- | --- | --- |
| SC-1 | 4,5,6 | On submit, scroll the new user message to the top (bottom spacer gives it room) and stream the answer into the space below, instead of jamming to the bottom. | Med |
| SC-2 | 11 | On session mount, scroll to the last user message, not `scrollHeight`. | Low |
| SC-3 | 12 | `overflow-anchor`, reserve media height, stop re-scrolling on every growth frame when not at the edge. | Med |
| SC-4 | 3 | Treat selection / keydown / wheel-up / focus as "stop following", not just `scroll`. | Low |
| SC-5 | 14 | Virtualize the list; throttle the typewriter; memoize tool parts. | High |
| SC-6 | 15 | Move the live region to a small status node, throttle announcements, add `aria-busy`. | Med |
| SC-7 | 8 | State-aware jump pill: "responding ↓" while streaming, "N new" when messages arrive offscreen. | Low |
| SC-8 | 10 | In-thread search / message anchors / unread marker. Lowest priority for a playground. | High |

Sequence: SC-1 first (most visible), verify, then SC-2 / SC-3 / SC-4, then the rest.

## SC-1 design (implemented first)

On submit: set a one-shot "pin" flag and release stick-to-bottom; render a bottom spacer sized to the
container's viewport so the new user turn *can* reach the top; after the optimistic user message
mounts, scroll it to the top of the container. The answer then streams into the space below while the
question stays anchored at the top. The jump pill remains available to follow the answer; the spacer is
removed when the turn goes idle (it sits below the fold, so removing it doesn't move the reader).
