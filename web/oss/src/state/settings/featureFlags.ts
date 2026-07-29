import {atom} from "jotai"
import {atomFamily, atomWithStorage} from "jotai/utils"

import {onboardingStorageUserIdAtom} from "@/oss/lib/onboarding/atoms"

const playgroundInspectorAtomFamily = atomFamily((userId: string) =>
    atomWithStorage<boolean>(`agenta:settings:${userId}:playground-inspector`, false),
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
