# Session bar shortcuts: notes to reconsider

The session tab strip became one switcher in the V1 session bar, so some shortcuts lost the
model they were built on. This note lists what still works and what we should reconsider.

## Reconsider or remove

| Shortcut | What it does now | Why reconsider |
|---|---|---|
| `Alt+W` | Nothing on `/m`. The key goes back to the browser. | There are no tabs to close. The `onCloseSession` option in `useSessionShortcuts` exists only for the old desktop app. Remove it with that app. |
| `Alt+1…9` | Opens the Nth row of the session list. | The list sorts by recent activity. Positions move after every message, so a number does not stay with a session. |
| `Alt+Z`, `Alt+X` | Steps through the same list. | Same problem. The next session changes as the list reorders. Z and X also do not suggest previous and next. |
| `Alt+K` | Opens the switcher with the search focused. | `⌘K` opens the app-wide palette, which also finds sessions. Two search keys for one idea. |
| `Alt+A` | Archives the session on screen and moves you off it. | One chord, no confirmation, no undo on screen. It is easy to press by accident. |
| `Alt++` | Starts a new session. | The design shows `⌥N`, but Option+N is a dead key on macOS and would break `ñ` in the composer. `+` needs the `=` key, which moves on non-US layouts. |

## Keep

| Shortcut | What it does |
|---|---|
| `Alt+C` | Shows or hides the configuration. |
| `Alt+O` | Shows or hides the files pane. |
| `Alt+R` | Renames the session on screen. Only the owner gets the editor. |
| `?` | Opens the shortcuts sheet. |

## Controls to reconsider

- "Session history" in the ⋯ menu opens the switcher, so it repeats the switcher itself. It
  stays because the design shows it.
- Chat mode (`chatPanelMaximizedAtom`) has no control on `/m` any more. `Alt+K` used to toggle
  it. The flag can still arrive from the old desktop app through local storage, and the bar's
  "Show configuration" clears it.
