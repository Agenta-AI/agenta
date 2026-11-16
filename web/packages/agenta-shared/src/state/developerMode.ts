/**
 * Developer Mode: the per-user switch that turns on `/m`'s developer views (evaluations,
 * annotations, test sets, prompts). Off is the simplified, agent-focused experience.
 */

import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {atomFamily} from "jotai-family"

import type {User} from "../types/user"

import {activeUserIdAtom} from "./featureFlags"
import {userAtom} from "./user"

/**
 * Accounts created from here on signed up under the simplified experience.
 *
 * Padded past the release that started seeding it (v0.106.1, on main 2026-07-30) rather than
 * the merge date of the change itself (#5478, 2026-07-28): the seed is written client-side, so
 * what matters is when the frontend carrying it actually reached users. Padding forward only
 * ever leaves someone on the status quo — the stored flag below still covers anyone this misses.
 */
const SIMPLIFIED_SIGNUP_CUTOFF = Date.parse("2026-08-01T00:00:00Z")

/**
 * `Date.parse` on what `str(datetime)` produces: `2026-08-01 12:34:56.789012+00:00`.
 *
 * Two things in that string are not the format `Date.parse` is required to accept. The date and
 * time are SPACE-separated, which Safari refuses outright. And the fraction carries six digits
 * where the spec defines exactly three, so anything past the third is implementation-defined and
 * an engine may answer NaN. Every major engine happens to cope today, but the failure would be
 * silent here: NaN reads as "not in the cohort", which quietly leaves Developer Mode on.
 */
const parseBackendTimestamp = (raw: string): number =>
    Date.parse(raw.replace(" ", "T").replace(/\.(\d{3})\d+/, ".$1"))

/**
 * Does this ACCOUNT belong to the simplified cohort?
 *
 * The stored flag below only exists on the browser the user signed up in, so on a second device
 * it reads false and the same person gets a different product. The account's creation date says
 * the same thing everywhere, and it is already on the wire (`GET /profile` returns `created_at`).
 *
 * Unknown or unparseable is "no", which leaves Developer Mode on: the status quo.
 */
const isSimplifiedCohort = (user: User | null): boolean => {
    const createdAt = user?.created_at
    if (!createdAt) return false
    const created = parseBackendTimestamp(createdAt)
    return Number.isNaN(created) ? false : created >= SIMPLIFIED_SIGNUP_CUTOFF
}

const simplifiedCohortAtom = atom((get) => isSimplifiedCohort(get(userAtom)))

/**
 * The `agenta:onboarding:` prefix is load-bearing — these keys predate this module and hold every
 * existing user's choice. Do NOT reuse featureFlags' `agenta:settings:` scope: a changed prefix
 * silently resets everyone to their signup-era default.
 */
const onboardingScopedKey = (userId: string, key: string) => `agenta:onboarding:${userId}:${key}`

/**
 * Deliberately NOT `getOnInit`. It would read storage during the first render, which diverges
 * from the prerendered HTML and breaks hydration wherever this value renders: `/m`'s settings
 * page is statically prerendered.
 */
const navSimplifiedDefaultFamily = atomFamily((userId: string) =>
    atomWithStorage<boolean>(onboardingScopedKey(userId, "nav-simplified"), false),
)

const navSimplifiedOverrideFamily = atomFamily((userId: string) =>
    atomWithStorage<boolean | null>(onboardingScopedKey(userId, "nav-simplified-override"), null),
)

/**
 * "This user signed up under the simplified experience" — never written by the settings switch.
 * Existing users resolve to `false` (Developer Mode on).
 *
 * Two sources, either of which is enough. The stored flag is written once at signup and lives
 * only on that browser; the account's creation date says the same thing on every device. Reading
 * both means the signup browser keeps answering exactly as it always has, while a second device
 * stops disagreeing with it.
 */
export const navSimplifiedDefaultAtom = atom(
    (get) => {
        const userId = get(activeUserIdAtom)
        if (!userId) return false
        return get(navSimplifiedDefaultFamily(userId)) || get(simplifiedCohortAtom)
    },
    (get, set, next: boolean) => {
        const userId = get(activeUserIdAtom)
        if (!userId) return
        set(navSimplifiedDefaultFamily(userId), next)
    },
)

/** A user's explicit choice. Null preserves their signup-era default. */
export const navSimplifiedOverrideAtom = atom(
    (get) => {
        const userId = get(activeUserIdAtom)
        if (!userId) return null
        return get(navSimplifiedOverrideFamily(userId))
    },
    (get, set, next: boolean | null) => {
        const userId = get(activeUserIdAtom)
        if (!userId) return
        set(navSimplifiedOverrideFamily(userId), next)
    },
)

/** The simplified surface hides the developer views (Prompts, Evaluation, …). */
export const advancedNavHiddenAtom = atom((get) => {
    const override = get(navSimplifiedOverrideAtom)
    return override ?? get(navSimplifiedDefaultAtom)
})

/** The atom the Preferences page binds its "Developer Mode" switch to. */
export const developerModeEnabledAtom = atom(
    (get) => !get(advancedNavHiddenAtom),
    (_get, set, next: boolean) => {
        set(navSimplifiedOverrideAtom, !next)
    },
)

/** Developer Mode on for a known user: `/m` shows its developer views. */
export const developerModeActiveAtom = atom(
    (get) => Boolean(get(activeUserIdAtom)) && get(developerModeEnabledAtom),
)
