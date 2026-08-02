import {atom} from "jotai"
import {atomFamily, atomWithStorage} from "jotai/utils"

import {onboardingStorageUserIdAtom} from "@/oss/lib/onboarding/atoms"

const playgroundInspectorAtomFamily = atomFamily((userId: string) =>
    atomWithStorage<boolean>(`agenta:settings:${userId}:playground-inspector`, false),
)

const agentVoiceInputAtomFamily = atomFamily((userId: string) =>
    atomWithStorage<boolean>(`agenta:settings:${userId}:agent-voice-input`, false),
)

/** Experimental switch for the agent chat composer's dictation + voice-message controls. */
export const agentVoiceInputEnabledAtom = atom(
    (get) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return false
        return get(agentVoiceInputAtomFamily(userId))
    },
    (get, set, next: boolean) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return
        set(agentVoiceInputAtomFamily(userId), next)
    },
)

export const playgroundInspectorEnabledAtom = atom(
    (get) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return false
        return get(playgroundInspectorAtomFamily(userId))
    },
    (get, set, next: boolean) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return
        set(playgroundInspectorAtomFamily(userId), next)
    },
)
