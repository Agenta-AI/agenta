# Agent chat panel: border-nesting cleanup

Status: implementing Approach A. Approach B kept below as the documented fallback.

## Problem

The agent generation chat panel stacks up to four rounded outlines for a single assistant turn,
all the same low-contrast gray, producing a box-in-box-in-box look:

1. Conversation container — `AgentChatPanel.tsx:321`:
   `rounded-md border border-solid border-colorBorderSecondary`
2. Assistant bubble — `AgentMessage.tsx:403`: antd-x `Bubble variant="outlined"` adds
   `1px colorBorderSecondary` + `radius 12px`.
3. Tool-call card — `ToolPart.tsx:115`:
   `rounded-md border border-solid border-colorBorderSecondary bg-colorBgContainer`.
4. INPUT/OUTPUT `JsonBlock` — `ToolPart.tsx:58`: `rounded bg-colorFillTertiary` (already borderless,
   the one good citizen). On errors a fifth border appears (`AgentMessage.tsx:126`).

Hardcoded hovers `var(--ag-rgba-051729-04)` (`AgentMessage.tsx:82,119`, `ToolPart.tsx:118`) barely
show in dark mode.

Blast radius is small: the offenders are agent-only components under `AgentChatSlice/`. The one
shared piece, `Bubble`, is changed via the agent-specific `AgentMessage` instance's props, so the
prompt playground is untouched.

## Principle

Stop using borders for nesting. Keep **one** outer frame (the panel) and differentiate depth with
**surface tint + spacing + dividers**, not stacked outlines. At most two fill levels inside a turn,
zero inner borders. Reserve real borders for the composer and the panel edge.

## Approach A — flat surfaces (CHOSEN)

Borderless turns; tool cards and code blocks differentiated by fill only.

- Conversation container: drop the border, keep padding/scroll. The panel is the single frame.
- Assistant bubble: `variant="borderless"` (user stays `filled` — a valid chat affordance).
- Tool-call card: drop the border; subtle `colorFillQuaternary` fill, keep the radius.
- INPUT/OUTPUT: keep `JsonBlock` borderless on `colorFillTertiary` (one step off the card), and render
  empty `{}` / `[]` as muted inline text instead of a near-empty block.
- Hovers: `var(--ag-rgba-051729-04)` → `colorFillQuaternary` (theme-adaptive).

End state per turn: panel frame → borderless turn (avatar + spacing) → tinted tool card → tinted code
block. Two tints, no inner outlines.

### Work packages

- WP-1 — assistant `Bubble` → `variant="borderless"` (`AgentMessage.tsx:403`).
- WP-2 — tool card: drop border, `bg-colorBgContainer` → `colorFillQuaternary` (`ToolPart.tsx:115`).
- WP-3 — `JsonBlock`: keep tint, inline-muted empty values (`ToolPart.tsx:54-61`).
- WP-4 — conversation container: drop the border (`AgentChatPanel.tsx:321`).
- WP-5 — user bubble inner JSON: borderless tinted block (needs a check of what renders the
  highlighted JSON; heavier than `JsonBlock`). Deferred.
- WP-6 — error `<pre>`: error-bg tint, drop the hard `colorErrorBorder` (`AgentMessage.tsx:126`).
  Deferred.
- WP-7 — tokenize the `--ag-rgba-051729-04` hovers.

## Approach B — left rail + dividers (ALTERNATIVE, not built)

If the flat-tint version reads as too soft or the tool calls lose definition, switch to this instead
of reintroducing boxes:

- No card boxes. Each tool call gets a single `border-left` accent rail (2px) colored by its status
  (success/processing/error), with the header and content indented to its right.
- INPUT/OUTPUT are bare labeled monospace blocks on a faint fill (or none), separated by spacing.
- Consecutive tool calls are split by a hairline divider (`border-b colorBorderSecondary`), never a
  full box.
- The turn and conversation container stay borderless (same as A).

Trade-off: the rail gives each tool a clear left edge and encodes status in one stroke, but it adds a
vertical accent line per tool that can look busy when many tools stack. A is calmer; B is more
scannable. Both share WP-1 and WP-4 (borderless turn + frame); only the per-tool treatment differs.

## Approach C — one card, hairline sections (noted)

A single quiet container holds all tools, split by hairline dividers instead of per-tool boxes. Closer
to the current look but de-nested. Considered weaker than A/B because it reintroduces one outer card;
kept only as a reference point.

## Verification

`tsc` + `eslint` on `@agenta/oss`; live QA in the agent playground (dark + light): no nested outlines,
tool cards read as soft surfaces, code blocks differentiate by depth, status still legible.
