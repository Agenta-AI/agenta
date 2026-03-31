"use client"

import {useEffect} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import {useOnboardingTour} from "@/oss/components/Onboarding"
import {registerDeployPromptTour} from "@/oss/components/Onboarding/tours/deployPromptTour"
import {
    EXPLORE_PLAYGROUND_TOUR_ID,
    registerExplorePlaygroundTour,
} from "@/oss/components/Onboarding/tours/explorePlaygroundTour"
import {
    FIRST_EVALUATION_TOUR_ID,
    registerFirstEvaluationTour,
} from "@/oss/components/Onboarding/tours/firstEvaluationTour"
import {
    onboardingWidgetActivationAtom,
    setOnboardingWidgetActivationAtom,
} from "@/oss/lib/onboarding"

registerExplorePlaygroundTour()
registerDeployPromptTour()
registerFirstEvaluationTour()

export const PlaygroundOnboarding = () => {
    const activationHint = useAtomValue(onboardingWidgetActivationAtom)
    const setActivationHint = useSetAtom(setOnboardingWidgetActivationAtom)
    const {startTour} = useOnboardingTour({
        tourId: EXPLORE_PLAYGROUND_TOUR_ID,
        autoStart: false,
    })
    const {startTour: startFirstEvaluationTour} = useOnboardingTour({
        tourId: FIRST_EVALUATION_TOUR_ID,
        autoStart: false,
    })

    useEffect(() => {
        if (activationHint !== "playground-walkthrough") return
        startTour({force: true})
        setActivationHint(null)
    }, [activationHint, setActivationHint, startTour])

    useEffect(() => {
        if (activationHint !== "run-first-evaluation") return
        startFirstEvaluationTour({force: true})
        setActivationHint(null)
    }, [activationHint, setActivationHint, startFirstEvaluationTour])

    return null
}

export default PlaygroundOnboarding
