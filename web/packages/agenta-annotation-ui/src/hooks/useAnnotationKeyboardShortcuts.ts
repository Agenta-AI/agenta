import {useEffect} from "react"

interface UseAnnotationKeyboardShortcutsParams {
    onPrev: () => void
    onNext: () => void
    onSubmit: () => void
    hasPrev: boolean
    hasNext: boolean
    canSubmit: boolean
    enabled?: boolean
}

function isInteractiveTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false
    const tag = el.tagName
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
    if (el.isContentEditable) return true
    return false
}

export function useAnnotationKeyboardShortcuts({
    onPrev,
    onNext,
    onSubmit,
    hasPrev,
    hasNext,
    canSubmit,
    enabled = true,
}: UseAnnotationKeyboardShortcutsParams) {
    useEffect(() => {
        if (!enabled) return

        const listener = (e: KeyboardEvent) => {
            // Cmd/Ctrl+Enter: submit (works even from form fields)
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault()
                e.stopPropagation()
                if (canSubmit) onSubmit()
                return
            }

            // Arrow keys: skip when inside interactive elements
            if (isInteractiveTarget(e.target)) return

            if (e.key === "ArrowLeft" && hasPrev) {
                e.preventDefault()
                onPrev()
            } else if (e.key === "ArrowRight" && hasNext) {
                e.preventDefault()
                onNext()
            }
        }

        document.addEventListener("keydown", listener, true)
        return () => {
            document.removeEventListener("keydown", listener, true)
        }
    }, [onPrev, onNext, onSubmit, hasPrev, hasNext, canSubmit, enabled])
}
