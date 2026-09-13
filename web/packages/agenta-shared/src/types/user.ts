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
    /**
     * When the ACCOUNT was created, as the backend stringifies a timezone-aware datetime
     * ("2026-08-01 12:34:56.789012+00:00" — note the space, not a `T`).
     *
     * Optional because the field is only as reliable as the response: `state/classicMode` reads
     * it to decide whether this account predates the simplified experience, and treats anything
     * missing or unparseable as "no".
     */
    created_at?: string
}
