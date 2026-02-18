/**
 * Session state atoms.
 *
 * These are primitive atoms that can be populated by the app.
 * The app is responsible for syncing these with its own auth system.
 */

import {atom} from "jotai"

/**
 * Whether the user session is active (authenticated).
 *
 * This is a primitive atom that should be populated by the app.
 * Entity packages read from this to gate queries behind auth readiness.
 *
 * Default: false (queries are blocked until the app confirms a session).
 */
export const sessionAtom = atom(false)

/**
 * Set session state action atom.
 * Use this to update the session state from app code.
 */
export const setSessionAtom = atom(null, (_get, set, exists: boolean) => {
    set(sessionAtom, exists)
})
