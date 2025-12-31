import {Tour} from "@agentaai/nextstepjs"

export type OnboardingState = "idle" | "started" | "done" | "error" | "skipped"

export interface UserOnboardingStatus<T = OnboardingState> {
    apps: T
    playground: T
    playgroundPostRun: T
    autoEvaluation: T
    humanEvaluations: T
    onlineEvaluation: T
    observability: T
    trace: T
    deployment: T
}

export interface OnboardingControlLabels {
    next?: string
    previous?: string
    finish?: string
}

export type OnboardingStep = Tour["steps"][number] & {
    onEnter?: () => void
    onExit?: () => void
    onCleanup?: () => void
    onNext?: () => void | Promise<void>
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
