/**
 * Runnable Bridge Access
 *
 * Module-level registration for the runnableBridge instance.
 * The entity layer registers the configured bridge at app init time.
 * Playground controllers access it via getRunnableBridge().
 *
 * This replaces the CrudProvider pattern — CRUD actions are now
 * accessed directly from the bridge's `crud` property.
 */

import type {RunnableBridge} from "@agenta/entities/shared"

let _bridge: RunnableBridge | null = null

export function setRunnableBridge(bridge: RunnableBridge): void {
    _bridge = bridge
}

export function getRunnableBridge(): RunnableBridge {
    if (!_bridge) {
        throw new Error(
            "No runnableBridge registered. Call setRunnableBridge() during app initialization.",
        )
    }
    return _bridge
}

export function resetRunnableBridge(): void {
    _bridge = null
}
