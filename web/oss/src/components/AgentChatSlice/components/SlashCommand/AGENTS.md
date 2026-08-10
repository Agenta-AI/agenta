# Slash-command panels

The panels the composer's `/` palette drills into. `SlashCommandPlugin` (in `@agenta/ui`) owns the
palette itself; these are the surfaces a command opens.

## Keyboard contract

**Every command must be usable without a mouse, end to end.** The whole point of a `/` palette is
that your hands never leave the keyboard — a panel you have to click is a dead end in the middle of
a keyboard flow. Adding a command means honouring all of this:

- `↑↓` move the selection. `Home`/`End` jump to the ends.
- `Enter` **applies**. No panel adds a confirmation keystroke. If a choice needs a warning, render
  it in the panel as the selection moves, so it is already on screen when `Enter` lands — that is
  how `/harness` shows model-stranding without a second step.
- `←` steps back to the command list, restoring the `/` the panel consumed. `→` drills in and `←`
  backs out at every level, so a nested panel (`/model`'s provider → model cascade) collapses one
  column per press and then leaves. Show it in the footer as a key, not as decoration.
- `Esc` dismisses.
- Closing returns focus to the composer, so the user can keep typing. The one exception is a click
  outside: that is a deliberate move elsewhere, and pulling focus back would fight it.

Use **`useRovingList`** — do not hand-roll `onClick`-only rows. It carries the whole pattern:
stepping with wrap, `Home`/`End`, `Enter`, `aria-activedescendant`, scroll-into-view, and opening on
the row **currently in effect** rather than the first.

## Two things that are easy to get wrong

**The panel must focus itself.** `AgentComposerDock` blurs the composer when a picker opens (a
focused Lexical editor re-asserts its selection on the next reconcile, which an overlay reads as
focus loss and dismisses on). So focus is on `<body>` when your panel mounts — `useRovingList`
claims it, which is why `containerProps` must be spread on the element wrapping the options.

**`aria-selected` and the highlight are different things — in a panel.** A panel edits a value that
is already set, so `aria-selected` marks the value in effect while `data-active` marks the keyboard
cursor. `useRovingList` sets only the latter; the panel sets `aria-selected` itself. Conflating them
makes a picker misreport which value is live.

The `/` palette is the exception, and deliberately: it has no value in effect, so the cursor *is*
the selection candidate and `aria-selected` tracks it — the standard combobox-with-listbox reading.
Because focus stays in the editor there, the palette also has to publish `aria-controls` and
`aria-activedescendant` on the contenteditable, or its listbox is inert to a screen reader.

`role="listbox"` belongs on the option list, not the panel root — the root also holds a header and
footer, and the outside-click check needs it as a separate ref anyway.

## Checklist for a new command

1. Row in `useChatSlashCommands` (`../../hooks/useChatSlashCommands.tsx`) with `kind: "open"`, an
   icon matching the config panel's for that section, and a tail showing the current value.
2. A panel here using `useRovingList`, with `onDismiss(reason)` and `onBackToCommands`.
3. A pure config patcher in `@agenta/entity-ui`'s `agentConfigPatch.ts` — the write must preserve
   everything it does not own — plus its unit tests.
4. Mount it in `AgentComposerDock` beside the others, wired to `dismissPicker` and `backToCommands`.
5. Add it to the Storybook `SlashCommands` story and drive the flow keyboard-only.
