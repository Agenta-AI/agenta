import {OnboardingStepsContext, TourDefinition} from "./types"

const GENERAL_TOURS: Record<string, TourDefinition> = {
    "reopen-onboarding-guide": [
        {
            tour: "reopen-onboarding-guide",
            steps: [
                {
                    icon: "❓",
                    title: "Come back anytime",
                    content: (
                        <span>You can always use the Help &amp; Docs menu to reopen the guide</span>
                    ),
                    selector: ".tour-help-docs-link",
                    side: "top",
                    showControls: false,
                    showSkip: false,
                    pointerPadding: 8,
                    pointerRadius: 8,
                    advanceOnClick: true,
                },
            ],
        },
    ],
}

export const resolveGeneralTours = (ctx: OnboardingStepsContext): TourDefinition => {
    if (!ctx.tourId) return []
    return GENERAL_TOURS[ctx.tourId] ?? []
}
