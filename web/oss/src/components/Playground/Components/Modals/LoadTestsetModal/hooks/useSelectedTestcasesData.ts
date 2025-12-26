import {useMemo} from "react"

import {getDefaultStore} from "jotai/vanilla"

import {testcaseEntityAtomFamily} from "@/oss/state/entities/testcase/testcaseEntity"

/**
 * Extract selected testcases from entity atoms and convert to playground format
 *
 * @param revisionId - Current revision ID (for cache coherence)
 * @param selectedRowKeys - Array of selected testcase IDs
 * @returns Array of testcase data in playground format (no metadata)
 */
export const useSelectedTestcasesData = (
    revisionId: string | null,
    selectedRowKeys: React.Key[],
): Record<string, any>[] => {
    const globalStore = useMemo(() => getDefaultStore(), [])

    return useMemo(() => {
        if (!revisionId || !selectedRowKeys.length) return []

        return selectedRowKeys
            .map((key) => {
                try {
                    const testcaseId = String(key)
                    const entity = globalStore.get(testcaseEntityAtomFamily(testcaseId))

                    if (!entity) return null

                    // Remove metadata fields, keep only data columns
                    const {
                        id,
                        key: _key,
                        testset_id,
                        set_id,
                        testcase,
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
                    if (testcase && typeof testcase === "object") {
                        return testcase as Record<string, any>
                    }
                    if (dataField && typeof dataField === "object") {
                        return dataField as Record<string, any>
                    }

                    return rest
                } catch (error) {
                    console.error(`Failed to extract testcase ${key}:`, error)
                    return null
                }
            })
            .filter((data): data is Record<string, any> => data !== null)
    }, [revisionId, selectedRowKeys, globalStore])
}
