import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {Testset} from "@/oss/lib/Types"
import {fetchTestset} from "@/oss/services/testsets/api"

export interface TestsetCsvParams {
    testsetId?: string
    enabled?: boolean
}

/**
 * Atom family to fetch CSV data for a given testset ID.
 * Returns the raw csvdata array from the testset response.
 */
export const testsetCsvDataQueryAtomFamily = atomFamily((params: TestsetCsvParams) =>
    atomWithQuery<Testset["csvdata"]>((get) => {
        const {testsetId, enabled = true} = params || {}
        return {
            queryKey: ["testsetCsvData", testsetId],
            queryFn: async () => {
                if (!testsetId) return []
                const data = await fetchTestset(testsetId)
                return data.csvdata || []
            },
            enabled: !!testsetId && enabled,
            staleTime: 1000 * 60 * 2, // 2 minutes
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
        }
    }),
)
