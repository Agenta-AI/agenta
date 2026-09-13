# Plan

## Slices

### S1 — the shortcut registry and the keycap primitive (done)

One exported list owns every binding's keys and label, and one component prints them the way
the reader's own keyboard is labelled.

- `web/packages/agenta-shared/src/utils/shortcuts.ts` — the registry, pure data, no React.
- `web/packages/agenta-ui/src/shortcuts/ShortcutKeys.tsx` — the keycaps.

**Acceptance:** every hint in the app reads its keys from the registry. No component spells a
key string by hand.

### S2 — the shortcuts sheet and its button (done, refined in S5)

- `web/packages/agenta-ui/src/shortcuts/KeyboardShortcutsSheet.tsx` — the sheet plus the `?`
  hotkey.
- `web/packages/agenta-ui/src/shortcuts/ShortcutsHelpButton.tsx` — the visible way in.

**Acceptance:** `?` opens the sheet from the page and does nothing while the caret is in a
text field, where it types a question mark instead.

### S3 — keys on the controls (done)

- The approval card's Approve and Deny buttons carry keycaps.
- Both side panel carets name their key in their tooltip.

**Acceptance:** hovering either caret shows its key; the approval card shows both keys without
a hover.

### S4 — Windows and Linux safety (done)

Move every Alt letter off the keys a browser menu claims. Full reasoning in
[decisions.md](decisions.md).

**Acceptance:** the unit test "binds no letter a browser menu already claims" passes, and
every moved key is reflected in the registry, the handler, and the tooltips at once.

### S5 — the button's home and the sheet's width

- Move `ShortcutsHelpButton` out of the session bar and into the playground top bar, at the
  right edge, after the settings gear.
- Widen the sheet and give it a third column on wide screens, so the full list fits a 15 inch
  laptop without scrolling.

**Acceptance:** the button is the rightmost control in the top bar. The sheet's content height
fits inside a 900px viewport with no scrollbar.

### S6 — Storybook and the written record

- The Storybook stories show only what shipped: one approval card, the sheet with its button,
  and the placements.
- This workspace records why each key is what it is, so the next agent does not revert it.

**Acceptance:** the Storybook builds clean, every story renders with no page errors, and
`decisions.md` explains every letter.

## Out of scope

- The remaining tooltips (the session tab menu's key column, the search box placeholder, the
  stop button, the composer's `Shift+Enter` chip). They are listed in `status.md` as follow-up.
- Making the sheet searchable, as Linear's is.
