import {memo} from "react"

import {testcase, type TestcaseColumn} from "@/oss/state/entities/testcase"
import type {Column} from "@/oss/state/entities/testcase/columnState"

import type {DrillInContentProps} from "./DrillInContent"
import {EntityDrillInView} from "./EntityDrillInView"

// Re-export TestcaseColumn for convenience
export type {TestcaseColumn} from "@/oss/state/entities/testcase"

// ============================================================================
// TYPES
// ============================================================================

export interface TestcaseDrillInViewProps
    extends Omit<DrillInContentProps, "getValue" | "setValue" | "getRootItems" | "valueMode"> {
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
 *
 * Uses the unified testcase entity API for all state management.
 * This is a thin wrapper that passes the testcase controller to EntityDrillInView.
 *
 * @example
 * ```tsx
 * <TestcaseDrillInView
 *   testcaseId={id}
 *   columns={columns}
 *   editable={true}
 *   showAddControls={true}
 *   showDeleteControls={true}
 * />
 * ```
 */
export const TestcaseDrillInView = memo(
    ({testcaseId, columns, ...drillInProps}: TestcaseDrillInViewProps) => {
        // Type assertion needed because testcase.drillIn is optional in the general type
        // but we know it's configured for the testcase entity
        const entityWithDrillIn = testcase as typeof testcase & {
            drillIn: NonNullable<typeof testcase.drillIn>
        }

        return (
            <EntityDrillInView
                entityId={testcaseId}
                entity={entityWithDrillIn}
                columns={columns}
                {...drillInProps}
            />
        )
    },
)

TestcaseDrillInView.displayName = "TestcaseDrillInView"
