/**
 * Entity helpers for playground components.
 *
 * Provides entity operations (discard, update) via the runnableBridge
 * unified API. Routes to the correct molecule based on entity type hints.
 */

import {runnableBridge} from "@agenta/entities/runnable"
import {getDefaultStore} from "jotai/vanilla"

/**
 * Discard the entity draft for the given ID.
 */
export function discardEntityDraft(entityId: string) {
    getDefaultStore().set(runnableBridge.discard, entityId)
}

/**
 * Update the entity draft for the given ID.
 */
export function updateEntityDraft(entityId: string, updates: Record<string, unknown>) {
    getDefaultStore().set(runnableBridge.update, entityId, updates)
}
