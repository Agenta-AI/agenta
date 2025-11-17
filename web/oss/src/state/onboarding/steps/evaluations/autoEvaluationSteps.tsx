import {getDefaultStore} from "jotai"

import {OnboardingStepsContext, TourDefinition} from "../types"
import {
    openAutoEvaluationModalAtom,
    closeAutoEvaluationModalAtom,
} from "@/oss/components/pages/evaluations/NewEvaluation/state/autoEvaluationModalAtom"
import {activeEvaluationPanelAtom} from "@/oss/components/pages/evaluations/NewEvaluation/state/activeEvaluationPanelAtom"

// Constants
const EVAL_TAB_BY_SELECTOR: Record<string, string> = {
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

// Function
const ensureEvalTab = (selector?: string | null) => {
    if (!selector) return
    const tab = (EVAL_TAB_BY_SELECTOR as any)[selector]
    if (!tab) return
    getDefaultStore().set(activeEvaluationPanelAtom, tab)
}

const openAutoEvalModal = () => {
    getDefaultStore().set(openAutoEvaluationModalAtom)
}

const closeAutoEvalModal = () => {
    getDefaultStore().set(closeAutoEvaluationModalAtom)
}

// Steps
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

    {
        icon: "📊",
        title: "Attach a testset",
        content: (
            <span>
                Link the dataset that contains your evaluation scenarios and expected answers for
                accurate scoring.
            </span>
        ),
        selector: "#tour-new-eval-content-testset",
        side: "top",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: (step) => {
            ensureEvalTab(step?.selector)
            openAutoEvalModal()
        },
        onCleanup: closeAutoEvalModal,
    },
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

// Helper
const resolveDefaultEvaluationTour = (ctx: OnboardingStepsContext): TourDefinition => {
    const location = ctx.location

    if (location?.scope === "project") {
        return [
            {
                tour: "auto-evaluation-quickstart",
                steps: AUTO_EVALUATION_STEPS,
            },
        ]
    }

    return [
        {
            tour: "auto-evaluation-quickstart",
            steps: AUTO_EVALUATION_STEPS.filter(
                (step) => step.selector !== "#tour-new-eval-content-application",
            ),
        },
    ]
}

const AUTO_EVALUATION_TOUR_MAP: Record<string, (ctx: OnboardingStepsContext) => TourDefinition> = {
    Hobbyist: (ctx) => resolveDefaultEvaluationTour(ctx),
    "ML/AI Engineer or Data scientist": (ctx) => resolveDefaultEvaluationTour(ctx),
    "Frontend / Backend Developer": (ctx) => resolveDefaultEvaluationTour(ctx),
}

export const AUTO_EVALUATION_TOURS = new Proxy(AUTO_EVALUATION_TOUR_MAP, {
    get(target, prop: string | symbol) {
        if (typeof prop === "string" && prop in target) {
            return target[prop]
        }
        return target.Hobbyist
    },
}) as typeof AUTO_EVALUATION_TOUR_MAP
