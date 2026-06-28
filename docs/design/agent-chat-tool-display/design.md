# Agent chat: tool-use display

How tool calls render inside an agent turn. Replaces the always-open, input+output JSON
cards with a quiet, output-focused summary. Branch: `fe-feat/agent-config-section-drawers`.

## Problem

Today every tool call is its own `ToolPart` card, `useState(true)` (open by default), showing
an `Input` JSON block and an `Output` JSON block. A multi-tool turn stacks several expanded
technical boxes ahead of the answer. It reads like a debugger: the inputs are the least useful
thing inline, and nothing recedes once the work is done.

## Decision

- **At rest: an activity line.** A run of tool calls collapses to one quiet, borderless line
  in the message flow: `✓ Used 2 tools` (or `Used search_docs` when there's a single tool).
  Click to expand a flat list, one row per tool.
- **While streaming: a live gutter.** During the turn the same group shows a left-gutter
  timeline, one row per tool with live status (`Using search_docs…` with a spinner →
  `✓ search_docs`). You watch the tools fire. When every tool in the group settles, the gutter
  folds into the rest-state line and the answer streams below.
- **Output, not input, inline.** Expanded rows show a derived one-line *output* summary
  (`5 results · top: "Pricing 2026"`), never the input. Full input/output stays in the trace
  drawer (`View full trace`, the turn's existing `traceId`).
- **Approvals never collapse.** A tool in `approval-requested` force-expands its group and
  shows `Approve` / `Deny` inline; the buttons must stay reachable mid-stream.

A (rest) and C (live gutter) are not competing approaches; A is the *settled* treatment and C
is the *streaming* treatment of the same group. B (a persistent bordered card) was the
runner-up, kept in mind if tool use should later read as a standing object rather than recede.

## Storyboard (the streaming → settled transition)

```
t0  user sends "Find the latest pricing and summarize it"

t1  agent starts a tool run — LIVE gutter, auto-shown:
      │ ◐ Using search_docs…
t2    │ ✓ search_docs            (5 results)
      │ ◐ Using fetch_url…
t3    │ ✓ fetch_url              (3 tiers)

t4  all tools settled → gutter FOLDS to the rest line, answer streams below:
      ✓ Used 2 tools  ›
      Acme has three tiers: Free, Pro $20/mo…

t5  user clicks the line → expands the flat list:
      ✓ Used 2 tools  ⌄
        search_docs   5 results · top: "Pricing 2026"      ✓
        fetch_url     acme.com/pricing · Free, Pro, Team    ✓
        ↗ View full trace
```

Interrupt — approval mid-run (force-expanded, not collapsible until resolved):

```
      │ ◐ Using search_docs…
      │ ✓ search_docs
      │ delete_record — Run this tool?   [Approve] [Deny]
```

Error / denied rows carry their own status icon and stay in the list; the rest-line reflects
a failure (`Used 2 tools · 1 failed`).

## Component plan

- New `components/ToolActivity.tsx` — renders one *group* of consecutive tool parts. Owns the
  live-vs-settled branch, the collapse, the per-tool row, the one-line summary, the approval
  buttons, and the `View full trace` link. Replaces `ToolPart` at the call site.
- `AgentMessage.tsx` — instead of mapping each tool part to its own card, fold *runs of
  consecutive* tool parts into a single `<ToolActivity>` (tools can be interleaved with text /
  reasoning, so group only adjacent ones). Pass `isStreaming`, `onApprovalResponse`, and an
  `onViewTrace` derived from the turn's `traceId` + `openTraceDrawer`.
- `live = isStreaming && parts.some(notSettled)`. Settled tool states:
  `output-available | output-error | output-denied`. Non-settled: `input-streaming |
  input-available | approval-requested | approval-responded`. Force-expand when any tool is
  `approval-requested`.
- `summarizeOutput(output)` — array → `N results`; string → first ~80 chars; object → first
  string-y field (`summary`/`result`/`content`/`text`/`title`) else `N fields`; nullish → no
  summary (row shows name + status only). Conservative: fall back to name-only, never throw.

## Out of scope (here)

Input rendering inline (gone — trace only), per-tool trace deep-links (turn-level trace is
enough for v1), virtualization of long tool lists (folds into the SC-5 perf work).
