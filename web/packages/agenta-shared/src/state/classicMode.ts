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

import type {User} from "../types/user"

import {ACTIVE_USER_ID_KEY, activeUserIdAtom} from "./featureFlags"
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
 * silent here: NaN reads as "not in the cohort", which quietly parks the user on classic mode.
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
 * Unknown or unparseable is "no", which lands on classic mode — the full app, and the status quo.
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

/** `atomWithStorage` persists via JSON, so a stored boolean reads back as `"true"` / `"false"`. */
const readStoredBoolean = (key: string): boolean | null => {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    try {
        const parsed = JSON.parse(raw)
        return typeof parsed === "boolean" ? parsed : null
    } catch {
        return null
    }
}

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

/**
 * The SETTLED preference, or `null` while it is still unknown. For effects that act on it.
 *
 * {@link advancedNavHiddenAtom} cannot answer this. Its override atom hydrates a tick after it
 * mounts, and until then reports `null` — the same value a user with no explicit choice has. So
 * during that tick an explicit "Classic mode on" is misread as "no choice", falls through to the
 * signup-era default, and reads `true` for anyone in the simplified cohort. Both callers act
 * irreversibly on that: one navigates to `/m`, the other writes the cookie the middleware reads
 * on the next load. Neither survives to see the corrected value.
 *
 * Reading storage directly is exact instead. Effects run client-side and after hydration, so the
 * `getOnInit` concern that shapes the atoms above does not apply here.
 */
export const readSettledAdvancedNavHidden = (user: User | null): boolean | null => {
    if (typeof window === "undefined") return null
    const userId = localStorage.getItem(ACTIVE_USER_ID_KEY)
    if (!userId) return null

    const override = readStoredBoolean(onboardingScopedKey(userId, "nav-simplified-override"))
    if (override !== null) return override

    if (readStoredBoolean(onboardingScopedKey(userId, "nav-simplified")) === true) return true

    // Only the signup cohort is left to check, and that answer lives on the profile.
    return user ? isSimplifiedCohort(user) : null
}

/**
 * What the gate cookie should say, or `undefined` to leave it alone. `null` means "publish
 * nothing" — clear it.
 *
 * Distinct from {@link readSettledAdvancedNavHidden}, and deliberately so. That one answers
 * "which surface does this user get", where the signup-era default is as good an answer as a
 * choice. The gates ask something narrower: both treat `"1"` as the user asking for the desktop
 * app in as many words, and rank it ABOVE the device heuristic. Only an explicit choice earns
 * that. An account that predates the switch has classic mode on because nobody ever turned it
 * off, and publishing `"1"` for them tells the gate a phone should get the desktop app — which
 * is how every pre-existing account lost `/m`.
 *
 * So classic-mode-ON publishes only from the override. The default answers UNKNOWN, and the
 * device gate decides, exactly as it did before this preference existed.
 *
 * Simplified (`"0"`) has no such problem and publishes from any source: it is the cohort the
 * default was built to route, and `/m` is where they belong however we learned it.
 */
export const readSettledClassicModeCookie = (user: User | null): "0" | "1" | null | undefined => {
    if (typeof window === "undefined") return undefined

    // Storage, not `activeUserIdAtom`: that atom has no `getOnInit` and reads null on the first
    // render of every page load. Treating that as a sign-out clears the cookie mid-session.
    const userId = localStorage.getItem(ACTIVE_USER_ID_KEY)
    if (!userId) return null

    const override = readStoredBoolean(onboardingScopedKey(userId, "nav-simplified-override"))
    if (override !== null) return override ? "0" : "1"

    if (readStoredBoolean(onboardingScopedKey(userId, "nav-simplified")) === true) return "0"

    // The cohort answer lives on the profile. Until it lands we know nothing new, and a stale
    // cookie beats no cookie: clearing here would drop a correct answer on every reload.
    if (!user) return undefined

    return isSimplifiedCohort(user) ? "0" : null
}

/** The one atom both apps' Preferences pages bind their "Classic mode" switch to. */
export const classicModeEnabledAtom = atom(
    (get) => !get(advancedNavHiddenAtom),
    (_get, set, next: boolean) => {
        set(navSimplifiedOverrideAtom, !next)
    },
)
