import {useCallback, useRef} from "react"

/** A menu verb. Return a function to have it run once the menu has closed. */
export type MenuSelect = (key: string) => (() => void) | void

/**
 * The close handoff every session menu shares.
 *
 * A menu item's `onSelect` runs while the menu is still open and still holding a focus trap, and
 * Radix then restores focus to the trigger as the menu closes. Work that PUTS THE CARET somewhere
 * — the inline rename editor is the only such verb — is blurred twice over if it runs there, and
 * a blur commits and closes the editor. So a verb may hand its work back as a function: it runs
 * from the close, after the trap is released, and the focus restore that would have undone it is
 * suppressed for that one close. Every other verb keeps the restore, because putting the caret
 * back on the row is the right behaviour for them.
 *
 * Shared so the right-click menu, the row kebab and the rail kebab cannot drift on it.
 */
export const useDeferredMenuSelect = (onSelect?: MenuSelect) => {
    // Held between the select and the close. A ref, not state: nothing renders from it, and the
    // close handler must read what the select just wrote without waiting for a commit.
    const deferredRef = useRef<(() => void) | null>(null)

    const handleSelect = useCallback(
        (key: string) => {
            deferredRef.current = onSelect?.(key) ?? null
        },
        [onSelect],
    )

    const handleCloseAutoFocus = useCallback((event: Event) => {
        const deferred = deferredRef.current
        deferredRef.current = null
        if (!deferred) return
        event.preventDefault()
        deferred()
    }, [])

    return {handleSelect, handleCloseAutoFocus}
}
