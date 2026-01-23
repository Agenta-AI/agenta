/**
 * Loadable Bridge Configuration
 *
 * Configures the loadable bridge with available source types.
 * This is where molecule integrations are defined.
 *
 * @example
 * ```typescript
 * import { loadableBridge } from '@agenta/entities/loadable'
 *
 * // Use unified API
 * const rows = useAtomValue(loadableBridge.selectors.rows(loadableId))
 *
 * // Or access source-specific features
 * const testcaseController = loadableBridge.source('testcase')
 * ```
 */

import {createLoadableBridge, type LoadableRow} from "../shared"
import {testcaseMolecule} from "../testcase"

// ============================================================================
// TESTCASE SOURCE CONFIGURATION
// ============================================================================

/**
 * Transform testcase entity to loadable row format
 */
function testcaseToRow(entity: unknown): LoadableRow {
    if (!entity || typeof entity !== "object") {
        return {id: "", data: {}}
    }

    const e = entity as Record<string, unknown>
    const data: Record<string, unknown> = {}

    // Extract data fields, excluding system fields
    for (const [key, value] of Object.entries(e)) {
        // Skip system fields
        if (key === "id" || key === "flags" || key === "tags" || key === "meta") continue
        data[key] = value
    }

    return {
        id: (e.id as string) || "",
        data,
    }
}

// ============================================================================
// CONFIGURED BRIDGE
// ============================================================================

/**
 * Loadable bridge configured with available source types
 *
 * Currently supports:
 * - **testcase**: Testset testcases via testcaseMolecule
 *
 * Future sources:
 * - **trace**: Trace spans as loadable data
 * - **dataset**: External datasets
 */
export const loadableBridge = createLoadableBridge({
    sources: {
        testcase: {
            molecule: testcaseMolecule,
            toRow: testcaseToRow,
            displayRowIdsAtom: testcaseMolecule.atoms.displayRowIds,
            hasUnsavedChangesAtom: testcaseMolecule.atoms.hasUnsavedChanges,
        },
        // Future: trace source
        // trace: {
        //     molecule: traceSpanMolecule,
        //     toRow: traceToRow,
        // },
    },
})

// ============================================================================
// BACKWARDS COMPATIBILITY ALIASES
// ============================================================================

/**
 * @deprecated Use loadableBridge instead
 */
export const loadableController = {
    testset: {
        selectors: loadableBridge.selectors,
        actions: loadableBridge.actions,
    },
}

/**
 * @deprecated Use loadableBridge instead
 */
export const testsetLoadable = loadableBridge
