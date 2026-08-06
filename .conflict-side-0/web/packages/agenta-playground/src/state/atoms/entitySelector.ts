/**
 * Entity Selector Atoms
 *
 * State for managing the entity selector modal.
 */

import {atom, type PrimitiveAtom} from "jotai"

import type {EntitySelectorConfig, EntitySelection} from "../types"

// ============================================================================
// ENTITY SELECTOR STATE ATOMS
// ============================================================================

/**
 * Entity selector modal open state
 */
export const entitySelectorOpenAtom = atom<boolean>(false) as PrimitiveAtom<boolean>

/**
 * Entity selector modal configuration
 */
export const entitySelectorConfigAtom = atom<EntitySelectorConfig>(
    {},
) as PrimitiveAtom<EntitySelectorConfig>

/**
 * Promise resolver for entity selector modal
 * This allows the modal to return a selection via async/await
 */
export const entitySelectorResolverAtom = atom<
    ((selection: EntitySelection | null) => void) | null
>(null) as PrimitiveAtom<((selection: EntitySelection | null) => void) | null>
