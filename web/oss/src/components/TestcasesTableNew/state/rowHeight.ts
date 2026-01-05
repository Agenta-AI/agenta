import {
    createRowHeightAtom,
    DEFAULT_ROW_HEIGHT_CONFIG,
    type RowHeightConfig,
} from "@/oss/components/InfiniteVirtualTable"

/**
 * Testcase table row height configuration
 * Uses the generic IVT row height system with testcase-specific storage key
 */
export const TESTCASE_ROW_HEIGHT_CONFIG: RowHeightConfig = {
    ...DEFAULT_ROW_HEIGHT_CONFIG,
    storageKey: "agenta:testcase-table:row-height",
}

/**
 * Persisted atom for testcase table row height preference.
 * Stored in localStorage with key "agenta:testcase-table:row-height"
 */
export const testcaseRowHeightAtom = createRowHeightAtom(
    TESTCASE_ROW_HEIGHT_CONFIG.storageKey,
    TESTCASE_ROW_HEIGHT_CONFIG.defaultSize,
)
