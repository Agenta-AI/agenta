/**
 * Host-owned observability state.
 *
 * Everything else lives in `@agenta/observability`. These three stay because
 * they are desktop surface state, not query state: the add-to-testset drawer's
 * payload, and the two onboarding flags (which key off the onboarding user id).
 */
import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {atomFamily} from "jotai-family"

import type {TestsetTraceData} from "@/oss/components/SharedDrawers/AddToTestsetDrawer/assets/types"
import {onboardingStorageUserIdAtom} from "@/oss/lib/onboarding/atoms"

export const testsetDrawerDataAtom = atom<TestsetTraceData[]>([])

const HAS_RECEIVED_TRACES_STORAGE_KEY = "agenta:observability:has-received-traces"
const HAS_RECEIVED_SESSIONS_STORAGE_KEY = "agenta:observability:has-received-sessions"

const createHasReceivedTracesStorageKey = (userId: string) =>
    `${HAS_RECEIVED_TRACES_STORAGE_KEY}:${userId}`
const createHasReceivedSessionsStorageKey = (userId: string) =>
    `${HAS_RECEIVED_SESSIONS_STORAGE_KEY}:${userId}`

const hasReceivedTracesAtomFamily = atomFamily((userId: string) =>
    atomWithStorage<boolean>(createHasReceivedTracesStorageKey(userId), false),
)
const hasReceivedSessionsAtomFamily = atomFamily((userId: string) =>
    atomWithStorage<boolean>(createHasReceivedSessionsStorageKey(userId), false),
)

export const hasReceivedTracesAtom = atom(
    (get) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return false
        return get(hasReceivedTracesAtomFamily(userId))
    },
    (get, set, next: boolean) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return
        set(hasReceivedTracesAtomFamily(userId), next)
    },
)

export const hasReceivedSessionsAtom = atom(
    (get) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return false
        return get(hasReceivedSessionsAtomFamily(userId))
    },
    (get, set, next: boolean) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return
        set(hasReceivedSessionsAtomFamily(userId), next)
    },
)
