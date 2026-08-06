/**
 * User identity state atoms.
 *
 * These are primitive atoms that should be populated by the app.
 * Entity packages read from `userAtom` to scope queries that depend
 * on the authenticated user's identity (e.g., the secret entity's
 * `["vault", "secrets", user?.id, projectId]` query key).
 *
 * The app is responsible for wiring its own profile/auth state
 * into this atom via `setUserAtom`. See OSS `UserListener` for the
 * canonical wiring pattern (paired with `SessionListener`).
 *
 * @example
 * ```typescript
 * // In app code
 * import {setUserAtom} from "@agenta/shared/state"
 * import {useSetAtom} from "jotai"
 *
 * const setSharedUser = useSetAtom(setUserAtom)
 * useEffect(() => { setSharedUser(profileQuery.data ?? null) }, [profileQuery.data])
 * ```
 */

import {atom} from "jotai"

import type {User} from "../types/user"

/**
 * Current authenticated user (or `null` if not authenticated).
 *
 * Default: `null`. Populated by app bootstrap.
 * Entity packages read from this to gate queries behind authentication
 * and to scope query keys by user identity.
 */
export const userAtom = atom<User | null>(null)

/**
 * Set the authenticated user.
 * Use from app code to push profile state into the shared atom.
 */
export const setUserAtom = atom(null, (_get, set, user: User | null) => {
    set(userAtom, user)
})
