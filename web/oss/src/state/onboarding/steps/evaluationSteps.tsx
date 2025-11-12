import {getDefaultStore} from "jotai"

import {OnboardingStepsContext, TourDefinition} from "./types"
import {
    openAutoEvaluationModalAtom,
    closeAutoEvaluationModalAtom,
} from "@/oss/components/pages/evaluations/NewEvaluation/state/autoEvaluationModalAtom"
import {urlStateAtom} from "@/oss/components/EvalRunDetails/state/urlState"
import type {EvalRunUrlState} from "@/oss/components/EvalRunDetails/state/urlState"
import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"

const openAutoEvalModal = () => {
    getDefaultStore().set(openAutoEvaluationModalAtom)
}

const closeAutoEvalModal = () => {
    getDefaultStore().set(closeAutoEvaluationModalAtom)
}

const AUTO_EVALUATION_STEPS: TourDefinition = [
    {
        icon: "🧪",
        title: "Start an evaluation",
        content: (
            <span>
                Kick off automated scoring from here once you&apos;re ready to compare variants
                against a testset.
            </span>
        ),
        selector: "#tour-start-new-evaluation",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: closeAutoEvalModal,
        onCleanup: closeAutoEvalModal,
    },
    {
        icon: "⚙️",
        title: "Manage evaluators",
        content: (
            <span>
                Need a new heuristic or AI critique? Configure evaluator templates in this workspace
                before running them inside an evaluation.
            </span>
        ),
        selector: "#tour-configure-evaluator",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: closeAutoEvalModal,
        onCleanup: closeAutoEvalModal,
    },
    // {
    //     icon: "🧭",
    //     title: "Guided setup",
    //     content: (
    //         <span>
    //             The modal walks you through every requirement—just keep the sections checked to move
    //             ahead confidently.
    //         </span>
    //     ),
    //     selector: "#tour-new-evaluation-modal",
    //     side: "left",
    //     showControls: true,
    //     showSkip: true,
    //     pointerPadding: 12,
    //     pointerRadius: 12,
    // },
    {
        icon: "📱",
        title: "Pick the app",
        content: (
            <span>
                Choose which application this run belongs to so we fetch its variants and connected
                infrastructure.
            </span>
        ),
        selector: "#tour-new-eval-tab-application",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: openAutoEvalModal,
        onCleanup: closeAutoEvalModal,
    },
    {
        icon: "🧬",
        title: "Select variants",
        content: (
            <span>
                Add the variants or revisions you want to measure. You can revisit this to compare
                multiple revisions.
            </span>
        ),
        selector: "#tour-new-eval-tab-variant",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: openAutoEvalModal,
        onCleanup: closeAutoEvalModal,
    },
    {
        icon: "📊",
        title: "Attach a testset",
        content: (
            <span>
                Link the dataset that contains your evaluation scenarios and expected answers for
                accurate scoring.
            </span>
        ),
        selector: "#tour-new-eval-tab-testset",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: openAutoEvalModal,
        onCleanup: closeAutoEvalModal,
    },
    {
        icon: "🤖",
        title: "Choose evaluators",
        content: (
            <span>
                Stack automatic evaluators, regex checks, or AI critiques to judge each response
                from different angles.
            </span>
        ),
        selector: "#tour-new-eval-tab-evaluators",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: openAutoEvalModal,
        onCleanup: closeAutoEvalModal,
    },
    {
        icon: "🧩",
        title: "Tune advanced settings",
        content: (
            <span>
                Control rate limits and required columns so your evaluation executes safely and uses
                the right answers.
            </span>
        ),
        selector: "#tour-new-eval-tab-advanced",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: openAutoEvalModal,
        onCleanup: closeAutoEvalModal,
    },
    {
        icon: "🚀",
        title: "Launch the run",
        content: (
            <span>
                When everything looks good, start the evaluation. We&apos;ll close the modal and add
                the new run to your table.
            </span>
        ),
        selector: "#tour-new-eval-start",
        side: "top",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: openAutoEvalModal,
        onCleanup: closeAutoEvalModal,
    },
]

const AUTO_EVALUATION_TOUR: TourDefinition = [
    {
        tour: "auto-evaluation-quickstart",
        steps: AUTO_EVALUATION_STEPS,
    },
]

const HUMAN_EVAL_RUN_STEPS = [
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
        onEnter: openAutoEvalModal,
        onCleanup: closeAutoEvalModal,
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
    },
]

const HUMAN_EVAL_RUN_TOUR: TourDefinition = [
    {
        tour: "human-eval-annotation-quickstart",
        steps: HUMAN_EVAL_RUN_STEPS,
    },
]

const HUMAN_EVAL_VIEW_BY_SELECTOR: Record<string, NonNullable<EvalRunUrlState["view"]>> = {
    "#tour-human-eval-focus-tab": "focus",
    "#tour-human-eval-io-panel": "focus",
    "#tour-human-eval-run-button": "focus",
    "#tour-human-eval-annotation-panel": "focus",
    "#tour-human-eval-table-view": "table",
    "#tour-human-eval-results-tab": "results",
}

const ensureHumanEvalView = (selector?: string | null) => {
    if (!selector) return
    const targetView = HUMAN_EVAL_VIEW_BY_SELECTOR[selector]
    if (!targetView) return

    getDefaultStore().set(urlStateAtom, (draft) => {
        if (draft.view === targetView) return
        draft.view = targetView as EvalRunUrlState["view"]
        if (targetView !== "focus") {
            draft.scenarioId = undefined
        }
    })
}

const resolveDefaultEvaluationTour = (): TourDefinition => {
    return AUTO_EVALUATION_TOUR
}

const resolveHumanEvaluationTour = (ctx: OnboardingStepsContext): TourDefinition => {
    ensureHumanEvalView(ctx.currentStep?.selector ?? null)
    return HUMAN_EVAL_RUN_TOUR
}

const resolveEvaluationTour = (ctx: OnboardingStepsContext): TourDefinition => {
    const location = ctx.location
    const evalType = getDefaultStore().get(evalTypeAtom)
    const trailSegments = location?.trail ? location.trail.split("/").filter(Boolean) : []
    const isEvaluationsSection = location?.section === "evaluations"
    const isDetailRoute = isEvaluationsSection && trailSegments.length > 1
    const isListRoute = isEvaluationsSection && trailSegments.length <= 1

    if (isDetailRoute && evalType === "human") {
        return resolveHumanEvaluationTour(ctx)
    }

    if (isListRoute) {
        return resolveDefaultEvaluationTour()
    }

    return []
}

const EVALUATION_TOUR_MAP: Record<string, (ctx: OnboardingStepsContext) => TourDefinition> = {
    Hobbyist: (ctx) => resolveEvaluationTour(ctx),
    "ML/AI Engineer or Data scientist": (ctx) => resolveEvaluationTour(ctx),
    "Frontend / Backend Developer": (ctx) => resolveEvaluationTour(ctx),
}

export const EVALUATION_TOURS = new Proxy(EVALUATION_TOUR_MAP, {
    get(target, prop: string | symbol) {
        if (typeof prop === "string" && prop in target) {
            return target[prop]
        }
        return target.Hobbyist
    },
}) as typeof EVALUATION_TOUR_MAP
