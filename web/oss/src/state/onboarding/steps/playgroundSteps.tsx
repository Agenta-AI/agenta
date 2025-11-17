import {getDefaultStore} from "jotai"
import {
    appChatModeAtom,
    displayedVariantsAtom,
    variantByRevisionIdAtomFamily,
} from "@/oss/components/Playground/state/atoms"
import {closeTraceDrawerAtom} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"
import {
    openDeployVariantModalAtom,
    closeDeployVariantModalAtom,
} from "@/oss/components/Playground/Components/Modals/DeployVariantModal/store/deployVariantModalStore"
import {TRACE_DRAWER_STEPS} from "./traceSteps"
import {OnboardingStepsContext, TourDefinition} from "./types"

const triggerTraceButtonClick = () => {
    if (typeof window === "undefined") return
    const button = document.getElementById("tour-playground-trace-button")
    if (!button) return
    button.dispatchEvent(new MouseEvent("click", {bubbles: true}))
}

const closeTraceDrawer = () => {
    getDefaultStore().set(closeTraceDrawerAtom)
}

const TRACE_STEPS_FOR_PLAYGROUND = TRACE_DRAWER_STEPS.slice(0, 4).map((step) => {
    if (step.selector === "#tour-trace-tree-panel") {
        return {
            ...step,
            onEnter: () => triggerTraceButtonClick(),
            onboardingSection: "playgroundPostRun",
        }
    }

    return {
        ...step,
        onboardingSection: "playgroundPostRun",
    }
})

const openDeployModalForCurrentVariant = () => {
    const store = getDefaultStore()
    const variants = store.get(displayedVariantsAtom) || []
    const revisionId = variants[0]
    if (!revisionId) return
    const variant = store.get(variantByRevisionIdAtomFamily(revisionId)) as any

    const payload = {
        parentVariantId: variant?.variantId ?? null,
        revisionId: variant?.id ?? revisionId,
        variantName: variant?.variantName ?? variant?.name ?? "Current variant",
        revision: variant?.revisionNumber ?? variant?.revision ?? "",
        mutate: undefined,
    }

    store.set(openDeployVariantModalAtom, payload as any)
}

const closeDeployModal = () => {
    getDefaultStore().set(closeDeployVariantModalAtom)
}

const PLAYGROUND_COMPLETION_TOUR: TourDefinition = [
    {
        tour: "playground-completion-quickstart",
        steps: [
            {
                icon: "🧠",
                title: "Shape the prompt",
                content: (
                    <span>
                        Edit your system and user messages here to steer how Agenta completes the
                        request.
                    </span>
                ),
                selector: "#tour-playground-prompt",
                side: "right",
                showControls: true,
                showSkip: true,
                pointerPadding: 12,
                pointerRadius: 12,
            },
            {
                icon: "🎛️",
                title: "Set test variables",
                content: (
                    <span>
                        Provide example values for your template inputs to preview different
                        scenarios.
                    </span>
                ),
                selector: "#tour-playground-variable",
                side: "right",
                showControls: true,
                showSkip: true,
                pointerPadding: 12,
                pointerRadius: 12,
                viewportId: "scrollable-viewport",
            },
            {
                icon: "🧪",
                title: "Load a saved testset",
                content: (
                    <span>
                        Reuse curated scenarios by loading a testset. It auto-populates the
                        variables so you can replay regressions instantly.
                    </span>
                ),
                selector: "#tour-playground-load-testset",
                side: "bottom",
                showControls: true,
                showSkip: true,
                pointerPadding: 12,
                pointerRadius: 12,
            },
            {
                icon: "⚡️",
                title: "Run the prompt",
                content: (
                    <span>
                        Execute the prompt with the current variables to inspect the output.
                    </span>
                ),
                selector: "#tour-playground-run-button",
                side: "bottom",
                showControls: true,
                showSkip: true,
                pointerPadding: 6,
                pointerRadius: 12,
                viewportId: "scrollable-viewport",
            },
        ],
    },
]

const PLAYGROUND_CHAT_TOUR: TourDefinition = [
    {
        tour: "playground-chat-quickstart",
        steps: [
            {
                icon: "🧠",
                title: "Craft the system prompt",
                content: (
                    <span>
                        Define high-level guidance for your assistant. This prompt sets the tone for
                        every reply.
                    </span>
                ),
                selector: "#tour-playground-prompt",
                side: "right",
                showControls: true,
                showSkip: true,
                pointerPadding: 12,
                pointerRadius: 12,
            },
            {
                icon: "📥",
                title: "Set conversation context",
                content: (
                    <span>
                        Provide any scenario-specific inputs so the model understands the user’s
                        request before chat begins.
                    </span>
                ),
                selector: "#tour-playground-variable",
                side: "right",
                showControls: true,
                showSkip: true,
                pointerPadding: 12,
                pointerRadius: 12,
                viewportId: "scrollable-viewport",
            },
            {
                icon: "💬",
                title: "Write the user message",
                content: (
                    <span>
                        Type the first user turn to kick off your conversation and test the flow.
                    </span>
                ),
                selector: "#tour-chat-user-message",
                side: "left",
                showControls: true,
                showSkip: true,
                pointerPadding: 12,
                pointerRadius: 12,
                viewportId: "scrollable-viewport",
            },
            {
                icon: "⚡️",
                title: "Run the chat turn",
                content: (
                    <span>
                        Execute the chat turn to preview the assistant response and iterate quickly.
                    </span>
                ),
                selector: "#tour-playground-run-button",
                side: "bottom",
                showControls: true,
                showSkip: true,
                pointerPadding: 12,
                pointerRadius: 12,
                viewportId: "scrollable-viewport",
            },
        ],
    },
]

const getPlaygroundTourDefinition = (): TourDefinition => {
    const store = getDefaultStore()
    const isChat = store.get(appChatModeAtom)
    return isChat ? PLAYGROUND_CHAT_TOUR : PLAYGROUND_COMPLETION_TOUR
}

const buildPostRunSteps = (mode: "completion" | "chat") => {
    const isChat = mode === "chat"

    return [
        {
            icon: isChat ? "💬" : "📄",
            title: isChat ? "Inspect assistant turns" : "Review the response",
            content: (
                <span>
                    {isChat
                        ? "Scroll through the assistant response to validate tool calls, JSON payloads, and structured replies."
                        : "Inspect the latest output and verify whether the completion follows the variables and instructions you provided."}
                </span>
            ),
            selector: "#tour-playground-output-panel",
            side: "left",
            showControls: true,
            showSkip: true,
            pointerPadding: 12,
            pointerRadius: 12,
            viewportId: "scrollable-viewport",
            onboardingSection: "playgroundPostRun" as const,
        },
        {
            icon: "🧠",
            title: "Trace every run",
            content: (
                <span>
                    Open the trace drawer to debug latency, token usage, and each span that powered
                    this run.
                </span>
            ),
            selector: "#tour-playground-trace-button",
            side: "bottom",
            showControls: true,
            showSkip: true,
            pointerPadding: 12,
            pointerRadius: 12,
            onboardingSection: "playgroundPostRun" as const,
            onEnter: () => closeTraceDrawer(),
        },
        ...TRACE_STEPS_FOR_PLAYGROUND,
        {
            icon: "🧪",
            title: "Add runs to a testset",
            content: (
                <span>
                    Capture the current outputs into a testset so you can build regression suites
                    and evaluate new variants later.
                </span>
            ),
            selector: "#tour-playground-add-testset",
            side: "left",
            showControls: true,
            showSkip: true,
            pointerPadding: 12,
            pointerRadius: 12,
            onboardingSection: "playgroundPostRun" as const,
            onEnter: () => closeTraceDrawer(),
        },
        {
            icon: "🚀",
            title: "Deploy your variant",
            content: (
                <span>
                    Ship this iteration to an environment when you&apos;re confident with the
                    current run.
                </span>
            ),
            selector: "#tour-playground-deploy-button",
            side: "bottom",
            showControls: true,
            showSkip: true,
            pointerPadding: 12,
            pointerRadius: 12,
            onboardingSection: "playgroundPostRun" as const,
            onEnter: () => closeDeployModal(),
        },
        {
            icon: "🌐",
            title: "Choose an environment",
            content: (
                <span>
                    Pick the target environment for this deployment. Each row represents one of your
                    configured stages.
                </span>
            ),
            selector: "#tour-playground-deploy-modal-table",
            side: "top",
            showControls: true,
            showSkip: true,
            pointerPadding: 12,
            pointerRadius: 12,
            onboardingSection: "playgroundPostRun" as const,
            onEnter: () => openDeployModalForCurrentVariant(),
        },
        {
            icon: "✅",
            title: "Confirm deployment",
            content: (
                <span>
                    Deploy the selected variant to the chosen environment. You can always redeploy
                    after more changes.
                </span>
            ),
            selector: "#tour-playground-deploy-modal-confirm",
            side: "bottom",
            showControls: true,
            showSkip: true,
            pointerPadding: 12,
            pointerRadius: 12,
            onboardingSection: "playgroundPostRun" as const,
            onCleanup: () => closeDeployModal(),
        },
    ]
}

const PLAYGROUND_COMPLETION_RESULT_TOUR: TourDefinition = [
    {
        tour: "playground-completion-post-run",
        steps: buildPostRunSteps("completion"),
    },
]

const PLAYGROUND_CHAT_RESULT_TOUR: TourDefinition = [
    {
        tour: "playground-chat-post-run",
        steps: buildPostRunSteps("chat"),
    },
]

const getPlaygroundResultTourDefinition = (): TourDefinition => {
    const store = getDefaultStore()
    const isChat = store.get(appChatModeAtom)
    return isChat ? PLAYGROUND_CHAT_RESULT_TOUR : PLAYGROUND_COMPLETION_RESULT_TOUR
}

const PLAYGROUND_TOUR_MAP: Record<string, (ctx: OnboardingStepsContext) => TourDefinition> = {
    Hobbyist: (_ctx) => getPlaygroundTourDefinition(),
    "ML/AI Engineer or Data scientist": (_ctx) => getPlaygroundTourDefinition(),
    "Frontend / Backend Developer": (_ctx) => getPlaygroundTourDefinition(),
}

export const PLAYGROUND_TOURS = new Proxy(PLAYGROUND_TOUR_MAP, {
    get(target, prop: string | symbol) {
        if (typeof prop === "string" && prop in target) {
            return target[prop]
        }
        return target.Hobbyist
    },
}) as typeof PLAYGROUND_TOUR_MAP

export const resolvePlaygroundPostRunTour = () => getPlaygroundResultTourDefinition()
