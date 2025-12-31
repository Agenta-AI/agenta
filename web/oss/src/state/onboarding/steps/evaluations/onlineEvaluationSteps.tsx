import {getDefaultStore} from "jotai"

import {
    openOnlineEvaluationDrawerAtom,
    closeOnlineEvaluationDrawerAtom,
} from "@/oss/components/pages/evaluations/onlineEvaluation/state/drawerAtom"

import {ensureDemoOnlineEvaluation, redirectToPlayground} from "../../assets/utils"
import {isOnlineEvaluatorAvailableAtom} from "../../atoms/helperAtom"
import {OnboardingStepsContext, TourDefinition} from "../types"

// Functions
const openOnlineEvalDrawer = () => {
    getDefaultStore().set(openOnlineEvaluationDrawerAtom)
}
const closeOnlineEvalDrawer = () => {
    getDefaultStore().set(closeOnlineEvaluationDrawerAtom)
}

// Steps for creating online eval
export const CREATE_NEW_ONLINE_EVALUATION_STEPS = [
    {
        icon: "🧪",
        title: "Start an online evaluation",
        content: <span>Create a live evaluation that continuously scores incoming traffic.</span>,
        selector: "#tour-online-start-new-evaluation",
        side: "bottom" as const,
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onCleanup: closeOnlineEvalDrawer,
        onEnter: closeOnlineEvalDrawer,
        advanceOnClick: true,
    },
    {
        icon: "📝",
        title: "Name the evaluation",
        content: <span>Give your evaluation a clear, descriptive name.</span>,
        selector: "#tour-online-name-input",
        side: "top" as const,
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: openOnlineEvalDrawer,
        onCleanup: closeOnlineEvalDrawer,
    },
    {
        icon: "🤖",
        title: "Select evaluator",
        content: <span>Pick the evaluator to score your results.</span>,
        selector: "#tour-online-evaluator-select",
        side: "right" as const,
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: openOnlineEvalDrawer,
        onCleanup: closeOnlineEvalDrawer,
    },
    {
        icon: "🚀",
        title: "Create online evaluation",
        content: <span>Launch the live evaluation. You can monitor results in the table.</span>,
        selector: "#tour-online-create-button",
        side: "top" as const,
        showControls: true,
        showSkip: true,
        pointerPadding: 6,
        pointerRadius: 12,
        onEnter: openOnlineEvalDrawer,
        onCleanup: closeOnlineEvalDrawer,
        advanceOnClick: true,
    },
]

export const ONE_CLICK_ONLINE_EVALUATION_STEPS: TourDefinition[number]["steps"] = [
    {
        icon: "⚡",
        title: "Create an online evaluation",
        content: (
            <span>
                We will set up a live online evaluation for you automatically—no manual config
                needed.
            </span>
        ),
        showControls: true,
        showSkip: true,
        controlLabels: {
            next: "Create evaluation",
        },
        onNext: ensureDemoOnlineEvaluation,
    },
    {
        icon: "🧭",
        title: "Head to the playground",
        content: (
            <span>
                Jump to the playground to run your prompt and send traffic into the newly created
                evaluation.
            </span>
        ),
        showControls: true,
        showSkip: true,
        controlLabels: {
            next: "Go to playground",
        },
        onNext: redirectToPlayground,
    },
]

// Helper functions
export const resolveOnlineEvaluationSteps = (ctx: OnboardingStepsContext) => {
    const defaultStore = getDefaultStore()
    const hasEvaluators = defaultStore.get(isOnlineEvaluatorAvailableAtom)
    const tourId = ctx.tourId

    if (hasEvaluators) {
        if (tourId === "online-evaluation-quickstart") {
            return [
                {tour: "online-evaluation-quickstart", steps: CREATE_NEW_ONLINE_EVALUATION_STEPS},
            ]
        } else if (tourId === "one-click-online-evaluation") {
            return [{tour: "one-click-online-evaluation", steps: ONE_CLICK_ONLINE_EVALUATION_STEPS}]
        }
        if (!tourId) {
            return [
                {
                    tour: "online-evaluation-quickstart",
                    steps: CREATE_NEW_ONLINE_EVALUATION_STEPS,
                },
            ]
        }
    }

    return []
}

// Onboarding tours map with user role as key
const ONLINE_EVALUATION_TOUR_MAP: Record<string, (ctx: OnboardingStepsContext) => TourDefinition> =
    {
        Hobbyist: (ctx) => resolveOnlineEvaluationSteps(ctx),
        "ML/AI Engineer or Data scientist": (ctx) => resolveOnlineEvaluationSteps(ctx),
        "Frontend / Backend Developer": (ctx) => resolveOnlineEvaluationSteps(ctx),
    }

export const ONLINE_EVALUATION_TOURS = new Proxy(ONLINE_EVALUATION_TOUR_MAP, {
    get(target, prop: string | symbol) {
        if (typeof prop === "string" && prop in target) {
            return target[prop]
        }
        return target.Hobbyist
    },
}) as typeof ONLINE_EVALUATION_TOUR_MAP
