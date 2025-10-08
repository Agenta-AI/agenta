// Types for testsets API

export interface PreviewTestsetsQueryPayload {
    testset?: {
        flags?: {
            has_testcases?: boolean
            has_traces?: boolean
        }
        meta?: Record<string, string>
        tags?: Record<string, string>
    }
    testset_refs?: {
        version?: string
        slug?: string
        id?: string
    }[]
    include_archived?: boolean
    windowing?: {
        newest?: string
        oldest?: string
        next?: string
        limit?: number
        order?: "ascending" | "descending"
        interval?: number
        rate?: number
    }
}
