import {Tour} from "nextstepjs"

import {CurrentOnboardingStepExtended} from "../types"
import {URLLocationState} from "@/oss/state/url"

export type OnboardingStepsContext = {
    userContext: {
        userRole: string
        userExperience: string
        userInterest: string
    } | null
    currentStep: CurrentOnboardingStepExtended | null
    location: URLLocationState | null
}

export interface CustomTour extends Tour {
    onEnter?: (step?: {selector?: string | null}) => void
    onCleanup?: (step?: {selector?: string | null}) => void
}

export type TourDefinition = CustomTour[]
