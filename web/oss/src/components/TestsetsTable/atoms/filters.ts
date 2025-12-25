import {atom} from "jotai"

export interface TestsetDateRange {
    from: string | null
    to: string | null
}

export interface TestsetFilters {
    dateCreated: TestsetDateRange | null
    dateModified: TestsetDateRange | null
}

// Filter state atoms
export const testsetsDateCreatedFilterAtom = atom<TestsetDateRange | null>(null)
export const testsetsDateModifiedFilterAtom = atom<TestsetDateRange | null>(null)

// Combined filters summary
export const testsetsFiltersSummaryAtom = atom((get) => {
    const dateCreated = get(testsetsDateCreatedFilterAtom)
    const dateModified = get(testsetsDateModifiedFilterAtom)

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
