import {useMemo} from "react"

import {atom, useAtomValue} from "jotai"

import {testcase} from "@/oss/state/entities/testcase"

/**
 * Extract data fields from a testcase entity, removing metadata
 */
function extractTestcaseData(entity: Record<string, unknown>): Record<string, unknown> | null {
    if (!entity) return null

    // Remove metadata fields, keep only data columns
    // Note: rename testcase -> testcaseField to avoid shadowing imported controller
    const {
        id,
        key: _key,
        testset_id,
        set_id,
        testcase: testcaseField,
        data: dataField,
        created_at,
        updated_at,
        created_by_id,
        updated_by_id,
        deleted_at,
        deleted_by_id,
        flags,
        tags,
        meta,
        __isSkeleton,
        testcase_dedup_id,
        ...rest
    } = entity

    // Priority: testcase field > data field > rest of fields
    // This handles different API response structures
    if (testcaseField && typeof testcaseField === "object") {
        return testcaseField as Record<string, unknown>
    }
    if (dataField && typeof dataField === "object") {
        return dataField as Record<string, unknown>
    }

    return rest
}

/**
 * Extract selected testcases from entity atoms and convert to playground format
 *
 * Uses a derived atom for proper reactivity - when any selected entity changes,
 * this hook will re-render with updated data.
 *
 * @param revisionId - Current revision ID (for cache coherence)
 * @param selectedRowKeys - Array of selected testcase IDs
 * @returns Array of testcase data in playground format (no metadata)
 */
export const useSelectedTestcasesData = (
    revisionId: string | null,
    selectedRowKeys: React.Key[],
): Record<string, unknown>[] => {
    // Create a derived atom that subscribes to all selected entities
    // This provides proper reactivity - updates when any entity changes
    const selectedDataAtom = useMemo(
        () =>
            atom((get) => {
                if (!revisionId || !selectedRowKeys.length) return []

                return selectedRowKeys
                    .map((key) => {
                        try {
                            const testcaseId = String(key)
                            // Properly subscribe to entity via selector
                            const entity = get(testcase.selectors.data(testcaseId))
                            return extractTestcaseData(entity as Record<string, unknown>)
                        } catch (error) {
                            console.error(`Failed to extract testcase ${key}:`, error)
                            return null
                        }
                    })
                    .filter((data): data is Record<string, unknown> => data !== null)
            }),
        // Re-create atom when selection changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [revisionId, selectedRowKeys.join(",")],
    )

    return useAtomValue(selectedDataAtom)
}
