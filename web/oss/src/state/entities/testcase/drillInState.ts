import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {PathItem} from "@/oss/components/DrillInView"
import type {DataType} from "@/oss/components/TestcasesTableNew/components/TestcaseEditDrawer/fieldUtils"

import {createDrillInState} from "../shared/createDrillInState"

import type {FlattenedTestcase} from "./schema"
import {testcaseEntityAtomFamily, updateTestcaseAtom} from "./testcaseEntity"

// ============================================================================
// TYPES
// ============================================================================

export interface TestcaseColumn {
    key: string
    name: string
}

// ============================================================================
// DRILL-IN STATE (Path-based navigation and editing)
// Uses shared factory with testcase-specific configuration
// ============================================================================

/**
 * Create drill-in state management for testcases
 * Uses shared factory with column-based structure and string serialization
 */
const testcaseDrillIn = createDrillInState<FlattenedTestcase, FlattenedTestcase>({
    // Entire testcase entity is the root data (column-based structure)
    getRootData: (entity) => entity,

    // Generate root items from columns (defined at call site since columns are dynamic)
    // This is a placeholder - actual implementation uses getTestcaseRootItems below
    getRootItems: () => [],

    // Use testcase update atom for mutations
    updateAtom: updateTestcaseAtom,

    // Set updated data back to entity
    // For testcases, the path[0] is the column key, so extract only that field
    setRootData: (_entity, rootData, path) => {
        if (path.length === 0) return rootData
        // Extract only the top-level field that changed
        const topLevelKey = path[0]
        return {
            [topLevelKey]: (rootData as Record<string, unknown>)[topLevelKey],
        } as Partial<FlattenedTestcase>
    },

    // String mode - values are JSON strings
    valueMode: "string",

    // Entity atom family (includes draft state)
    entityAtomFamily: testcaseEntityAtomFamily,
})

// Export read helper with original name
export const getTestcaseValueAtPath = testcaseDrillIn.getValueAtPath

/**
 * Get root items (columns) for a testcase entity
 * Custom implementation because columns are provided externally (not in entity)
 */
export function getTestcaseRootItems(
    entity: FlattenedTestcase | null,
    columns: TestcaseColumn[],
): PathItem[] {
    if (!entity) return []

    return columns.map((col) => ({
        key: col.key,
        name: col.name,
        value: (entity as Record<string, unknown>)[col.key] || "",
        isColumn: true, // Prevents deletion of column
    }))
}

// Export write atom with original name
export const testcaseSetValueAtPathAtom = testcaseDrillIn.setValueAtPathAtom

// Export UI state atoms with original names
export const testcaseDrillInCurrentPathAtomFamily = testcaseDrillIn.currentPathAtomFamily
export const testcaseDrillInCollapsedFieldsAtomFamily = testcaseDrillIn.collapsedFieldsAtomFamily
export const testcaseDrillInRawModeFieldsAtomFamily = testcaseDrillIn.rawModeFieldsAtomFamily
