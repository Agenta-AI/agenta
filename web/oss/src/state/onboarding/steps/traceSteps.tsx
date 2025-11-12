import {getDefaultStore} from "jotai"

import {
    isDrawerOpenAtom,
    traceDrawerActiveTabAtom,
    traceDrawerAtom,
    TraceDrawerTabKey,
    TRACE_DRAWER_VIEWPORT_ID,
} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"

import {OnboardingStepsContext, TourDefinition} from "./types"

const TRACE_TABS_BY_SELECTOR: Record<string, TraceDrawerTabKey> = {
    "#tour-trace-tab-overview": "overview",
    "#tour-trace-tab-raw": "raw_data",
    "#tour-trace-tab-annotations": "annotations",
}

const ensureTraceTab = (selector?: string | null) => {
    if (!selector) return
    const tab = TRACE_TABS_BY_SELECTOR[selector]
    if (!tab) return

    getDefaultStore().set(traceDrawerActiveTabAtom, tab)
}

export const TRACE_DRAWER_STEPS: TourDefinition[number]["steps"] = [
    {
        icon: "🌲",
        title: "Span navigator",
        content: (
            <span>
                The trace tree lists every span in execution order. Click any node to focus the
                central detail view.
            </span>
        ),
        selector: "#tour-trace-tree-panel",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        viewportID: TRACE_DRAWER_VIEWPORT_ID,
    },
    {
        icon: "📊",
        title: "Metrics rail",
        content: (
            <span>
                Use the side rail to inspect latency, token usage, cost, and request metadata for
                the selected span.
            </span>
        ),
        selector: "#tour-trace-side-panel",
        side: "left",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        viewportID: TRACE_DRAWER_VIEWPORT_ID,
    },
    {
        icon: "🧪",
        title: "Add to testsets",
        content: (
            <span>
                Capture this span&apos;s inputs and outputs into a regression testset so you can
                evaluate new variants later.
            </span>
        ),
        selector: "#tour-trace-add-testset",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        viewportID: TRACE_DRAWER_VIEWPORT_ID,
    },
    {
        icon: "✍️",
        title: "Annotate spans",
        content: (
            <span>
                Open the annotation drawer to record qualitative feedback or kick off evaluator
                workflows directly from a trace.
            </span>
        ),
        selector: "#tour-trace-annotate-button",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        viewportID: TRACE_DRAWER_VIEWPORT_ID,
    },
    {
        icon: "💬",
        title: "Annotation summaries",
        content: (
            <span>
                Review existing annotations, rubric scores, and reviewer notes grouped by evaluator.
            </span>
        ),
        selector: "#tour-trace-annotation-view",
        side: "left",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        viewportID: TRACE_DRAWER_VIEWPORT_ID,
    },
    {
        icon: "🧭",
        title: "Overview tab",
        content: (
            <span>
                Start here to get a curated summary of prompts, tool calls, latency, and tokens for
                the active span.
            </span>
        ),
        selector: "#tour-trace-tab-overview",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        viewportID: TRACE_DRAWER_VIEWPORT_ID,
    },
    {
        icon: "📄",
        title: "Raw data tab",
        content: (
            <span>
                Inspect the raw request and response payloads, metadata, and structured context in
                their original format.
            </span>
        ),
        selector: "#tour-trace-tab-raw",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        viewportID: TRACE_DRAWER_VIEWPORT_ID,
    },
    {
        icon: "🏷️",
        title: "Annotations tab",
        content: (
            <span>
                Focus solely on human or automated annotations inside a dedicated workspace for deep
                review.
            </span>
        ),
        selector: "#tour-trace-tab-annotations",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        viewportID: TRACE_DRAWER_VIEWPORT_ID,
    },
]

const TRACE_DRAWER_TOUR: TourDefinition = [
    {
        tour: "trace-drawer-quickstart",
        steps: TRACE_DRAWER_STEPS,
    },
]

const ensureDrawerReady = () => {
    const store = getDefaultStore()
    const state = store.get(traceDrawerAtom)
    if (!state?.traceId) {
        return false
    }
    if (!store.get(isDrawerOpenAtom)) {
        store.set(traceDrawerAtom, (draft) => {
            draft.open = true
        })
    }
    return true
}

const withTraceDrawerTour = (ctx: OnboardingStepsContext) => {
    if (!ensureDrawerReady()) return []
    ensureTraceTab(ctx.currentStep?.selector ?? null)
    return TRACE_DRAWER_TOUR
}

const TRACE_TOUR_MAP: Record<string, (ctx: OnboardingStepsContext) => TourDefinition> = {
    Hobbyist: (ctx) => withTraceDrawerTour(ctx),
    "ML/AI Engineer or Data scientist": (ctx) => withTraceDrawerTour(ctx),
    "Frontend / Backend Developer": (ctx) => withTraceDrawerTour(ctx),
}

export const TRACE_TOURS = new Proxy(TRACE_TOUR_MAP, {
    get(target, prop: string | symbol) {
        if (typeof prop === "string" && prop in target) {
            return target[prop]
        }
        return target.Hobbyist
    },
}) as typeof TRACE_TOUR_MAP
