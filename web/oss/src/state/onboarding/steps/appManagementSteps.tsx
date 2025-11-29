import {OnboardingStepsContext, TourDefinition} from "./types"

const APP_CREATION_STEPS = [
    {
        tour: "create-first-app",
        steps: [
            {
                icon: "🚀",
                title: "Create a new prompt",
                content: (
                    <span>Click here to create new application using predefined templates</span>
                ),
                selector: "#tour-create-new-prompt",
                waitForSelector: true,
                side: "left",
                showControls: false,
                showSkip: false,
                pointerPadding: 12,
                pointerRadius: 12,
                advanceOnClick: true,
            },
        ],
    },
]

const APP_MANAGEMENT_TOUR_MAP: Record<string, (ctx: OnboardingStepsContext) => TourDefinition> = {
    Hobbyist: () => APP_CREATION_STEPS,
    "ML/AI Engineer or Data scientist": () => APP_CREATION_STEPS,
    "Frontend / Backend Developer": () => APP_CREATION_STEPS,
}

export const APP_MANAGEMENT_TOURS = new Proxy(APP_MANAGEMENT_TOUR_MAP, {
    get(target, prop: string | symbol) {
        if (typeof prop === "string" && prop in target) {
            return target[prop]
        }
        return target.Hobbyist
    },
}) as typeof APP_MANAGEMENT_TOUR_MAP
