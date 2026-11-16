/** Developer Mode: the per-user switch for `/m`'s developer views. */

import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {atomFamily} from "jotai-family"

import type {User} from "../types/user"

import {activeUserIdAtom} from "./featureFlags"
import {userAtom} from "./user"

/** Accounts created from here on start with Developer Mode off (release v0.106.1, padded). */
const SIMPLIFIED_SIGNUP_CUTOFF = Date.parse("2026-08-01T00:00:00Z")

/** Parses the backend's `2026-08-01 12:34:56.789012+00:00` (Safari rejects the space and 6-digit fraction). */
const parseBackendTimestamp = (raw: string): number =>
    Date.parse(raw.replace(" ", "T").replace(/\.(\d{3})\d+/, ".$1"))

/** The simplified cohort, from the account's creation date; unknown means no. */
const isSimplifiedCohort = (user: User | null): boolean => {
    const createdAt = user?.created_at
    if (!createdAt) return false
    const created = parseBackendTimestamp(createdAt)
    return Number.isNaN(created) ? false : created >= SIMPLIFIED_SIGNUP_CUTOFF
}

const simplifiedCohortAtom = atom((get) => isSimplifiedCohort(get(userAtom)))

/** The `agenta:onboarding:` prefix holds every existing user's choice: do not change it. */
const onboardingScopedKey = (userId: string, key: string) => `agenta:onboarding:${userId}:${key}`

/** No `getOnInit`: reading storage on first render breaks hydration of prerendered pages. */
const navSimplifiedDefaultFamily = atomFamily((userId: string) =>
    atomWithStorage<boolean>(onboardingScopedKey(userId, "nav-simplified"), false),
)

const navSimplifiedOverrideFamily = atomFamily((userId: string) =>
    atomWithStorage<boolean | null>(onboardingScopedKey(userId, "nav-simplified-override"), null),
)

/** Signed up under the simplified experience: the stored signup flag or the account date. */
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
