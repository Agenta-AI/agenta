import {memo} from "react"

import type {Column} from "@/oss/state/entities/testcase/columnState"
import {
    getTestcaseValueAtPath,
    getTestcaseRootItems,
    testcaseSetValueAtPathAtom,
    type TestcaseColumn,
} from "@/oss/state/entities/testcase/drillInState"
import {testcaseEntityAtomFamily} from "@/oss/state/entities/testcase/testcaseEntity"

import {EntityDrillInView} from "./EntityDrillInView"
import type {DrillInContentProps} from "./DrillInContent"

// ============================================================================
// TYPES
// ============================================================================

export interface TestcaseDrillInViewProps
    extends Omit<
        DrillInContentProps,
        "getValue" | "setValue" | "getRootItems" | "valueMode"
    > {
    /** Testcase ID to display/edit */
    testcaseId: string
    /** Column definitions for the testcase (determines what fields to show) */
    columns: Column[] | TestcaseColumn[]
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Drill-in viewer for testcase data.
 * Wrapper around EntityDrillInView that provides testcase-specific configuration.
 *
 * This component handles:
 * - Reading testcase from entity atoms (includes draft if exists)
 * - Writing updates via testcase atoms
 * - Column-based field structure
 * - String value serialization
 */
export const TestcaseDrillInView = memo(
    ({testcaseId, columns, ...drillInProps}: TestcaseDrillInViewProps) => {
        return (
            <EntityDrillInView
                entityId={testcaseId}
                entityAtomFamily={testcaseEntityAtomFamily}
                getValueAtPath={getTestcaseValueAtPath}
                setValueAtPathAtom={testcaseSetValueAtPathAtom}
                getRootItems={getTestcaseRootItems}
                valueMode="string"
                columns={columns}
                {...drillInProps}
            />
        )
    },
)

TestcaseDrillInView.displayName = "TestcaseDrillInView"
