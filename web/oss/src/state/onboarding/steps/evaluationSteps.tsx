import {getDefaultStore} from "jotai"

import {OnboardingStepsContext, TourDefinition} from "./types"
import {
    openAutoEvaluationModalAtom,
    closeAutoEvaluationModalAtom,
} from "@/oss/components/pages/evaluations/NewEvaluation/state/autoEvaluationModalAtom"
import {urlStateAtom} from "@/oss/components/EvalRunDetails/state/urlState"
import type {EvalRunUrlState} from "@/oss/components/EvalRunDetails/state/urlState"
import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
import {
    activeEvaluationPanelAtom,
    type EvaluationPanelKey,
} from "@/oss/components/pages/evaluations/NewEvaluation/state/activeEvaluationPanelAtom"
import {
    openOnlineEvaluationDrawerAtom,
    closeOnlineEvaluationDrawerAtom,
} from "@/oss/components/pages/evaluations/onlineEvaluation/state/drawerAtom"
import {lastVisitedEvaluationAtom} from "@/oss/components/pages/evaluations/state/lastVisitedEvaluationAtom"
import {evaluatorConfigsAtom} from "@/oss/lib/atoms/evaluation"

type EvaluationSelector =
    | "#tour-new-eval-tab-application"
    | "#tour-new-eval-tab-variant"
    | "#tour-new-eval-tab-testset"
    | "#tour-new-eval-tab-evaluators"
    | "#tour-new-eval-tab-advanced"
    | "#tour-new-eval-content-application"
    | "#tour-new-eval-content-variant"
    | "#tour-new-eval-content-testset"
    | "#tour-new-eval-content-evaluators"
    | "#tour-new-eval-content-advanced"

const EVAL_TAB_BY_SELECTOR: Record<EvaluationSelector, EvaluationPanelKey> = {
    "#tour-new-eval-tab-application": "appPanel",
    "#tour-new-eval-content-application": "appPanel",
    "#tour-new-eval-tab-variant": "variantPanel",
    "#tour-new-eval-content-variant": "variantPanel",
    "#tour-new-eval-tab-testset": "testsetPanel",
    "#tour-new-eval-content-testset": "testsetPanel",
    "#tour-new-eval-tab-evaluators": "evaluatorPanel",
    "#tour-new-eval-content-evaluators": "evaluatorPanel",
    "#tour-new-eval-tab-advanced": "advancedSettingsPanel",
    "#tour-new-eval-content-advanced": "advancedSettingsPanel",
}

const ensureEvalTab = (selector?: string | null) => {
    if (!selector) return
    const tab = (EVAL_TAB_BY_SELECTOR as any)[selector]
    if (!tab) return
    getDefaultStore().set(activeEvaluationPanelAtom, tab)
}

// Online Evaluation steps utilities (module scope)
const openOnlineEvalDrawer = () => {
    getDefaultStore().set(openOnlineEvaluationDrawerAtom)
}
const closeOnlineEvalDrawer = () => {
    getDefaultStore().set(closeOnlineEvaluationDrawerAtom)
}

const BASE_ONLINE_STEPS = [
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
        // viewportID: "tour-online-start-new-evaluation",
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
        // viewportID: "tour-online-start-new-evaluation",
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
        // viewportID: "tour-online-start-new-evaluation",
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

const resolveOnlineEvaluationTour = (): TourDefinition => {
    const configs = getDefaultStore().get(evaluatorConfigsAtom) || []
    const hasCompatibleEvaluators = Array.isArray(configs) && configs.length > 0
    const steps = hasCompatibleEvaluators
        ? BASE_ONLINE_STEPS
        : [
              BASE_ONLINE_STEPS[0],
              {
                  icon: "🧩",
                  title: "Configure evaluators",
                  content: (
                      <span>
                          If you don’t have a supported evaluator yet, open the evaluator registry
                          to add one (LLM judge, Code, Regex, or Webhook).
                      </span>
                  ),
                  selector: "#tour-online-configure-evaluators",
                  side: "bottom" as const,
                  showControls: true,
                  showSkip: true,
                  pointerPadding: 12,
                  pointerRadius: 12,
                  onCleanup: closeOnlineEvalDrawer,
              },
              ...BASE_ONLINE_STEPS.slice(1),
          ]
    return [{tour: "online-evaluation-quickstart", steps}]
}

const openAutoEvalModal = () => {
    getDefaultStore().set(openAutoEvaluationModalAtom)
}

const closeAutoEvalModal = () => {
    getDefaultStore().set(closeAutoEvaluationModalAtom)
}

const AUTO_EVALUATION_STEPS: TourDefinition[number]["steps"] = [
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
    // {
    //     icon: "⚙️",
    //     title: "Manage evaluators",
    //     content: (
    //         <span>
    //             Need a new heuristic or AI critique? Configure evaluator templates in this workspace
    //             before running them inside an evaluation.
    //         </span>
    //     ),
    //     selector: "#tour-configure-evaluator",
    //     side: "bottom",
    //     showControls: true,
    //     showSkip: true,
    //     pointerPadding: 12,
    //     pointerRadius: 12,
    //     onEnter: closeAutoEvalModal,
    //     onCleanup: closeAutoEvalModal,
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
        selector: "#tour-new-eval-content-application",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: (step?: {selector?: string | null}) => {
            ensureEvalTab(step?.selector ?? null)
            openAutoEvalModal()
        },
        onCleanup: closeAutoEvalModal,
    },
    {
        icon: "🧬",
        title: "Select variant",
        content: (
            <span>
                Add the variants or revisions you want to measure. You can revisit this to compare
                multiple revisions.
            </span>
        ),
        // selector: "#tour-new-eval-tab-variant",
        selector: "#tour-new-eval-content-variant",
        side: "top",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: (step?: {selector?: string | null}) => {
            ensureEvalTab(step?.selector ?? null)
            openAutoEvalModal()
        },
        // onCleanup: closeAutoEvalModal,
    },
    // {
    //     icon: "🔎",
    //     title: "Variant details",
    //     content: (
    //         <span>
    //             Review selected variants here. You can remove or add more revisions before
    //             continuing.
    //         </span>
    //     ),
    //     selector: "#tour-new-eval-content-variant",
    //     side: "right",
    //     showControls: true,
    //     showSkip: true,
    //     pointerPadding: 12,
    //     pointerRadius: 12,
    //     // onEnter: (step?: { selector?: string | null }) => ensureEvalTab(step?.selector ?? null),
    //     onCleanup: closeAutoEvalModal,
    // },
    {
        icon: "📊",
        title: "Attach a testset",
        content: (
            <span>
                Link the dataset that contains your evaluation scenarios and expected answers for
                accurate scoring.
            </span>
        ),
        // selector: "#tour-new-eval-tab-testset",
        selector: "#tour-new-eval-content-testset",
        side: "top",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        // onEnter: (step) => {
        //     ensureEvalTab(step?.selector)
        //     openAutoEvalModal()
        // },
        // onCleanup: closeAutoEvalModal,
    },
    // {
    //     icon: "🔎",
    //     title: "Testset details",
    //     content: (
    //         <span>
    //             Verify the chosen testset and adjust selections. Ensure required columns are
    //             available.
    //         </span>
    //     ),
    //     selector: "#tour-new-eval-content-testset",
    //     side: "right",
    //     showControls: true,
    //     showSkip: true,
    //     pointerPadding: 12,
    //     pointerRadius: 12,
    //     onEnter: (step) => ensureEvalTab(step?.selector),
    //     onCleanup: closeAutoEvalModal,
    // },
    {
        icon: "🔎",
        title: "Choose evaluators",
        content: (
            <span>
                Confirm evaluator choices and settings. You can remove any tag to deselect an
                evaluator.
            </span>
        ),
        selector: "#tour-new-eval-content-evaluators",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: (step) => ensureEvalTab(step?.selector),
        onCleanup: closeAutoEvalModal,
    },
    {
        icon: "🔎",
        title: "Tune advanced settings",
        content: (
            <span>
                Review and fine-tune rate limits and the expected answer column before launching.
            </span>
        ),
        selector: "#tour-new-eval-content-advanced",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: (step) => ensureEvalTab(step?.selector),
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

const resolveDefaultEvaluationTour = (location: OnboardingStepsContext["location"]): TourDefinition => {
    const lastVisited = getDefaultStore().get(lastVisitedEvaluationAtom)
    if (lastVisited === "online_evaluation") {
        return resolveOnlineEvaluationTour()
    }

    if (location?.scope === "project") {
        return AUTO_EVALUATION_TOUR
    }

    return [
        {
            tour: "auto-evaluation-quickstart",
            steps: AUTO_EVALUATION_TOUR[0].steps.filter(
                (step) => step.selector !== "#tour-new-eval-content-application",
            ),
        },
    ]
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
        return resolveDefaultEvaluationTour(location)
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
