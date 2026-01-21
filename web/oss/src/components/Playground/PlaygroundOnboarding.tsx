"use client"

import {useOnboardingTour} from "@/oss/components/Onboarding"
import {
    EXPLORE_PLAYGROUND_TOUR_ID,
    registerExplorePlaygroundTour,
} from "@/oss/components/Onboarding/tours/explorePlaygroundTour"
import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

registerExplorePlaygroundTour()

const isWalkthroughsEnabled = () => getEnv("NEXT_PUBLIC_ENABLE_WALKTHROUGHS") === "true"

export const PlaygroundOnboarding = () => {
    useOnboardingTour({
        tourId: EXPLORE_PLAYGROUND_TOUR_ID,
        autoStart: true,
        autoStartCondition: isWalkthroughsEnabled(),
    })

    return null
}

export default PlaygroundOnboarding
