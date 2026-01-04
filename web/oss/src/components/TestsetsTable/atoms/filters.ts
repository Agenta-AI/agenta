import {atom} from "jotai"

import {testset} from "@/oss/state/entities/testset"

// Re-export date range type from entity store
export type {TestsetDateRange} from "@/oss/state/entities/testset"

export interface TestsetFilters {
    dateCreated: {from?: string | null; to?: string | null} | null
    dateModified: {from?: string | null; to?: string | null} | null
}

// Re-export filter atoms from entity store for backwards compatibility
export const testsetsDateCreatedFilterAtom = testset.filters.dateCreated
export const testsetsDateModifiedFilterAtom = testset.filters.dateModified

// Combined filters summary
export const testsetsFiltersSummaryAtom = atom((get) => {
    const dateCreated = get(testset.filters.dateCreated)
    const dateModified = get(testset.filters.dateModified)

    return {
        dateCreated,
        dateModified,
        hasFilters: Boolean(dateCreated || dateModified),
    }
})

// Filter button state (default or primary based on active filters)
export const testsetsFiltersButtonStateAtom = atom((get) => {
    const summary = get(testsetsFiltersSummaryAtom)
    const filterCount = [summary.dateCreated, summary.dateModified].filter(Boolean).length

    return {
        filterCount,
        buttonType: filterCount > 0 ? "primary" : "default",
    }
})
