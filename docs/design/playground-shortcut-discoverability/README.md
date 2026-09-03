# Playground shortcut discoverability

The agent playground binds forty-three keyboard shortcuts across six files. Six of them name a
key on screen. The rest are unreachable unless you read the source.

This project gives every shortcut a place where a user can find it, adds two that were missing,
and moves three Alt letters off keys that browsers claim on Windows and Linux.

## The files here

| File                         | What it holds                                                        |
| ---------------------------- | -------------------------------------------------------------------- |
| [context.md](context.md)     | What shipped before this project, and what the user asked for        |
| [research.md](research.md)   | The full inventory, the browser key conflicts, and what Linear does  |
| [decisions.md](decisions.md) | **Why each key is what it is. Read this before changing a binding.** |
| [plan.md](plan.md)           | The slices and their acceptance checks                               |
| [status.md](status.md)       | What is done, what is left                                           |

## The short version

- One registry, `web/packages/agenta-shared/src/utils/shortcuts.ts`, owns every binding's keys
  and label. Tooltips, keycaps and the shortcuts sheet all read it, so a label can never drift
  away from the handler.
- Keys appear on the control that already does the job: a tooltip, or a keycap on the button.
- The eleven shortcuts that answer no control live in a sheet, opened with `?` or from a
  keyboard button at the right edge of the playground top bar.
- The Alt letters avoid every browser menu key. A unit test fails if one is ever bound again.
