/**
 * User identity type.
 *
 * The shape of an authenticated user across packages.
 * Populated into the primitive `userAtom` in `@agenta/shared/state`
 * by app-level bootstrap (see OSS `UserListener`).
 */
export interface User {
    id: string
    uid: string
    username: string
    email: string
}
