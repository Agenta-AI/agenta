import {atom} from "jotai"
import {eagerAtom} from "jotai-eager"
import {atomWithStorage} from "jotai/utils"
import {Tour} from "nextstepjs"
import {appStatusLoadingAtom} from "@/oss/state/variant/atoms/fetcher"

import {userAtom} from "../../profile"
import {sessionExistsAtom} from "../../session"
import {urlLocationAtom} from "../../url"
import {TOUR_STEPS} from "../steps"
import {
    CurrentOnboardingStep,
    CurrentOnboardingStepExtended,
    OnboardingState,
    UserOnboardingStatus,
} from "../types"
import {playgroundHasFirstRunAtom} from "./helperAtom"

const NEW_USER_STORAGE_KEY = "new-user"
const USER_ONBOARDING_STATE_TRACKER = "user-onboarding-state-tracker"
const USER_ONBOARDING_PROFILE_CONTEXT_STORAGE_KEY = "user-onboarding-profile-context"

/**
 * @deprecated this is no longer useful anymore
 */
export const isNewUserStorageAtom = atomWithStorage(NEW_USER_STORAGE_KEY, false)
/**
 * @deprecated this is no longer useful anymore
 */
export const isNewUserAtom = eagerAtom((get) => {
    const user = get(userAtom)
    const sessionExists = get(sessionExistsAtom)
    const isNewUser = get(isNewUserStorageAtom)

    return !!sessionExists && !!user && isNewUser
})

// Rename to userOnboardingProfileAtom
export const userOnboardingProfileContextAtom = atomWithStorage<{
    userRole: string
    userExperience: string
    userInterest: string
} | null>(USER_ONBOARDING_PROFILE_CONTEXT_STORAGE_KEY, null)

// old
const defaultUserOnboardingState: UserOnboardingStatus = {
    apps: "idle",
    playground: "idle",
    playgroundPostRun: "idle",
    evaluations: "idle",
    observability: "idle",
    trace: "idle",
}
// new
const defaultNewUserOnboardingState: UserOnboardingStatus = {
    apps: "idle",
    playground: "idle",
    playgroundPostRun: "idle",
    evaluations: "idle",
    autoEvaluations: "idle",
    humanEvaluations: "idle",
    onlineEvaluations: "idle",
    observability: "idle",
    trace: "idle",
    annotate: "idle",
}

export const ONBOARDING_SECTIONS = Object.keys(defaultUserOnboardingState) as Array<
    keyof UserOnboardingStatus
>

const ONBOARDING_SECTION_ALIASES: Record<string, keyof UserOnboardingStatus> = {
    traces: "trace",
    trace: "trace",
    "trace-drawer": "trace",
    "playground-post-run": "playgroundPostRun",
}

const mergeUserOnboardingStatus = (state?: Partial<UserOnboardingStatus>): UserOnboardingStatus => {
    return {
        ...defaultUserOnboardingState,
        ...(state || {}),
    }
}

export const resolveOnboardingSection = (
    value: string | null,
): keyof UserOnboardingStatus | null => {
    if (!value) return null
    if (ONBOARDING_SECTIONS.includes(value as keyof UserOnboardingStatus)) {
        return value as keyof UserOnboardingStatus
    }
    return ONBOARDING_SECTION_ALIASES[value] ?? null
}

const userOnboardingStatusStorageAtom = atomWithStorage<UserOnboardingStatus>(
    USER_ONBOARDING_STATE_TRACKER,
    defaultUserOnboardingState,
)

export const userOnboardingStatusAtom = atom(
    (get) => mergeUserOnboardingStatus(get(userOnboardingStatusStorageAtom)),
    (
        get,
        set,
        update: UserOnboardingStatus | ((prev: UserOnboardingStatus) => UserOnboardingStatus),
    ) => {
        const previous = mergeUserOnboardingStatus(get(userOnboardingStatusStorageAtom))
        const nextValue =
            typeof update === "function"
                ? (update as (prev: UserOnboardingStatus) => UserOnboardingStatus)(previous)
                : update
        set(userOnboardingStatusStorageAtom, mergeUserOnboardingStatus(nextValue))
    },
)

export const updateUserOnboardingStatusAtom = atom(
    null,
    (get, set, params: {section: keyof UserOnboardingStatus; status: OnboardingState}) => {
        const currentStatus = get(userOnboardingStatusAtom)
        if (currentStatus[params.section] === params.status) return

        set(userOnboardingStatusAtom, {...currentStatus, [params.section]: params.status})
    },
)

export const currentOnboardingStepAtom = atom<CurrentOnboardingStepExtended | null>(null)

export const currentOnboardingStepWithLocationAtom = atom(
    (get) => {
        const step = get(currentOnboardingStepAtom)
        if (!step) return null

        const userLocation = get(urlLocationAtom)
        return {
            ...step,
            location: userLocation.section,
        }
    },
    (get, set, update: CurrentOnboardingStep | null) => {
        set(currentOnboardingStepAtom, update)
    },
)

export const triggerOnboardingAtom = atom<{
    state: keyof UserOnboardingStatus
    type?: "beginner" | "advanced"
} | null>(null)

// rename to onboardingStateAtom
export const newOnboardingStateAtom = atom<Tour[]>((get) => {
    const appStatusLoading = get(appStatusLoadingAtom)
    const onboardingProfile = get(userOnboardingProfileContextAtom)
    const userLocation = get(urlLocationAtom)
    const userOnboardingJourneyStatus = get(userOnboardingStatusAtom)
    const isNewUser = get(isNewUserStorageAtom)
    const manualTrigger = get(triggerOnboardingAtom)
    const currentStep = get(currentOnboardingStepWithLocationAtom)
    const hasPlaygroundRun = get(playgroundHasFirstRunAtom)

    if (appStatusLoading) return []

    if (manualTrigger) {
        const requestedState = manualTrigger.state as keyof typeof TOUR_STEPS
        const effectiveState =
            requestedState === "playground" && hasPlaygroundRun
                ? ("playgroundPostRun" as keyof typeof TOUR_STEPS)
                : requestedState

        const tourSteps = TOUR_STEPS[effectiveState]
        if (!tourSteps) return []

        const steps = tourSteps({
            userContext: onboardingProfile,
            currentStep,
            location: userLocation,
        })

        return steps
    }

    if (isNewUser) {
        const normalizedSection = resolveOnboardingSection(userLocation.section)
        if (!normalizedSection) return []

        if (
            normalizedSection === "playground" &&
            hasPlaygroundRun &&
            userOnboardingJourneyStatus.playgroundPostRun === "idle"
        ) {
            const postRunSteps = TOUR_STEPS.playgroundPostRun
            if (postRunSteps) {
                return postRunSteps({
                    userContext: onboardingProfile,
                    currentStep,
                    location: userLocation,
                })
            }
        }

        if (normalizedSection === "apps") {
            return []
        }

        const sectionStatus = userOnboardingJourneyStatus[normalizedSection]

        if (sectionStatus !== "idle") return []

        const tourSteps = TOUR_STEPS[normalizedSection as keyof typeof TOUR_STEPS]
        if (!tourSteps) return []

        return tourSteps({
            userContext: onboardingProfile,
            currentStep,
            location: userLocation,
        })
    }

    return []
})
