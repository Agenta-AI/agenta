# Status

**State:** ready for a PR. The GitButler lane is `feat/playground-shortcut-hints`.

## Done

- S1 the registry and the keycap primitive.
- S2 the shortcuts sheet and the `?` hotkey, with a visible button.
- S3 keycaps on the approval card, keys on both side panel carets.
- S4 the Alt letters moved off every browser menu key, with a test that keeps them off.

- S5 the button sits at the right edge of the playground top bar, and the sheet is three
  columns wide.
- S6 the Storybook pass and this written record.
- Keystrokes no longer leak through an open overlay. See the section in
  [research.md](research.md); it was reachable the moment the sheet shipped.

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

Unit tests: `useSessionShortcuts.test.ts` 22 pass including the browser-key guard,
`ApprovalCard.test.tsx` 11 pass including both overlay guards, `shortcuts.test.ts` 13 pass on
the registry and its ARIA output. Suite totals: agenta-shared 440, agenta-chat 568, oss
AgentChatSlice 287. Every type-check and every package lint is clean.

Both overlay regression tests were checked by removing the guard they cover and confirming
that test, and only that test, fails.

Storybook builds clean and all eight stories render in light and dark with no page errors.

On the live EE dev stack at port 8780, driven through Chrome:

- The keyboard button is the last control in the playground top bar and carries
  `aria-keyshortcuts="?"`.
- `?` opens the sheet from the page and is ignored while the caret is in the composer.
- Escape closes the sheet.
- The sheet renders 1040px wide in three columns with all twelve groups and no scrollbar.
- `Alt+C` collapses the configuration panel and restores it. The `»` button reports
  `aria-keyshortcuts="Alt+C"` and the files caret reports `Alt+O`.
- The only console errors are PostHog 404s, which this dev stack has without the feature.

## Not verified, and cannot be from here

- The Alt chords on a real Windows browser and a real Linux desktop. On Linux a window manager
  can claim an Alt chord before the browser sees it, and no page code can help.
