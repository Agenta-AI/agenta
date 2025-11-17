import {
    openOnlineEvaluationDrawerAtom,
    closeOnlineEvaluationDrawerAtom,
} from "@/oss/components/pages/evaluations/onlineEvaluation/state/drawerAtom"
import {getDefaultStore} from "jotai"
import {isOnlineEvaluationRunsAvailableAtom, isUserInRunPageAtom} from "../../atoms/helperAtom"
import {OnboardingStepsContext, TourDefinition} from "../types"

// Functions
const openOnlineEvalDrawer = () => {
    getDefaultStore().set(openOnlineEvaluationDrawerAtom)
}
const closeOnlineEvalDrawer = () => {
    getDefaultStore().set(closeOnlineEvaluationDrawerAtom)
}

// Steps
const CREATE_NEW_ONLINE_EVALUATION_STEPS = [
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
        icon: "🔎",
        title: "Define the query",
        content: <span>Choose filters and sampling to control which traffic is evaluated.</span>,
        selector: "#tour-online-query-section",
        side: "right" as const,
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
    },
]

// Helper functions
export const resolveOnlineEvaluationSteps = () => {
    const hasRuns = getDefaultStore().get(isOnlineEvaluationRunsAvailableAtom)
    if (hasRuns)
        return [{tour: "online-evaluation-quickstart", steps: CREATE_NEW_ONLINE_EVALUATION_STEPS}]

    if (!hasRuns) return [{tour: "configure-new-evaluator", steps: []}]

    const isUserInRunPage = getDefaultStore().get(isUserInRunPageAtom)
    if (isUserInRunPage) return [{tour: "online-evaluation-page-tour", steps: []}]
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
