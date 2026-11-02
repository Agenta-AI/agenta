import {useEffect, useRef} from "react"

interface AnnotationShortcuts {
    onPrev: () => void
    onNext: () => void
    onSubmit: () => void
    hasPrev: boolean
    hasNext: boolean
    canSubmit: boolean
    enabled: boolean
}

/** Controls that use the arrow keys themselves: a slider, True and False, tabs, menus, lists. */
const ARROW_KEY_CONTROLS =
    "[role=slider],[role=radiogroup],[role=radio],[role=tablist],[role=menu],[role=listbox],[role=combobox]"

/** Typing in a field, or moving a control with the arrows, must not move to another scenario. */
const ownsArrowKeys = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
        return true
    }
    return target.closest(ARROW_KEY_CONTROLS) !== null
}

/**
 * The session's keys: the left and right arrows move between scenarios, except inside a field or
 * a control that uses the arrows itself; Cmd or Ctrl+Enter submits from anywhere.
 */
export const useAnnotationKeyboardShortcuts = (shortcuts: AnnotationShortcuts) => {
    // One listener for the life of the screen; it reads the newest handlers through the ref.
    const latest = useRef(shortcuts)
    useEffect(() => {
        latest.current = shortcuts
    })
    const {enabled} = shortcuts

    useEffect(() => {
        if (!enabled) return
        const onKeyDown = (event: KeyboardEvent) => {
            const current = latest.current
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault()
                event.stopPropagation()
                if (current.canSubmit) current.onSubmit()
                return
            }
            if (ownsArrowKeys(event.target)) return
            if (event.key === "ArrowLeft" && current.hasPrev) {
                event.preventDefault()
                current.onPrev()
            } else if (event.key === "ArrowRight" && current.hasNext) {
                event.preventDefault()
                current.onNext()
            }
        }
        document.addEventListener("keydown", onKeyDown, true)
        return () => document.removeEventListener("keydown", onKeyDown, true)
    }, [enabled])
}
