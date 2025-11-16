import {getDefaultStore} from "jotai"

import {urlStateAtom} from "@/oss/components/EvalRunDetails/state/urlState"
import {
    openOnlineEvaluationDrawerAtom,
    closeOnlineEvaluationDrawerAtom,
} from "@/oss/components/pages/evaluations/onlineEvaluation/state/drawerAtom"

import {isOnlineEvaluatorAvailableAtom} from "../../atoms/helperAtom"
import {OnboardingStepsContext, TourDefinition} from "../types"

// Functions
const openOnlineEvalDrawer = () => {
    getDefaultStore().set(openOnlineEvaluationDrawerAtom)
}
const closeOnlineEvalDrawer = () => {
    getDefaultStore().set(closeOnlineEvaluationDrawerAtom)
}

const ensureOnlineEvalView = (view: "overview" | "results" | "configuration") => {
    getDefaultStore().set(urlStateAtom, (draft) => {
        if (draft.view === view) return
        draft.view = view
        // if (view !== "focus") {
        //     draft.scenarioId = undefined
        // }
    })
}

// Steps for creating online eval
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

// Steps for general online eval run page view
const ONLINE_EVAL_RUN_STEPS: TourDefinition[number]["steps"] = [
    {
        icon: "📊",
        title: "Live results table",
        content: (
            <span>
                Keep this table open to watch traces stream in. We wrapped it with a synced viewport
                so the highlights stay aligned while you scroll through the rows.
            </span>
        ),
        selector: "#tour-online-eval-results-table",
        side: "left",
        showControls: true,
        showSkip: true,
        pointerPadding: 16,
        pointerRadius: 12,
        onEnter: () => ensureOnlineEvalView("results"),
    },
    {
        icon: "🔄",
        title: "Refresh on demand",
        content: (
            <span>
                Trigger an immediate refresh to pull the latest run status and scenario counts
                instead of waiting for the auto refresher.
            </span>
        ),
        selector: "#tour-online-eval-refresh-button",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: () => ensureOnlineEvalView("results"),
    },
    {
        icon: "🗂️",
        title: "Switch to overview",
        content: (
            <span>
                Use the Overview tab to leave the live table and inspect aggregate scoring
                dashboards.
            </span>
        ),
        selector: "#tour-online-eval-tab-overview",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: () => ensureOnlineEvalView("results"),
    },
    {
        icon: "🏁",
        title: "Overview & evaluator scores",
        content: (
            <span>
                Switch to the overview tab to review aggregated evaluator scores. This section is
                now inside a viewport-aware container so the tour follows as you scroll.
            </span>
        ),
        selector: "#tour-online-eval-score-section",
        side: "left",
        showControls: true,
        showSkip: true,
        pointerPadding: 16,
        pointerRadius: 12,
        onEnter: () => ensureOnlineEvalView("overview"),
    },
    {
        icon: "📈",
        title: "Evaluator metrics",
        content: (
            <span>
                Dive deeper into evaluator-specific metrics and time series to understand how scores
                change over time.
            </span>
        ),
        selector: "#tour-online-eval-metrics-section",
        side: "left",
        showControls: true,
        showSkip: true,
        pointerPadding: 16,
        pointerRadius: 12,
        onEnter: () => ensureOnlineEvalView("overview"),
    },
    {
        icon: "🧭",
        title: "Open configuration tab",
        content: (
            <span>
                Jump into the Configuration tab whenever you need to double-check filters, sampling,
                or evaluator settings.
            </span>
        ),
        selector: "#tour-online-eval-tab-configuration",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: () => ensureOnlineEvalView("overview"),
    },
    {
        icon: "⚙️",
        title: "Configuration tab",
        content: (
            <span>
                Use the configuration tab to review filters, sampling, and evaluator settings that
                power this online run.
            </span>
        ),
        selector: "#tour-online-eval-configuration-panel",
        side: "left",
        showControls: true,
        showSkip: true,
        pointerPadding: 16,
        pointerRadius: 12,
        onEnter: () => ensureOnlineEvalView("configuration"),
    },
]

// Helper functions
export const resolveOnlineEvaluationSteps = (ctx: OnboardingStepsContext) => {
    const defaultStore = getDefaultStore()
    const hasEvaluators = defaultStore.get(isOnlineEvaluatorAvailableAtom)

    if (ctx.location?.subsection === "results") {
        return [{tour: "online-evaluation-run-tour", steps: ONLINE_EVAL_RUN_STEPS}]
    }

    if (hasEvaluators) {
        return [{tour: "online-evaluation-quickstart", steps: CREATE_NEW_ONLINE_EVALUATION_STEPS}]
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
