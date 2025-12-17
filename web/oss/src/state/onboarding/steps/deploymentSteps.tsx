import {setCompleteWidgetTaskMap} from "@/oss/components/Onboarding/components/OnboardingWidget"

import {clearOnboardingState} from "../assets/utils"

import {OnboardingStepsContext, TourDefinition} from "./types"

// integration
const SETUP_PROMPT_TOUR: TourDefinition = [
    {
        tour: "prompt-setup",
        steps: [
            {
                icon: "🛰️",
                title: "Set up prompt management",
                content: (
                    <span>
                        Get started with prompt management by configuring your app's conversational
                        capabilities.
                    </span>
                ),
                selector: "#tour-setup-prompt",
                side: "left",
                showControls: false,
                showSkip: false,
                pointerPadding: 12,
                pointerRadius: 12,
                advanceOnClick: true,
                onNext: () => {
                    setCompleteWidgetTaskMap("prompt-setup")
                    clearOnboardingState()
                },
            },
        ],
    },
]

export const resolveTours = (ctx: OnboardingStepsContext): TourDefinition => {
    const tourId = ctx.tourId
    if (tourId === "prompt-setup") {
        return SETUP_PROMPT_TOUR
    }

    return []
}

const DEPLOYMENT_TOUR_MAP: Record<string, (ctx: OnboardingStepsContext) => TourDefinition> = {
    Hobbyist: (ctx) => resolveTours(ctx),
}

export const DEPLOYMENT_TOURS = new Proxy(DEPLOYMENT_TOUR_MAP, {
    get(target, prop: string | symbol) {
        if (typeof prop === "string" && prop in target) {
            return target[prop]
        }
        return target.Hobbyist
    },
}) as typeof DEPLOYMENT_TOUR_MAP
