/**
 * Hook to warn users when they have unsaved local drafts before leaving the page.
 *
 * Local drafts are session-only entities that exist in browser memory.
 * This hook ensures users don't accidentally lose their work.
 */

import {useEffect} from "react"

import {useAtomValue} from "jotai"

import {hasUnsavedLocalDraftsAtom, localDraftIdsAtom} from "@/oss/state/newPlayground"

/**
 * Shows a browser confirmation dialog when the user tries to leave the page
 * while they have unsaved local drafts.
 */
export function useLocalDraftWarning() {
    const hasUnsavedDrafts = useAtomValue(hasUnsavedLocalDraftsAtom)
    const localDraftIds = useAtomValue(localDraftIdsAtom)
    const hasAnyDrafts = localDraftIds.length > 0

    useEffect(() => {
        // Only warn if there are local drafts (saved or unsaved)
        // Users should be aware that local drafts will be lost on refresh
        if (!hasAnyDrafts) return

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            // Show warning message
            const message =
                "You have local draft revisions that will be lost if you leave. Are you sure you want to continue?"
            e.preventDefault()
            // Modern browsers ignore custom messages, but we set it anyway for older browsers
            e.returnValue = message
            return message
        }

        window.addEventListener("beforeunload", handleBeforeUnload)

        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload)
        }
    }, [hasAnyDrafts, hasUnsavedDrafts])
}
