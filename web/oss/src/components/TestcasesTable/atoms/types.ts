import type {InfiniteTableRowBase} from "@/oss/components/InfiniteVirtualTable"

/**
 * API response row from /preview/testcases/query
 * The `data` field is flattened into the row for column display
 */
export interface TestcaseApiRow {
    id: string
    testset_id: string
    created_at: string
    // Dynamic columns from testcase.data are spread here
    [key: string]: unknown
}

/**
 * Table row with key and skeleton flag
 */
export interface TestcaseTableRow extends InfiniteTableRowBase {
    id: string
    testset_id: string
    created_at: string
    // Dynamic columns from testcase.data
    [key: string]: unknown
}
