import {Tour} from "nextstepjs"

import {URLLocationState} from "@/oss/state/url"

import {CurrentOnboardingStepExtended, OnboardingStep, UserOnboardingStatus} from "../types"

export interface OnboardingStepsContext {
    userContext: {
        userRole: string
        userExperience: string
        userInterest: string
    } | null
    currentStep: CurrentOnboardingStepExtended | null
    location: URLLocationState | null
    userOnboardingStatus: UserOnboardingStatus
    tourId?: string
}

export interface CustomTour extends Omit<Tour, "steps"> {
    steps: OnboardingStep[]
    onEnter?: (step?: {selector?: string | null}) => void
    onCleanup?: (step?: {selector?: string | null}) => void
}

export type TourDefinition = CustomTour[]
