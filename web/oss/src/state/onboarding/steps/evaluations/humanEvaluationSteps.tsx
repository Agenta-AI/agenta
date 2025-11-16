import {EvalRunUrlState, urlStateAtom} from "@/oss/components/EvalRunDetails/state/urlState"
import {getDefaultStore} from "jotai"
import {OnboardingStepsContext, TourDefinition} from "../types"
import {isHumanEvaluatorAvailableAtom} from "../../atoms/helperAtom"

// Functions
const onChangeTab = (tab: string) => {
    getDefaultStore().set(urlStateAtom, (draft) => {
        if (draft.view === tab) return
        draft.view = tab as EvalRunUrlState["view"]
        if (tab !== "focus") {
            draft.scenarioId = undefined
        }
    })
}

// Steps
const HUMAN_EVAL_RUN_STEPS: TourDefinition[number]["steps"] = [
    {
        icon: "🎯",
        title: "Focus mode",
        content: (
            <span>
                Stay in this tab to review one scenario at a time with the navigator pinned to the
                left for fast switching.
            </span>
        ),
        selector: "#tour-human-eval-focus-tab",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 20,
        pointerRadius: 12,
    },
    {
        icon: "🧾",
        title: "Inputs & responses",
        content: (
            <span>
                The scenario card shows the captured inputs, ground truth, and the latest model
                response so you can inspect what was evaluated.
            </span>
        ),
        selector: "#tour-human-eval-io-panel",
        side: "left",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
    },
    {
        icon: "⚡️",
        title: "Re-run this scenario",
        content: (
            <span>
                Trigger a fresh invocation whenever you tweak prompts or want a new trace before you
                record feedback.
            </span>
        ),
        selector: "#tour-human-eval-run-button",
        side: "left",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
    },
    {
        icon: "✍️",
        title: "Annotate findings",
        content: (
            <span>
                Record rubric scores, qualitative notes, and evaluator overrides here—each entry is
                versioned per scenario and reviewer.
            </span>
        ),
        selector: "#tour-human-eval-annotation-panel",
        side: "left",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
    },
    {
        icon: "📋",
        title: "Table view",
        content: (
            <span>
                Jump to the table to scan every scenario, filter by status, and open the ones that
                still need annotations.
            </span>
        ),
        selector: "#tour-human-eval-table-view",
        side: "top",
        showControls: true,
        showSkip: true,
        pointerPadding: 20,
        pointerRadius: 12,
        onEnter: () => onChangeTab("table"),
    },
    {
        icon: "📊",
        title: "Results tab",
        content: (
            <span>
                Use the results tab to review aggregate evaluator scores and compare performance
                across metrics for the entire run.
            </span>
        ),
        selector: "#tour-human-eval-results-tab",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: () => onChangeTab("results"),
    },
]

// Helper functions
export const resolveOnlineEvaluationSteps = (ctx: OnboardingStepsContext) => {
    const hasEvaluators = getDefaultStore().get(isHumanEvaluatorAvailableAtom)
    if (hasEvaluators) return [{tour: "online-evaluation-quickstart", steps: []}]

    if (!hasEvaluators) return [{tour: "configure-new-evaluator", steps: []}]

    if (ctx.location?.subsection === "results") {
        return [{tour: "online-evaluation-page-tour", steps: HUMAN_EVAL_RUN_STEPS}]
    }

    return []
}

const HUMAN_EVALUATION_TOUR_MAP: Record<string, (ctx: OnboardingStepsContext) => TourDefinition> = {
    Hobbyist: (ctx) => resolveOnlineEvaluationSteps(ctx),
    "ML/AI Engineer or Data scientist": (ctx) => resolveOnlineEvaluationSteps(ctx),
    "Frontend / Backend Developer": (ctx) => resolveOnlineEvaluationSteps(ctx),
}

export const HUMAN_EVALUATION_TOURS = new Proxy(HUMAN_EVALUATION_TOUR_MAP, {
    get(target, prop: string | symbol) {
        if (typeof prop === "string" && prop in target) {
            return target[prop]
        }
        return target.Hobbyist
    },
}) as typeof HUMAN_EVALUATION_TOUR_MAP
