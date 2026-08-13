import {useEffect} from "react"

/** How many open sessions the digit row can reach. 9 is the whole row; lower it and both the
 * matcher below and the tab chips' advertised shortcuts follow. */
export const SESSION_SHORTCUT_MAX = 9

/** The 1-based tab position an `event.code` addresses, or null when it isn't a bound digit. */
export const shortcutPosition = (code: string): number | null => {
    const match = /^Digit([1-9])$/.exec(code)
    if (!match) return null
    const position = Number(match[1])
    return position <= SESSION_SHORTCUT_MAX ? position : null
}

export interface UseSessionShortcutsParams {
    /** Open sessions in tab order — position N is `sessions[N - 1]`. */
    sessions: readonly {id: string}[]
    activeId?: string
    enabled?: boolean
    onJump: (id: string) => void
    onRename: (id: string) => void
    onArchive: (id: string) => void
}

/** True while an antd confirm/modal or a Radix dialog owns the screen. No global open-dialog state
 * exists to ask, and these dialogs come from `modal.confirm`, so the DOM is the only witness. */
const isOverlayOpen = (): boolean =>
    Boolean(
        document.querySelector(
            '.ant-modal-wrap:not([style*="display: none"]), [role="dialog"][data-state="open"]',
        ),
    )

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
 * `Alt+X` step to the previous/next one (wrapping), `Alt+R` renames the active one, `Alt+A`
 * archives it.
 *
 * Alt alone, because ⌘/Ctrl+digit is browser tab switching on every OS, and one binding for all
 * platforms (the label differs, the keys don't). Matched on `event.code`: macOS Option+1 reports
 * `event.key` as `¡`. Excluding `ctrlKey` keeps European AltGr (which reports as Ctrl+Alt) typing
 * normally. These fire from any focus context, the composer included — that's the point of a
 * modifier combo here, and no plain-key binding is introduced that could swallow typed text.
 */
export function useSessionShortcuts({
    sessions,
    activeId,
    enabled = true,
    onJump,
    onRename,
    onArchive,
}: UseSessionShortcutsParams) {
    useEffect(() => {
        if (!enabled) return

        const listener = (e: KeyboardEvent) => {
            if (e.repeat || e.isComposing) return
            if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
            if (isOverlayOpen()) return

            const position = shortcutPosition(e.code)
            if (position) {
                const target = sessions[position - 1]
                if (!target) return
                e.preventDefault()
                e.stopPropagation()
                onJump(target.id)
                return
            }

            const step = STEP_BY_CODE[e.code]
            if (step) {
                const target = steppedSession(sessions, activeId, step)
                if (!target) return
                e.preventDefault()
                e.stopPropagation()
                onJump(target.id)
                return
            }

            if (e.code !== "KeyR" && e.code !== "KeyA") return
            if (!activeId) return
            e.preventDefault()
            e.stopPropagation()
            if (e.code === "KeyR") onRename(activeId)
            else onArchive(activeId)
        }

        document.addEventListener("keydown", listener, true)
        return () => {
            document.removeEventListener("keydown", listener, true)
        }
    }, [sessions, activeId, enabled, onJump, onRename, onArchive])
}
