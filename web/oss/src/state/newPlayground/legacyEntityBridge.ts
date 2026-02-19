/**
 * Entity Bridge — Side Effects Only
 *
 * Registers playground-specific orchestration with the entity layer:
 * 1. RunnableBridge registration with playground package
 * 2. Selection change callback (URL sync, drawer state)
 *
 * This module has no exports — import it for side effects only:
 * ```typescript
 * import "@/oss/state/newPlayground/legacyEntityBridge"
 * ```
 */

import {runnableBridge} from "@agenta/entities/runnable"
import {setOnSelectionChangeCallback, setRunnableBridge} from "@agenta/playground"
import {getDefaultStore} from "jotai"

import {drawerVariantIdAtom} from "@/oss/components/VariantsComponents/Drawers/VariantDrawer/store/variantDrawerStore"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"

// ============================================================================
// RUNNABLE BRIDGE REGISTRATION
// Wire the configured runnableBridge into the playground package
// ============================================================================

console.log("[entityBridge] registering runnableBridge with playground")
setRunnableBridge(runnableBridge)

// ============================================================================
// SELECTION CHANGE CALLBACK
// OSS-specific side-effects when playground selection changes
// ============================================================================

setOnSelectionChangeCallback((entityIds, _removed) => {
    // Sync selection to URL
    void writePlaygroundSelectionToQuery(entityIds)

    // Keep drawer selection consistent
    const store = getDefaultStore()
    const currentDrawerId = store.get(drawerVariantIdAtom)
    if (!currentDrawerId || !entityIds.includes(currentDrawerId)) {
        store.set(drawerVariantIdAtom, entityIds[0] ?? null)
    }
})
