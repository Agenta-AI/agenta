import {useEffect} from "react"

import {isOverlayOpen} from "@agenta/shared/utils"

/** How many open sessions the digit row can reach. */
export const SESSION_SHORTCUT_MAX = 9

export interface UseSessionShortcutsParams {
    /** Open sessions in tab order — position N is `sessions[N - 1]`. */
    sessions: readonly {id: string}[]
    activeId?: string
    enabled?: boolean
    onJump: (id: string) => void
    onRename: (id: string) => void
    onArchive: (id: string) => void
    onNewSession: () => void
    onCloseSession: (id: string) => void
    onSearch: () => void
    onToggleConfigPanel: () => void
    onToggleFilesPane: () => void
}

/** A bare Alt chord: no AltGr (Ctrl+Alt), no Cmd or Shift, not a repeat or an IME keystroke.
 * Exported because the run-level shortcuts live with the conversation that owns the run. */
export const isAltChord = (e: KeyboardEvent): boolean =>
    e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat && !e.isComposing

/** Physical keys that step through the strip, one session at a time. Z and X sit directly above
 * Alt/Option, so the whole set stays under one resting hand — the reason they're positions
 * (`event.code`), not letters, on a non-QWERTY layout. */
const STEP_BY_CODE: Record<string, -1 | 1> = {KeyZ: -1, KeyX: 1}

/** The session one step from `activeId`, wrapping at both ends. Null when there's nowhere to go. */
const steppedSession = <T extends {id: string}>(
    sessions: readonly T[],
    activeId: string | undefined,
    step: -1 | 1,
): T | null => {
    if (sessions.length === 0) return null
    // An unknown active id (its tab just closed) steps from the head, as the panel's own fallback does.
    const current = sessions.findIndex((session) => session.id === activeId)
    const from = current === -1 ? 0 : current
    return sessions[(from + step + sessions.length) % sessions.length] ?? null
}

/**
 * Session shortcuts for the agent playground: `Alt+1…9` jumps to the Nth open session, `Alt+Z` and
 * `Alt+X` step to the previous/next one (wrapping), `Alt+N` opens a new session, `Alt+W` closes the
 * active one, `Alt+R` renames it, `Alt+A` archives it, `Alt+K` searches, `Alt+C` toggles the config
 * panel, `Alt+O` toggles the files pane. Stop and approve live with the conversation that owns the
 * run, not here.
 *
 * Alt alone, because ⌘/Ctrl+digit is browser tab switching on every OS, and one binding for all
 * platforms (the label differs, the keys don't). Matched on `event.code`: macOS Option+1 reports
 * `event.key` as `¡`. Excluding `ctrlKey` keeps European AltGr (which reports as Ctrl+Alt) typing
 * normally. These fire from any focus context, the composer included — that's the point of a
 * modifier combo here, and no plain-key binding is introduced that could swallow typed text.
 *
 * The letters avoid every browser menu mnemonic: Chrome and Edge open their menu on `Alt+F`/`Alt+E`,
 * Firefox opens File/Edit/View/History/Bookmarks/Tools/Help on `Alt+F/E/V/S/B/T/H`, and both focus
 * the address bar on `Alt+D`. Search moved off `F` and the config panel off `B` for that reason.
 */
export function useSessionShortcuts({
    sessions,
    activeId,
    enabled = true,
    onJump,
    onRename,
    onArchive,
    onNewSession,
    onCloseSession,
    onSearch,
    onToggleConfigPanel,
    onToggleFilesPane,
}: UseSessionShortcutsParams) {
    useEffect(() => {
        if (!enabled) return

        const listener = (e: KeyboardEvent) => {
            if (!isAltChord(e)) return
            if (isOverlayOpen()) return

            /** Every branch below acts, so claiming the key up front keeps this readable. */
            const claim = () => {
                e.preventDefault()
                e.stopPropagation()
            }

            const digit = /^Digit([1-9])$/.exec(e.code)
            if (digit) {
                const target = sessions[Number(digit[1]) - 1]
                if (!target) return
                claim()
                onJump(target.id)
                return
            }

            const step = STEP_BY_CODE[e.code]
            if (step) {
                const target = steppedSession(sessions, activeId, step)
                if (!target) return
                claim()
                onJump(target.id)
                return
            }

            if (e.code === "KeyN") {
                claim()
                onNewSession()
                return
            }
            if (e.code === "KeyK") {
                claim()
                onSearch()
                return
            }
            if (e.code === "KeyC") {
                claim()
                onToggleConfigPanel()
                return
            }
            // The files pane is per-session: with no active session the panel renders none, so
            // toggling would flip a state nothing shows.
            if (e.code === "KeyO") {
                if (!activeId) return
                claim()
                onToggleFilesPane()
                return
            }

            // The rest act on the active session. Closing the last one would leave the panel to
            // re-seed an empty tab, so it needs a sibling to fall back to.
            if (!activeId) return
            if (e.code === "KeyR") {
                claim()
                onRename(activeId)
            } else if (e.code === "KeyA") {
                claim()
                onArchive(activeId)
            } else if (e.code === "KeyW" && sessions.length > 1) {
                claim()
                onCloseSession(activeId)
            }
        }

        document.addEventListener("keydown", listener, true)
        return () => {
            document.removeEventListener("keydown", listener, true)
        }
    }, [
        sessions,
        activeId,
        enabled,
        onJump,
        onRename,
        onArchive,
        onNewSession,
        onCloseSession,
        onSearch,
        onToggleConfigPanel,
        onToggleFilesPane,
    ])
}
