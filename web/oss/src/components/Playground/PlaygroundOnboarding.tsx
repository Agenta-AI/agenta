"use client"

import {useEffect} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import {useOnboardingTour} from "@/oss/components/Onboarding"
import {registerDeployPromptTour} from "@/oss/components/Onboarding/tours/deployPromptTour"
import {
    EXPLORE_PLAYGROUND_TOUR_ID,
    registerExplorePlaygroundTour,
} from "@/oss/components/Onboarding/tours/explorePlaygroundTour"
import {getEnv} from "@/oss/lib/helpers/dynamicEnv"
import {
    onboardingWidgetActivationAtom,
    setOnboardingWidgetActivationAtom,
} from "@/oss/lib/onboarding"

registerExplorePlaygroundTour()
registerDeployPromptTour()

const isWalkthroughsEnabled = () => getEnv("NEXT_PUBLIC_ENABLE_WALKTHROUGHS") === "true"

export const PlaygroundOnboarding = () => {
    const activationHint = useAtomValue(onboardingWidgetActivationAtom)
    const setActivationHint = useSetAtom(setOnboardingWidgetActivationAtom)
    const {startTour} = useOnboardingTour({
        tourId: EXPLORE_PLAYGROUND_TOUR_ID,
        autoStart: false,
    })

    useEffect(() => {
        if (!isWalkthroughsEnabled()) return
        if (activationHint !== "playground-walkthrough") return
        startTour({force: true})
        setActivationHint(null)
    }, [activationHint, setActivationHint, startTour])

    return null
}

export default PlaygroundOnboarding
