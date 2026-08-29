# Status

**State:** in review. Two commits on the GitButler lane `feat/playground-shortcut-hints`.

## Done

- S1 the registry and the keycap primitive.
- S2 the shortcuts sheet and the `?` hotkey, with a visible button.
- S3 keycaps on the approval card, keys on both side panel carets.
- S4 the Alt letters moved off every browser menu key, with a test that keeps them off.

## In progress

- S5 the button moves to the playground top bar, and the sheet widens to fit a 15 inch screen.
- S6 the Storybook pass and this written record.

## Follow-up, not in this PR

- The session tab menu still has no key column. Rename, Archive and Close each have a key.
- The session search box placeholder does not name `Alt+K`.
- The stop button does not name `Esc`.
- The composer hint row shows send and newline but not `Shift+Enter`.
- The connection dock has the same Approve-and-Deny gesture as the approval card and shows
  neither key.
- The sheet is not searchable. Linear's is, and with forty-five rows ours will want it
  eventually.

## Verified

- `useSessionShortcuts.test.ts`: 22 tests pass, including the browser-key guard.
- Storybook builds clean; every story renders with no page errors.
- The `?` hotkey opens the sheet from the page and stays shut while the caret is in a field.

## Not verified, and cannot be from here

- The Alt chords on a real Windows browser and a real Linux desktop. On Linux a window manager
  can claim an Alt chord before the browser sees it, and no page code can help.
