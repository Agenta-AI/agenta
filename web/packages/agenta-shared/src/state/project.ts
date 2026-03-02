/**
 * Project state atoms.
 *
 * These are primitive atoms that can be populated by the app.
 * The app is responsible for syncing these with its own state management.
 */

import {atom} from "jotai"

/**
 * Current project ID.
 *
 * This is a primitive atom that should be populated by the app.
 * Entity packages read from this to scope queries.
 *
 * @example
 * ```typescript
 * // In app initialization
 * import { projectIdAtom } from '@agenta/shared/state'
 * import { useHydrateAtoms } from 'jotai/utils'
 *
 * // Hydrate from app state
 * useHydrateAtoms([[projectIdAtom, routerProjectId]])
 * ```
 */
export const projectIdAtom = atom(null as string | null)

/**
 * Set project ID action atom.
 * Use this to update the project ID from app code.
 */
export const setProjectIdAtom = atom(null, (_get, set, projectId: string | null) => {
    set(projectIdAtom, projectId)
})
