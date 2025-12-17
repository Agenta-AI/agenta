import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {Tour} from "nextstepjs"

import {appStatusLoadingAtom} from "@/oss/state/variant/atoms/fetcher"

import {userAtom} from "../../profile"
import {sessionExistsAtom} from "../../session"
import {urlLocationAtom} from "../../url"
import {defaultUserOnboardingState} from "../assets/constants"
import {TOUR_STEPS} from "../steps"
import {
    CurrentOnboardingStep,
    CurrentOnboardingStepExtended,
    OnboardingState,
    UserOnboardingStatus,
} from "../types"

const NEW_USER_STORAGE_KEY = "new-user"
const USER_ONBOARDING_STATE_TRACKER = "user-onboarding-state-tracker"
const USER_ONBOARDING_PROFILE_CONTEXT_STORAGE_KEY = "user-onboarding-profile-context"

export const isNewUserStorageAtom = atomWithStorage(NEW_USER_STORAGE_KEY, false)

export const isNewUserAtom = eagerAtom((get) => {
    const user = get(userAtom)
    const sessionExists = get(sessionExistsAtom)
    const isNewUser = get(isNewUserStorageAtom)

    return !!sessionExists && !!user && isNewUser
})

export const userOnboardingProfileAtom = atomWithStorage<{
    userRole: string
    userExperience: string
    userInterest: string
} | null>(USER_ONBOARDING_PROFILE_CONTEXT_STORAGE_KEY, null)

const mergeUserOnboardingStatus = (state?: Partial<UserOnboardingStatus>): UserOnboardingStatus => {
    return {
        ...defaultUserOnboardingState,
        ...(state || {}),
    }
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
            location: userLocation.resolvedSection ?? userLocation.section,
        }
    },
    (get, set, update: CurrentOnboardingStep | null) => {
        set(currentOnboardingStepAtom, update)
    },
)

export const triggerOnboardingAtom = atom<{
    state: keyof UserOnboardingStatus
    tourId?: string
} | null>(null)

export const onboardingStepsAtom = atom<Tour[]>((get) => {
    const appStatusLoading = get(appStatusLoadingAtom)
    const onboardingProfile = get(userOnboardingProfileAtom)
    const userLocation = get(urlLocationAtom)
    const userOnboardingJourneyStatus = get(userOnboardingStatusAtom)
    const manualTrigger = get(triggerOnboardingAtom)
    const currentStep = get(currentOnboardingStepWithLocationAtom)

    if (appStatusLoading) return []

    if (manualTrigger) {
        const requestedState = manualTrigger.state as keyof typeof TOUR_STEPS
        const requestedTourId = manualTrigger.tourId

        const tourSteps = TOUR_STEPS[requestedState]
        if (!tourSteps) return []

        const tours = tourSteps({
            userContext: onboardingProfile,
            currentStep,
            location: userLocation,
            userOnboardingStatus: userOnboardingJourneyStatus,
            tourId: requestedTourId,
        })
        if (!tours.length) return []
        return tours
    }

    return []
})
