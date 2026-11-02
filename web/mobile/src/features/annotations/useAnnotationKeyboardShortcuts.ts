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

/** Typing in a field must not move to another scenario. */
const isTypingTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
}

/**
 * The session's keys: the left and right arrows move between scenarios outside of fields, and
 * Cmd or Ctrl+Enter submits from anywhere, fields included.
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
            if (isTypingTarget(event.target)) return
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
