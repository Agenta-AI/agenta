/**
 * useTestsetSelection Hook
 *
 * Manages testset and revision selection state for the TestsetSelectionModal.
 * Handles loading revision info and tracking selection state.
 *
 * Note: The testsetName comes from the testset entity, not the revision.
 * We use testset.dataOptional to fetch the testset name when a revision is selected.
 */

import {useCallback, useMemo, useState} from "react"

// Clean entity imports from main package
import {testcase, revision, testset} from "@agenta/entities"
import {useAtomValue, useSetAtom} from "jotai"

import type {RevisionInfo, UseTestsetSelectionReturn} from "../types"

/**
 * Hook for managing testset/revision selection
 *
 * Note: This hook initializes state from props on mount only.
 * For modal usage, the parent component should use a key prop to force
 * remount when initial values change (e.g., key={connectedRevisionId}).
 *
 * @param initialRevisionId - Initial revision ID (for edit mode)
 * @param initialTestsetId - Initial testset ID (for edit mode)
 * @returns Selection state and handlers
 */
export function useTestsetSelection(
    initialRevisionId?: string,
    initialTestsetId?: string,
): UseTestsetSelectionReturn {
    // Track selected revision ID - initialized from props on mount
    const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(
        initialRevisionId ?? null,
    )

    // Track selected testset ID (for visual indicator) - initialized from props on mount
    const [selectedTestsetId, setSelectedTestsetId] = useState<string | null>(
        initialTestsetId ?? null,
    )

    // Get revision data when selected (for version number)
    // Using null-safe selectors to prevent unnecessary queries for empty IDs
    const revisionQuery = useAtomValue(
        useMemo(() => revision.queryOptional(selectedRevisionId), [selectedRevisionId]),
    )

    const revisionData = useAtomValue(
        useMemo(() => revision.dataOptional(selectedRevisionId), [selectedRevisionId]),
    )

    // Get testset data for the name (testset name is on the testset entity, not revision)
    // Using null-safe selector to prevent unnecessary queries for empty IDs
    const testsetData = useAtomValue(
        useMemo(() => testset.dataOptional(selectedTestsetId), [selectedTestsetId]),
    )

    // Build revision info from data
    const revisionInfo: RevisionInfo | null = useMemo(() => {
        if (!revisionData || !selectedTestsetId) return null

        const testsetName = (testsetData as {name?: string})?.name ?? "Unknown"
        const version = (revisionData as {version?: number}).version ?? 1

        return {
            testsetName,
            testsetId: selectedTestsetId,
            version,
        }
    }, [revisionData, testsetData, selectedTestsetId])

    // Track loading state
    const isLoading = revisionQuery?.isPending ?? false

    // Set revision context using molecule action (sets both context and paginated store atoms)
    const setRevisionContext = useSetAtom(testcase.actions.setRevisionContext)

    // Handle selection change (both revision and testset)
    const handleSetSelection = useCallback(
        (revisionId: string | null, testsetId: string | null) => {
            setSelectedRevisionId(revisionId)
            setSelectedTestsetId(testsetId)
            // Set revision context using molecule action
            setRevisionContext(revisionId)
        },
        [setRevisionContext],
    )

    return {
        selectedRevisionId,
        selectedTestsetId,
        setSelection: handleSetSelection,
        revisionInfo,
        isLoading,
    }
}
