# Session bar shortcuts: notes to reconsider

The desktop session bar shows sessions as a rail of tabs, and a phone uses a dropdown. This note
lists the shortcuts we should reconsider.

## Reconsider or remove

| Shortcut | What it does now | Why reconsider |
|---|---|---|
| `Alt+K` | Opens the session search. | `⌘K` opens the app-wide palette, which also finds sessions. Two search keys for one idea. |
| `Alt+A` | Archives the session on screen and moves you off it. | One chord, no confirmation, no undo on screen. It is easy to press by accident. |
| `Alt++` | Starts a new session. | The design shows `⌥N`, but Option+N is a dead key on macOS and would break `ñ` in the composer. `+` needs the `=` key, which moves on non-US layouts. |
| `Alt+Z`, `Alt+X` | Steps through the tabs. | Z and X do not suggest previous and next. |

## Keep

| Shortcut | What it does |
|---|---|
| `Alt+C` | Shows or hides the configuration. |
| `Alt+O` | Shows or hides the files pane. |
| `Alt+R` | Renames the session on screen. Only the owner gets the editor. |
| `?` | Opens the shortcuts sheet. |
| `Alt+1…9` | Opens the Nth tab. The tabs keep their order. |
| `Alt+W` | Closes the tab. |

## Controls to reconsider

- Chat mode (`chatPanelMaximizedAtom`) has no control on `/m` any more. `Alt+K` used to toggle
  it. The flag can still arrive from the old desktop app through local storage, and the bar's
  "Show configuration" clears it.
