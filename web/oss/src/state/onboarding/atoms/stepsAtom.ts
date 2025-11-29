import {appStatusLoadingAtom} from "@/oss/state/variant/atoms/fetcher"
import {atom, getDefaultStore} from "jotai"
import {eagerAtom} from "jotai-eager"
import {atomWithStorage} from "jotai/utils"
import {Tour} from "nextstepjs"

import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
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
import {isAddAppFromTemplatedAtom} from "@/oss/components/pages/app-management/state/atom"
import {lastVisitedEvaluationAtom} from "@/oss/components/pages/evaluations/state/lastVisitedEvaluationAtom"

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
export const userOnboardingProfileAtom = atomWithStorage<{
    userRole: string
    userExperience: string
    userInterest: string
} | null>(USER_ONBOARDING_PROFILE_CONTEXT_STORAGE_KEY, null)

// old
const defaultUserOnboardingState: UserOnboardingStatus = {
    apps: "idle",
    playground: "idle",
    playgroundPostRun: "idle",
    autoEvaluations: "idle",
    humanEvaluations: "idle",
    onlineEvaluations: "idle",
    observability: "idle",
    trace: "idle",
    fullJourney: "idle",
}

export const ONBOARDING_SECTIONS = Object.keys(defaultUserOnboardingState) as Array<
    keyof UserOnboardingStatus
>
const getEvaluationSectionFromValue = (
    value: string | null | undefined,
): keyof UserOnboardingStatus | null => {
    if (!value) return null
    const normalized = value.toLowerCase()
    if (normalized.includes("online")) return "onlineEvaluations"
    if (normalized.includes("human")) return "humanEvaluations"
    return "autoEvaluations"
}

const resolveEvaluationSectionFromContext = (): keyof UserOnboardingStatus => {
    const store = getDefaultStore()
    const evalType = store.get(evalTypeAtom)
    if (evalType === "online") return "onlineEvaluations"
    if (evalType === "human") return "humanEvaluations"
    const lastVisited = store.get(lastVisitedEvaluationAtom)
    return getEvaluationSectionFromValue(lastVisited) ?? "autoEvaluations"
}

const resolvedKeyMapper: Record<string, keyof UserOnboardingStatus> = {
    traces: "trace",
    trace: "trace",
    "trace-drawer": "trace",
    "playground-post-run": "playgroundPostRun",
    "full-journey": "fullJourney",
    evaluation: "autoEvaluations",
    evaluations: "autoEvaluations",
    "auto-evaluation": "autoEvaluations",
    "auto-evaluations": "autoEvaluations",
    auto_evaluation: "autoEvaluations",
    auto_evaluations: "autoEvaluations",
    "online-evaluation": "onlineEvaluations",
    "online-evaluations": "onlineEvaluations",
    online_evaluation: "onlineEvaluations",
    online_evaluations: "onlineEvaluations",
    "human-evaluation": "humanEvaluations",
    "human-evaluations": "humanEvaluations",
    human_annotation: "humanEvaluations",
    "human-annotation": "humanEvaluations",
    human_ab_testing: "humanEvaluations",
    "human-ab-testing": "humanEvaluations",
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

    const candidates = value
        .split("/")
        .map((part) => part.trim())
        .filter((part): part is string => Boolean(part))
        .flatMap((part) => {
            const lower = part.toLowerCase()
            return [lower, lower.replace(/_/g, "-"), lower.replace(/[-_\s]/g, "")]
        })

    for (const candidate of candidates) {
        if (candidate === "evaluation" || candidate === "evaluations") {
            return resolveEvaluationSectionFromContext()
        }
        const mapped = resolvedKeyMapper[candidate]
        if (mapped) {
            if (mapped === "autoEvaluations" && candidate.includes("evaluation")) {
                return resolveEvaluationSectionFromContext()
            }
            return mapped
        }
    }

    const resolvedFromValue = getEvaluationSectionFromValue(value)
    if (resolvedFromValue) return resolvedFromValue
    return null
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

export const onboardingStepsAtom = atom<Tour[]>((get) => {
    const appStatusLoading = get(appStatusLoadingAtom)
    const onboardingProfile = get(userOnboardingProfileAtom)
    const userLocation = get(urlLocationAtom)
    const userOnboardingJourneyStatus = get(userOnboardingStatusAtom)
    const isNewUser = get(isNewUserStorageAtom)
    const manualTrigger = get(triggerOnboardingAtom)
    const currentStep = get(currentOnboardingStepWithLocationAtom)
    const hasPlaygroundRun = get(playgroundHasFirstRunAtom)
    const isAddAppFromTemplated = get(isAddAppFromTemplatedAtom)

    if (appStatusLoading || isAddAppFromTemplated) return []

    const resolveStepsForState = (stateKey: keyof typeof TOUR_STEPS) => {
        const tourSteps = TOUR_STEPS[stateKey]
        if (!tourSteps) return []
        return tourSteps({
            userContext: onboardingProfile,
            currentStep,
            location: userLocation,
            userOnboardingStatus: userOnboardingJourneyStatus,
        })
    }

    if (manualTrigger) {
        const requestedState = manualTrigger.state as keyof typeof TOUR_STEPS
        const effectiveState =
            requestedState === "playground" && hasPlaygroundRun
                ? ("playgroundPostRun" as keyof typeof TOUR_STEPS)
                : requestedState
        return resolveStepsForState(effectiveState)
    }

    return []
})
