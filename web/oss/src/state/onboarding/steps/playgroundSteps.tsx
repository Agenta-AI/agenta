import {appChatModeAtom} from "@/oss/components/Playground/state/atoms"
import {getDefaultStore} from "jotai"
import {OnboardingStepsContext, TourDefinition} from "./types"

export const PLAYGROUND_COMPLETION_TOUR: TourDefinition[number]["steps"] = [
    {
        icon: "🧠",
        title: "Shape the prompt",
        content: (
            <span>
                Edit your system and user messages here to steer how Agenta completes the request.
            </span>
        ),
        onboardingSection: "playground" as const,
        selector: "#tour-playground-prompt",
        side: "right",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
    },
    {
        icon: "🧪",
        title: "Load a saved testset",
        content: (
            <span>
                Reuse curated scenarios by loading a testset. It auto-populates the variables so you
                can replay regressions instantly.
            </span>
        ),
        onboardingSection: "playground" as const,
        selector: "#tour-playground-load-testset",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        advanceOnClick: true,
    },
    {
        icon: "⚡️",
        title: "Run the prompt",
        content: <span>Execute the prompt with the current variables to inspect the output.</span>,
        onboardingSection: "playground" as const,
        selector: "#tour-playground-run-all-button",
        side: "left",
        showControls: true,
        showSkip: true,
        pointerPadding: 6,
        pointerRadius: 12,
        viewportId: "scrollable-viewport",
        advanceOnClick: true,
    },
]

export const PLAYGROUND_CHAT_TOUR: TourDefinition[number]["steps"] = [
    {
        icon: "🧠",
        title: "Craft the system prompt",
        content: (
            <span>
                Define high-level guidance for your assistant. This prompt sets the tone for every
                reply.
            </span>
        ),
        onboardingSection: "playground" as const,
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
                Provide any scenario-specific inputs so the model understands the user’s request
                before chat begins.
            </span>
        ),
        onboardingSection: "playground" as const,
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
            <span>Type the first user turn to kick off your conversation and test the flow.</span>
        ),
        onboardingSection: "playground" as const,
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
        onboardingSection: "playground" as const,
        selector: "#tour-playground-run-all-button",
        side: "left",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        viewportId: "scrollable-viewport",
        advanceOnClick: true,
    },
]

export const POST_PLAYGROUND_TOUR = [
    {
        icon: "🧠",
        title: "Trace every run",
        content: (
            <span>
                Open the trace drawer to debug latency, token usage, and each span that powered this
                run.
            </span>
        ),
        selector: "#tour-playground-trace-button",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onboardingSection: "playgroundPostRun" as const,
        advanceOnClick: true,
    },
    {
        icon: "🧪",
        title: "Add runs to a testset",
        content: (
            <span>
                Capture the current outputs into a testset so you can build regression suites and
                evaluate new variants later.
            </span>
        ),
        selector: "#tour-playground-add-testset",
        side: "left",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onboardingSection: "playgroundPostRun" as const,
        advanceOnClick: true,
    },
]

const getPlaygroundTourDefinition = (): TourDefinition => {
    const store = getDefaultStore()
    const isChat = store.get(appChatModeAtom)
    return isChat
        ? [{tour: "playground-quickstart", steps: PLAYGROUND_CHAT_TOUR}]
        : [{tour: "playground-quickstart", steps: PLAYGROUND_COMPLETION_TOUR}]
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

export const resolvePlaygroundPostRunTour = () => POST_PLAYGROUND_TOUR
