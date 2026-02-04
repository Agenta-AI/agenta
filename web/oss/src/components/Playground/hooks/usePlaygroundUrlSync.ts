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

import {legacyAppRevisionMolecule} from "@agenta/entities/legacyAppRevision"
import {urlSnapshotController, pendingHydrations} from "@agenta/playground"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import {ensurePlaygroundDefaults, updatePlaygroundUrlWithDrafts} from "@/oss/state/url/playground"

import {selectedVariantsAtom, revisionListAtom} from "../state/atoms"

/**
 * Derived atom that computes a hash of all selected revisions' draft states.
 * This allows us to detect when any draft changes without violating hooks rules.
 */
const selectedDraftHashAtom = atom((get) => {
    const selectedVariants = get(selectedVariantsAtom)

    const parts = selectedVariants.map((revisionId) => {
        const isDirty = get(legacyAppRevisionMolecule.atoms.isDirty(revisionId))
        const draft = get(legacyAppRevisionMolecule.atoms.draft(revisionId))
        // Use full serialized string to detect any content change (not just length)
        const draftHash = draft ? JSON.stringify(draft) : ""
        return `${revisionId}:${isDirty}:${draftHash}`
    })

    return parts.join("|")
})

/**
 * Derived atom that tracks when server data becomes available for selected revisions.
 * Returns a hash of which revisions have server data loaded AND have variantId set.
 * Note: We need both serverData AND variantId to create local drafts for hydration.
 */
const selectedServerDataHashAtom = atom((get) => {
    const selectedVariants = get(selectedVariantsAtom)

    const parts = selectedVariants.map((revisionId) => {
        const serverData = get(legacyAppRevisionMolecule.atoms.serverData(revisionId))
        const hasData = serverData !== null && serverData !== undefined
        // Also track variantId since it's required for creating local drafts
        // variantId is set by useSetRevisionVariantContext after initial data load
        const hasVariantId = !!serverData?.variantId
        return `${revisionId}:${hasData}:${hasVariantId}`
    })

    return parts.join("|")
})

/**
 * Derived atom that tracks server data availability for pending hydration SOURCE revisions.
 *
 * This is critical for the pending hydration retry mechanism:
 * - When hydration runs on page load, source data may not be available yet
 * - Pending hydrations are queued with placeholder IDs in the selection
 * - We need to watch the SOURCE revision IDs (not placeholders) to know when to retry
 * - variantId must also be available (set by useSetRevisionVariantContext)
 */
const pendingHydrationSourceDataHashAtom = atom((get) => {
    // Get source revision IDs from pending hydrations
    const sourceIds = new Set<string>()
    for (const [, pending] of pendingHydrations.entries()) {
        sourceIds.add(pending.sourceRevisionId)
    }

    // Track server data availability for each source ID
    const parts: string[] = []
    for (const sourceId of sourceIds) {
        const serverData = get(legacyAppRevisionMolecule.atoms.serverData(sourceId))
        const hasData = serverData !== null && serverData !== undefined
        const hasVariantId = !!serverData?.variantId
        parts.push(`${sourceId}:${hasData}:${hasVariantId}`)
    }

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
    const revisions = useAtomValue(revisionListAtom)
    const hydrationComplete = useAtomValue(urlSnapshotController.selectors.hydrationComplete)
    const applyPendingHydrations = useSetAtom(urlSnapshotController.actions.applyPendingHydrations)
    const prevDraftHashRef = useRef<string>("")
    const hasAppliedDefaultsRef = useRef<boolean>(false)

    // Apply default selection when revision data becomes available
    // This handles the race condition where ensurePlaygroundDefaults is called
    // before revision data has loaded from the API
    useEffect(() => {
        if (hasAppliedDefaultsRef.current) {
            return
        }

        if (revisions.length > 0 && selectedVariants.length === 0) {
            hasAppliedDefaultsRef.current = true
            const store = getDefaultStore()
            ensurePlaygroundDefaults(store)
        }
    }, [revisions, selectedVariants])

    // Track server data availability for pending hydration SOURCE revisions
    // This is separate from selectedServerDataHashAtom because selectedVariants may contain
    // placeholder IDs, not the actual source revision IDs that pending hydrations depend on
    const pendingSourceDataHash = useAtomValue(pendingHydrationSourceDataHashAtom)

    // Apply pending hydrations when server data becomes available for their SOURCE revisions
    // The key insight is that we need to pass the SOURCE revision IDs to applyPendingHydrations,
    // not the selectedVariants (which may contain placeholder IDs like __pending_hydration__dk-xxx)
    useEffect(() => {
        if (hydrationComplete) {
            return
        }

        // Extract source revision IDs from pending hydrations
        const sourceIds = new Set<string>()
        for (const [, pending] of pendingHydrations.entries()) {
            sourceIds.add(pending.sourceRevisionId)
        }

        // Only apply if we have source IDs to process
        if (sourceIds.size > 0) {
            applyPendingHydrations(Array.from(sourceIds))
        }
    }, [pendingSourceDataHash, serverDataHash, hydrationComplete, applyPendingHydrations])

    // Update URL when drafts change
    useEffect(() => {
        if (draftHash === prevDraftHashRef.current) {
            return
        }

        prevDraftHashRef.current = draftHash
        updatePlaygroundUrlWithDrafts()
    }, [draftHash])
}
