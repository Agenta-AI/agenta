import {Tour} from "nextstepjs"

export type OnboardingState = "idle" | "started" | "done" | "error" | "skipped"

export type UserOnboardingStatus<T = OnboardingState> = {
    apps: T
    playground: T
    playgroundPostRun: T
    autoEvaluations: T
    humanEvaluations: T
    onlineEvaluations: T
    observability: T
    trace: T
}

export type OnboardingControlLabels = {
    next?: string
    previous?: string
    finish?: string
}

export type OnboardingStep = Tour["steps"][number] & {
    onEnter?: () => void
    onExit?: () => void
    onCleanup?: () => void
    onboardingSection?: keyof UserOnboardingStatus
    advanceOnClick?: boolean
    controlLabels?: OnboardingControlLabels
}

export type CurrentOnboardingStep = OnboardingStep

export interface CurrentOnboardingStepExtended extends CurrentOnboardingStep {
    location?: string
    currentStep?: number
    totalSteps?: number
}

export type OnboardingLandingFeatureKey =
    | "apps"
    | "playground"
    | "auto-evaluation"
    | "online-evaluation"
    | "human-evaluation"
    | "observability"
    | "projects"
