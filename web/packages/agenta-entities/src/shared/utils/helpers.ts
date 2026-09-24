/**
 * Molecule Utilities
 *
 * Helper functions for cache management, molecule composition, and strict typing.
 */

import {generateId} from "@agenta/shared/utils"
import {getDefaultStore} from "jotai/vanilla"

import type {Molecule, StoreOptions} from "../molecule/types"

// ============================================================================
// ID UTILITIES
// ============================================================================

/**
 * Generate a local ID with optional prefix. Crypto-backed: these ids reach surfaces CodeQL
 * treats as security contexts (js/insecure-randomness), and `Math.random` is not fit for that.
 */
export function generateLocalId(prefix = "local"): string {
    return `${prefix}-${Date.now()}-${generateId().replace(/-/g, "").slice(0, 7)}`
}

// ============================================================================
// BATCH UTILITIES
// ============================================================================

/**
 * Batch update multiple entities in a molecule.
 *
 * @example
 * ```typescript
 * batchUpdate(testcaseMolecule, [
 *   { id: 'tc-1', changes: { data: { country: 'USA' } } },
 *   { id: 'tc-2', changes: { data: { country: 'UK' } } },
 * ])
 * ```
 */
export function batchUpdate<T, TDraft>(
    molecule: Molecule<T, TDraft>,
    updates: {id: string; changes: TDraft}[],
    options?: StoreOptions,
): void {
    const store = options?.store ?? getDefaultStore()
    for (const {id, changes} of updates) {
        store.set(molecule.reducers.update, id, changes)
    }
}
