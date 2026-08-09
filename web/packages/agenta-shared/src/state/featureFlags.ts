/**
 * Per-user experimental settings — the "Experiments" switches in Settings › Preferences.
 *
 * They live here, not in an app, because a flag is read where the feature is (a package) and
 * written where the settings page is (every app). Both surfaces on a browser share one atom
 * and one storage key, so turning voice input on in `/m` is honoured by the desktop too.
 */

import {atom} from "jotai"
import {atomFamily, atomWithStorage} from "jotai/utils"

import {stringStorage} from "./stringStorage"

/**
 * The signed-in user's id, as the browser last saw it — the scope for every per-user
 * preference below.
 *
 * Storage-backed rather than derived from the profile query so a preference resolves on the
 * first paint, before any request settles. Apps push into it once they know who is signed in
 * (OSS from onboarding, mobile from its profile query).
 */
export const activeUserIdAtom = atomWithStorage<string | null>(
    "agenta:onboarding:active-user-id",
    null,
    stringStorage,
)

const scopedKey = (userId: string, key: string) => `agenta:settings:${userId}:${key}`

/**
 * A boolean preference scoped to whoever is signed in.
 *
 * Reads `false` and writes nothing while the user is unknown: a preference written under no
 * user would be inherited by the next person to sign in on this browser.
 */
const userScopedFlagAtom = (key: string) => {
    const family = atomFamily((userId: string) => atomWithStorage<boolean>(scopedKey(userId, key), false))

    return atom(
        (get) => {
            const userId = get(activeUserIdAtom)
            if (!userId) return false
            return get(family(userId))
        },
        (get, set, next: boolean) => {
            const userId = get(activeUserIdAtom)
            if (!userId) return
            set(family(userId), next)
        },
    )
}

/** Experimental switch for the chat composer's dictation + voice-message controls. */
export const agentVoiceInputEnabledAtom = userScopedFlagAtom("agent-voice-input")

/** Experimental switch for the Playground's session/turn inspector controls. */
export const playgroundInspectorEnabledAtom = userScopedFlagAtom("playground-inspector")
