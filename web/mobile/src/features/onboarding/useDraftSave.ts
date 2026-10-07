import {useCallback, useEffect, useRef} from "react"

import {saveOnboardingDraft, type OnboardingDraft} from "./onboardingDraft"

export const DRAFT_SAVE_DELAY_MS = 300

/** Saves the draft once edits pause; `flush` writes a pending save at once. */
export const useDraftSave = (draftKey: string, draft: OnboardingDraft) => {
    const pendingRef = useRef<{key: string; draft: OnboardingDraft} | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    const flush = useCallback(() => {
        clearTimeout(timerRef.current)
        const pending = pendingRef.current
        pendingRef.current = null
        if (pending) saveOnboardingDraft(pending.key, pending.draft)
    }, [])

    useEffect(() => {
        if (pendingRef.current && pendingRef.current.key !== draftKey) flush()
        pendingRef.current = {key: draftKey, draft}
        clearTimeout(timerRef.current)
        timerRef.current = setTimeout(flush, DRAFT_SAVE_DELAY_MS)
    }, [draftKey, draft, flush])

    useEffect(() => {
        // A reload, a redirect or a tab switch can end the page before the timer fires.
        const onHidden = () => {
            if (document.visibilityState === "hidden") flush()
        }
        window.addEventListener("pagehide", flush)
        document.addEventListener("visibilitychange", onHidden)
        return () => {
            window.removeEventListener("pagehide", flush)
            document.removeEventListener("visibilitychange", onHidden)
            flush()
        }
    }, [flush])

    return flush
}
