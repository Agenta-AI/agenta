/**
 * Runnable Integration Utilities
 *
 * Standalone utilities for loadable-runnable column derivation and
 * drill-in navigation. These are independent of the bridge pattern
 * and work directly with workflowMolecule selectors.
 *
 * @packageDocumentation
 */

import {atom} from "jotai"
import {atomFamily} from "jotai-family"

import {loadableColumnsAtomFamily, loadableStateAtomFamily} from "../loadable/store"
import {workflowMolecule} from "../workflow"

import {formatKeyAsName} from "./portHelpers"
import type {PathItem, RunnableType, TestsetColumn} from "./types"

// ============================================================================
// LOADABLE-RUNNABLE INTEGRATION
// ============================================================================

/**
 * Derived columns atom that reads from the linked runnable's inputPorts.
 *
 * When a loadable is linked to a runnable, this atom derives columns from
 * the workflow's input ports (single source of truth). This enables reactive
 * updates — when user edits {{newVar}} in prompt, columns auto-update.
 */
export const loadableColumnsFromRunnableAtomFamily = atomFamily((loadableId: string) =>
    atom<TestsetColumn[]>((get) => {
        const loadableState = get(loadableStateAtomFamily(loadableId))
        const {linkedRunnableType, linkedRunnableId} = loadableState

        if (!linkedRunnableType || !linkedRunnableId) {
            return get(loadableColumnsAtomFamily(loadableId))
        }

        // Delegate to molecule's inputPorts selector
        if (linkedRunnableType === "workflow") {
            const inputPorts = get(workflowMolecule.selectors.inputPorts(linkedRunnableId))
            if (inputPorts.length > 0) {
                return inputPorts.map((port) => ({
                    key: port.key,
                    name: port.name ?? port.key,
                    type: "string" as const,
                }))
            }
        }

        return get(loadableColumnsAtomFamily(loadableId))
    }),
)

// ============================================================================
// DRILL-IN NAVIGATION
// ============================================================================

interface RunnableDataForRootItems {
    configuration?: Record<string, unknown>
}

/**
 * Get root items for DrillIn navigation based on runnable configuration.
 * Generates PathItems from the runnable's configuration for ConfigurationSection.
 */
export function getRunnableRootItems(
    _type: RunnableType,
    data: RunnableDataForRootItems | null,
): PathItem[] {
    if (!data) return []

    const items: PathItem[] = []
    const configuration = data.configuration

    if (configuration) {
        for (const [key, value] of Object.entries(configuration)) {
            if (key === "version" || key.startsWith("_")) continue
            items.push({
                key,
                name: formatKeyAsName(key),
                value,
            })
        }
    }

    return items
}
