/**
 * "Classic mode" — the per-user switch that decides which surface a user gets.
 *
 * Off means the simplified, agent-focused experience: the desktop hides its advanced nav areas
 * and the gate sends the user to `/m` (see `utils/mobileGate`). On means the full desktop app.
 *
 * It lives here rather than in an app because both apps now need it: the desktop reads it for
 * its sidebar and its redirect, `/m` reads it for the switch that gets a user back out.
 */

import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {atomFamily} from "jotai-family"

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
 * Does this ACCOUNT belong to the simplified cohort?
 *
 * The stored flag below only exists on the browser the user signed up in, so on a second device
 * it reads false and the same person gets a different product. The account's creation date says
 * the same thing everywhere, and it is already on the wire (`GET /profile` returns `created_at`).
 *
 * Unknown or unparseable is "no", which lands on classic mode — the full app, and the status quo.
 */
const simplifiedCohortAtom = atom((get) => {
    const createdAt = get(userAtom)?.created_at
    if (!createdAt) return false
    // The backend stringifies a Python datetime, so the date and time are SPACE-separated.
    // Safari refuses that; every engine accepts it once the separator is a `T`.
    const created = Date.parse(createdAt.replace(" ", "T"))
    return Number.isNaN(created) ? false : created >= SIMPLIFIED_SIGNUP_CUTOFF
})

/**
 * The `agenta:onboarding:` prefix is load-bearing — these keys predate this module and hold every
 * existing user's choice. Do NOT reuse featureFlags' `agenta:settings:` scope: a changed prefix
 * silently resets everyone to their signup-era default.
 */
const onboardingScopedKey = (userId: string, key: string) => `agenta:onboarding:${userId}:${key}`

/**
 * Deliberately NOT `getOnInit`. It would read storage during the first render, which diverges
 * from the prerendered HTML and breaks hydration wherever this value renders — `/m`'s settings
 * page is statically prerendered, unlike the desktop's `ssr: false` Layout. The gate does not
 * need it: both the cookie sync and the redirect are effects on this value, so they re-run when
 * it settles a tick later. Late, never wrong.
 */
const navSimplifiedDefaultFamily = atomFamily((userId: string) =>
    atomWithStorage<boolean>(onboardingScopedKey(userId, "nav-simplified"), false),
)

const navSimplifiedOverrideFamily = atomFamily((userId: string) =>
    atomWithStorage<boolean | null>(onboardingScopedKey(userId, "nav-simplified-override"), null),
)

/**
 * "This user signed up under the simplified experience" — never written by the settings switch.
 * Existing users resolve to `false` (full nav, classic mode on).
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

/** The simplified surface hides the desktop's advanced nav areas (Prompts, Evaluation, …). */
export const advancedNavHiddenAtom = atom((get) => {
    const override = get(navSimplifiedOverrideAtom)
    return override ?? get(navSimplifiedDefaultAtom)
})

/** The one atom both apps' Preferences pages bind their "Classic mode" switch to. */
export const classicModeEnabledAtom = atom(
    (get) => !get(advancedNavHiddenAtom),
    (_get, set, next: boolean) => {
        set(navSimplifiedOverrideAtom, !next)
    },
)
