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

/**
 * The `agenta:onboarding:` prefix is load-bearing — these keys predate this module and hold every
 * existing user's choice. Do NOT reuse featureFlags' `agenta:settings:` scope: a changed prefix
 * silently resets everyone to their signup-era default.
 */
const onboardingScopedKey = (userId: string, key: string) => `agenta:onboarding:${userId}:${key}`

/**
 * `getOnInit` reads localStorage on the first get rather than on mount. Without it the value
 * starts at the default and corrects a tick later — and this one decides which app the user is
 * sent to, so the gate would act on the wrong answer first.
 */
const STORAGE_OPTS = {getOnInit: true} as const

const navSimplifiedDefaultFamily = atomFamily((userId: string) =>
    atomWithStorage<boolean>(
        onboardingScopedKey(userId, "nav-simplified"),
        false,
        undefined,
        STORAGE_OPTS,
    ),
)

const navSimplifiedOverrideFamily = atomFamily((userId: string) =>
    atomWithStorage<boolean | null>(
        onboardingScopedKey(userId, "nav-simplified-override"),
        null,
        undefined,
        STORAGE_OPTS,
    ),
)

/**
 * "This user signed up under the simplified experience" — written once at signup, never by the
 * settings switch. Existing users default to `false` (full nav, classic mode on).
 */
export const navSimplifiedDefaultAtom = atom(
    (get) => {
        const userId = get(activeUserIdAtom)
        if (!userId) return false
        return get(navSimplifiedDefaultFamily(userId))
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
