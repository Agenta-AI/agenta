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

## Where the code lives, and why `/m` can reuse it

Every piece sits in a package `/m` already depends on, so a mobile host wires callbacks rather
than reimplementing anything:

| Piece                                                           | Home                   |
| --------------------------------------------------------------- | ---------------------- |
| The registry, the ARIA names, the overlay guard                 | `@agenta/shared/utils` |
| `useSessionShortcuts`                                           | `@agenta/ui/shortcuts` |
| `ShortcutKeys`, `KeyboardShortcutsSheet`, `ShortcutsHelpButton` | `@agenta/ui/shortcuts` |

`useSessionShortcuts` started in the app layer and moved here. It takes every action as a
callback and imports only React and `@agenta/shared/utils`, so nothing about it was
desktop-specific. A phone never sends an Alt chord, so mounting it on a touch surface is inert.

What `/m` renders from this change today is the approval card with `touch` set, whose keycaps are
suppressed. The Storybook story **On mobile** pins that, because a keycap appearing there is a
regression nobody would catch by clicking on a desktop.

The open product question, before any mobile wiring: which of these shortcuts belong on a surface
that is also used on a phone. Session switching and the panel toggles earn their place in a
desktop browser pointed at `/m`; on a handset they are dead weight.

## Open decision: can `Alt` plus a letter work at all?

Codex found that the "safe letters" list in [decisions.md](decisions.md) only holds for English
Firefox. Firefox builds its menu access keys from the localised menu names, so German reserves
`Alt+A`, `Alt+C` and `Alt+X`, which collide with archive, configuration and next session. Other
locales will differ again, and enumerating them all is not realistic.

Two ways out, for a human to choose:

1. **Keep `Alt` plus a letter.** Cheapest, and the collision only bites Firefox users in a
   non-English interface, which is a small slice. The risk is a European user pressing `Alt+C` and
   getting a browser menu instead of the configuration panel, with nothing to tell them why.
2. **Move to `Alt+Shift` plus a letter.** No browser menu claims a three-key chord, which is why
   Linear uses that shape. It is correct in every locale. The cost is ergonomics: a three-key chord
   is worse for a shortcut you press many times a session, and every label grows.

The related open item is that the hook matches physical key positions (`event.code`) while the
sheet prints US letter legends. On AZERTY the key labelled `Z` reports `KeyW`, so the sheet says
`Alt+Z` while the user's key cap says `W`. Fixing that properly needs
`navigator.keyboard.getLayoutMap()` to derive the legend from the active layout.

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
