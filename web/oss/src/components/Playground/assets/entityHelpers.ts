/**
 * Entity helpers for playground components.
 *
 * Provides entity operations (discard, update) via the workflowMolecule API.
 */

import {workflowMolecule} from "@agenta/entities/workflow"

/**
 * Discard the entity draft for the given ID.
 */
export function discardEntityDraft(entityId: string) {
    workflowMolecule.set.discard(entityId)
}

/**
 * Update the entity draft for the given ID.
 */
export function updateEntityDraft(entityId: string, updates: Record<string, unknown>) {
    workflowMolecule.set.updateConfiguration(entityId, updates)
}
