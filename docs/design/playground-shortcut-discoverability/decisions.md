# Key assignment decisions

**Read this before you change, "simplify", or revert any Alt binding in the playground.**

Several of these letters look arbitrary. They are not. Each one was moved off a key that a
browser already claims, and moving it back re-breaks the shortcut on Windows or Linux.

The guard is `web/packages/agenta-ui/tests/unit/useSessionShortcuts.render.test.ts`, in the test
named "binds no letter a browser menu already claims". If you change a binding and that
test fails, the test is right and the change is wrong.

## The letters a browser owns

A web page that binds one of these fights the browser for the keystroke. Even where
`preventDefault` wins today, it is version-dependent and it is not worth relying on.

| Chord                                       | Who claims it                                                      |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `Alt+F`, `Alt+E`                            | Chrome and Edge open their main menu. Firefox opens File and Edit. |
| `Alt+V`, `Alt+S`, `Alt+B`, `Alt+T`, `Alt+H` | Firefox opens View, History, Bookmarks, Tools and Help.            |
| `Alt+D`                                     | Chrome, Edge and Firefox all focus the address bar.                |

`Alt` plus a digit is claimed by nothing, on any of the three platforms. `Alt+1…9` is safe.

## The letters macOS owns

On a Mac, `Option` plus a letter usually types a character, which `preventDefault` suppresses. Five
are different: `Option+E`, `Option+I`, `Option+U`, `Option+N` and `Option+` are DEAD KEYS that begin
an accent. Binding one of them stops a user typing `é í ü ñ à` in the composer.

This bit us. New session was moved to `Alt+N` on 2026-08-29, and `Option+N` is the tilde dead key,
so every macOS user would have created a session instead of typing `ñ`. It now uses the `+` key
(`event.code === "Equal"`), which matches the `+` button in the tab strip and is claimed by nothing.

Never bind `Alt` plus E, I, U or N.

## The letters are only proven safe in ENGLISH Firefox

Firefox builds its menu access keys from the localised menu names, so the reserved set changes with
the interface language. English reserves F, E, V, S, B, T and H. German reserves D, B, A, C, L, X
and H, for Datei, Bearbeiten, Ansicht, Chronik, Lesezeichen, Extras and Hilfe.

Three of our letters sit in the German set: `Alt+A` archives, `Alt+C` toggles the configuration and
`Alt+X` steps to the next session. A German Firefox user may get a menu instead. Other locales will
have their own sets, and we have not enumerated them.

The unit test below proves only the English case. Do not read it as proof for any other language.
Whether to keep `Alt` plus a letter at all, or move to a three-key chord such as `Alt+Shift+letter`
the way Linear does, is an open decision recorded in [status.md](status.md).

## What changed on 2026-08-29, and why

| Action              | Was     | Now     | Reason                                                                                                                              |
| ------------------- | ------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Search sessions     | `Alt+F` | `Alt+K` | `Alt+F` opens the browser menu. `K` is the search key across the industry, from `Cmd+K` command palettes.                           |
| Configuration panel | `Alt+B` | `Alt+C` | `Alt+B` opens Firefox's Bookmarks menu. `C` reads as Configuration.                                                                 |
| New session         | `Alt+C` | `Alt+N` | `N` reads as New, and moving it frees `C` for the panel above.                                                                      |
| Files pane          | none    | `Alt+O` | It had no shortcut. `O` is free in every browser. It is the weakest mnemonic in the set; change it if a better free letter appears. |

Unchanged, because they were already safe: `Alt+1…9`, `Alt+Z`, `Alt+X`, `Alt+W`, `Alt+R`,
`Alt+A`, `Alt+G`.

## Why the Alt modifier stays at all

Linear, the closest comparable product, binds plain single letters and two-letter runs such as
`g` then `i`, and reserves Alt for three-key combos only. That works because Linear's main
screens are lists and boards, where the caret is usually nowhere.

The playground is the opposite. The caret sits in the composer nearly the whole time, so a
plain letter would be swallowed as typed text. A modifier is not a style choice here, it is a
requirement. `Cmd`/`Ctrl` plus a digit is browser tab switching on every operating system, and
`Cmd`/`Ctrl` plus most letters is already taken by the browser, so `Alt` is what is left.

Three guards keep `Alt` from breaking normal typing, and all three are load-bearing:

- The handler matches `event.code`, the physical key position, not the character. On macOS,
  `Option` plus a letter types `ç Ω ≈ ∑ ® å ƒ ∫ ©`, and `Option+1` reports `event.key` as `¡`.
- The handler calls `preventDefault`, so none of those characters ever lands.
- The handler excludes `ctrlKey`. On European layouts AltGr reports as Ctrl plus Alt, so
  excluding Ctrl keeps `@ { } [ ] €` typing normally.

## Why `?` is matched on the character, not the position

`?` is `Shift+/` on a US layout, `Shift+ß` on a German one and `Shift+,` on a French one. The
shortcuts sheet matches `event.key`, which reports the produced character, so it opens on all
three. It is the one binding in the playground that deliberately does not use `event.code`.

It is also ignored whenever the caret is in an `input`, a `textarea`, or anything
content-editable, which includes the Lexical composer. Typing a question mark stays typing a
question mark.

## Still open

On Linux the window manager can claim an Alt chord before the browser ever sees it, and no
page code can help with that. Pressing all ten Alt chords once on a Linux desktop and once on
Windows would close this out. Nothing in the code can verify it.
