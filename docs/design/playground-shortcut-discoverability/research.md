# Research

## The full inventory

The registry `web/packages/agenta-shared/src/utils/shortcuts.ts` holds 45 entries. Forty-three
of them were already bound in the code before this project; two are new, the files pane and
the shortcuts sheet itself. Counts below are the registry's own groups.

| Group                | Entries | Named on screen before |
| -------------------- | ------- | ---------------------- |
| Sessions             | 7       | 0                      |
| Side panels          | 2       | 0 (one did not exist)  |
| While the agent runs | 2       | 0                      |
| Composer             | 6       | 2                      |
| The `/` menu         | 3       | 0                      |
| Permission picker    | 5       | 0                      |
| Approval card        | 2       | 0                      |
| Connection dock      | 2       | 0                      |
| Forms the agent asks | 11      | 3                      |
| Voice                | 2       | 1                      |
| Renaming a session   | 2       | 0                      |
| Help                 | 1       | 0 (did not exist)      |

The prompt playground's `Cmd/Ctrl+Enter` "Run all" is a separate page and is not in the
registry. It already names its key in a tooltip.

### The `/` menu and the permission picker are two surfaces, not one

They look like one list and they are not. Getting this wrong would have made the sheet lie.

- The `/` menu is `web/packages/agenta-ui/src/RichChatInput/plugins/SlashCommandPlugin.tsx`.
  It registers exactly five Lexical commands: ArrowDown, ArrowUp, Escape, Enter and Tab. Enter
  and Tab both pick the active item. It binds no Home, no End, no ArrowLeft.
- The permission picker is `web/oss/src/components/AgentChatSlice/components/SlashCommand/useRovingList.ts`,
  used only by `PermissionsPickerPanel.tsx`. That one binds Home, End and ArrowLeft.

So the registry keeps them as separate groups. Merging them would promise Home and End inside
the `/` menu, where nothing answers.

## What is safe on all three platforms

Every `Cmd/Ctrl+Enter` binding tests `metaKey || ctrlKey`, so the same code answers Cmd on
Apple hardware and Ctrl everywhere else. Plain keys (`Esc`, the arrows, `Home`, `End`,
`Space`, the digits, `Enter`) have nothing platform-specific to collide with.

Push to talk was already handled correctly before this project. It binds only the left Alt off
Apple hardware, because the right Alt is AltGr, and it arms only after a 300ms hold so a tap
types nothing. `web/packages/agenta-shared/src/utils/platform.ts` already exported
`modifierKeyLabel()`, `altKeyPrefix()` and `pushToTalkLabel()`, so the labels were
platform-aware before any of them were printed.

## The browser key conflicts

Measured against Chrome, Edge and Firefox on Windows and Linux. The table lives in
[decisions.md](decisions.md), which is the file to read before changing a binding.

Two of the nine Alt letters sat on browser menu keys: search on `Alt+F` and the configuration
panel on `Alt+B`. Both are now moved.

## Keystrokes leak through an open overlay

Radix's dismissable layer
(`@radix-ui/react-dismissable-layer/dist/index.mjs:91-106`) listens for Escape in the capture
phase and calls `preventDefault()`, but it never calls `stopPropagation()`. Every bubble-phase
handler still runs. It does not touch `Cmd/Ctrl+Enter` at all.

Adding a dialog the product tells you to open at any time made that reachable: pressing Escape
to close the shortcuts sheet also denied a parked tool call, and `Cmd/Ctrl+Enter` approved one
the user could not see. Opening the top bar's settings menu and pressing Escape denied a gate
the same way.

Two guards are needed and each covers what the other misses:

| Case                                 | `isOverlayOpen()` | `event.defaultPrevented` |
| ------------------------------------ | ----------------- | ------------------------ |
| Escape under a dialog                | catches           | catches                  |
| `Cmd/Ctrl+Enter` under a dialog      | catches           | misses                   |
| Escape under a Radix menu or popover | misses            | catches                  |
| Escape under an antd Modal           | catches           | misses                   |

`isOverlayOpen()` misses menus and popovers because they are `role="menu"` and
`role="listbox"`, not `role="dialog"`. `defaultPrevented` misses the antd modal because
rc-dialog does not cancel the event, and misses `Cmd/Ctrl+Enter` because Radix never
intercepts it.

One case stays deliberately uncovered. The workflow revision drawer is antd's `Drawer`, whose
panel renders `role="dialog"` with no `data-state`, so `isOverlayOpen()` returns false while it
is open. That is why the Alt shortcuts and `Esc`-to-stop already work inside that drawer, and
it must stay that way.

## What Linear does

Sources:

- [Keyboard shortcuts help changelog](https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help)
- [Linear keyboard shortcuts collection](https://keycombiner.com/collections/linear/)

Findings:

- `?` opens a searchable shortcuts panel. There is also a "Help & Feedback" entry in the
  sidebar that reaches the same panel. A hotkey with no visible button teaches nobody, so the
  two ship together.
- Navigation uses plain single letters and two-letter runs, such as `g` then `i` for the
  inbox. Shortcuts go quiet while the user is editing.
- Global actions use `Ctrl`/`Cmd` plus a letter: `Ctrl+K` for the command menu, `Ctrl+I` to
  open the details sidebar, `Ctrl+B` to switch list and board.
- Alt appears only in three-key combos, never as `Alt` plus a single letter. Examples:
  `Alt+Shift+F` to clear filters, `Ctrl+Alt+1…9` to set a status.

## Why we did not copy the plain-letter scheme

Linear's plain letters work because its main screens are lists and boards, where the caret is
usually nowhere. The playground is the opposite: the caret sits in the composer nearly the
whole time. A plain letter there would be swallowed as typed text.

`useSessionShortcuts.ts` states this constraint directly: the shortcuts must fire from any
focus context, the composer included, and that is the point of using a modifier. So the
modifier stays, and what we borrowed from Linear is the letter discipline, the `?` hotkey, and
the visible button beside it.
