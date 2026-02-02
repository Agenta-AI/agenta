/**
 * Hook to sync playground state (selection + drafts) to URL in real-time.
 *
 * This hook watches for changes in:
 * 1. Selected variants (revision IDs)
 * 2. Draft changes on selected revisions
 *
 * When changes occur, it updates the URL with a snapshot that includes
 * draft patches, enabling shareable URLs with uncommitted changes.
 *
 * It also handles applying pending hydration patches when revision data loads.
 */

import {useEffect, useRef} from "react"

import {ossAppRevisionMolecule} from "@agenta/entities/ossAppRevision"
import {urlSnapshotController} from "@agenta/playground"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {updatePlaygroundUrlWithDrafts} from "@/oss/state/url/playground"

import {selectedVariantsAtom} from "../state/atoms"

/**
 * Derived atom that computes a hash of all selected revisions' draft states.
 * This allows us to detect when any draft changes without violating hooks rules.
 */
const selectedDraftHashAtom = atom((get) => {
    const selectedVariants = get(selectedVariantsAtom)

    const parts = selectedVariants.map((revisionId) => {
        const isDirty = get(ossAppRevisionMolecule.atoms.isDirty(revisionId))
        const draft = get(ossAppRevisionMolecule.atoms.draft(revisionId))
        // Use full serialized string to detect any content change (not just length)
        const draftHash = draft ? JSON.stringify(draft) : ""
        return `${revisionId}:${isDirty}:${draftHash}`
    })

    return parts.join("|")
})

/**
 * Derived atom that tracks when server data becomes available for selected revisions.
 * Returns a hash of which revisions have server data loaded.
 * Note: We only need serverData to apply the patch - schema is for UI rendering.
 */
const selectedServerDataHashAtom = atom((get) => {
    const selectedVariants = get(selectedVariantsAtom)

    const parts = selectedVariants.map((revisionId) => {
        const serverData = get(ossAppRevisionMolecule.atoms.serverData(revisionId))
        const hasData = serverData !== null && serverData !== undefined
        return `${revisionId}:${hasData}`
    })

    return parts.join("|")
})

/**
 * Sync playground state to URL whenever selection or drafts change.
 * Also applies pending hydration patches when revision data loads.
 *
 * Uses urlSnapshotController.actions.applyPendingHydrations and
 * urlSnapshotController.selectors.hydrationComplete.
 *
 * Usage: Call this hook once in the main Playground component.
 */
export function usePlaygroundUrlSync() {
    const draftHash = useAtomValue(selectedDraftHashAtom)
    const serverDataHash = useAtomValue(selectedServerDataHashAtom)
    const selectedVariants = useAtomValue(selectedVariantsAtom)
    const hydrationComplete = useAtomValue(urlSnapshotController.selectors.hydrationComplete)
    const applyPendingHydrations = useSetAtom(urlSnapshotController.actions.applyPendingHydrations)
    const prevDraftHashRef = useRef<string>("")

    // Apply pending hydrations when server data becomes available
    // URL will be rebuilt by the draftHash effect when draft state changes
    useEffect(() => {
        if (hydrationComplete) {
            return
        }

        applyPendingHydrations(selectedVariants)
    }, [serverDataHash, selectedVariants, hydrationComplete, applyPendingHydrations])

    // Update URL when drafts change
    useEffect(() => {
        if (draftHash === prevDraftHashRef.current) {
            return
        }

        prevDraftHashRef.current = draftHash
        updatePlaygroundUrlWithDrafts()
    }, [draftHash])
}
