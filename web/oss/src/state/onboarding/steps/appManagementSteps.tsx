import {isAddAppFromTemplatedAtom} from "@/oss/components/pages/app-management/state/atom"
import {appChatModeAtom} from "@/oss/components/Playground/state/atoms"
import {getDefaultStore} from "jotai"
import {
    getDemoEvaluationRunRoute,
    getOnlineEvaluationsRoute,
    getPlaygroundRoute,
} from "../assets/utils"
import {ONLINE_EVAL_RUN_STEPS} from "./evaluations/onlineEvaluationSteps"
import {PLAYGROUND_CHAT_TOUR, PLAYGROUND_COMPLETION_TOUR} from "./playgroundSteps"
import {OnboardingStepsContext, TourDefinition} from "./types"

const openTemplateModal = () => {
    getDefaultStore().set(isAddAppFromTemplatedAtom, true)
}

const closeTemplateModal = () => {
    getDefaultStore().set(isAddAppFromTemplatedAtom, false)
}

export const GLOBAL_APP_MANAGEMENT_STEPS = [
    {
        icon: "🚀",
        title: "Create a new prompt",
        content: <span>Click here to create new application using predefined templates</span>,
        selector: "#tour-create-new-prompt",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: closeTemplateModal,
        onCleanup: closeTemplateModal,
    },
    {
        icon: "📝",
        title: "Name your app",
        content: (
            <span>
                Give your app a descriptive name so teammates immediately understand its purpose.
            </span>
        ),
        selector: "#tour-app-name-input",
        side: "top",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: openTemplateModal,
        onCleanup: closeTemplateModal,
    },
    {
        icon: "📚",
        title: "Choose a template",
        content: <span>Select a template that fits your use case.</span>,
        selector: "#tour-template-list",
        side: "top",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: openTemplateModal,
        onCleanup: closeTemplateModal,
    },
    {
        icon: "✅",
        title: "Create the app",
        content: <span>Provision your first app by creating it with the selected template.</span>,
        selector: "#tour-create-app-button",
        side: "top",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: openTemplateModal,
        onCleanup: closeTemplateModal,
    },
]

const resolveGlobalAppTour = (): TourDefinition => {
    return [
        {
            tour: "create-first-app",
            steps: GLOBAL_APP_MANAGEMENT_STEPS,
        },
    ]
}

const withOnboardingSection = (() => {
    const cache = new WeakMap<
        TourDefinition[number]["steps"],
        Map<string, TourDefinition[number]["steps"]>
    >()
    return (
        steps: TourDefinition[number]["steps"],
        section: "apps" | "playground" | "evaluations",
    ) => {
        let sectionCache = cache.get(steps)
        if (!sectionCache) {
            sectionCache = new Map()
            cache.set(steps, sectionCache)
        }
        if (sectionCache.has(section)) {
            return sectionCache.get(section)!
        }
        const normalized = steps.map((step) => ({
            ...step,
            onboardingSection: section,
        }))
        sectionCache.set(section, normalized)
        return normalized
    }
})()

const APP_SECTION_STEPS = withOnboardingSection(GLOBAL_APP_MANAGEMENT_STEPS, "apps")
const COMPLETION_PLAYGROUND_SECTION_STEPS = withOnboardingSection(
    PLAYGROUND_COMPLETION_TOUR,
    "playground",
)
const CHAT_PLAYGROUND_SECTION_STEPS = withOnboardingSection(PLAYGROUND_CHAT_TOUR, "playground")
const ONLINE_EVAL_RUN_SECTION_STEPS = withOnboardingSection(
    ONLINE_EVAL_RUN_STEPS.slice(0, 2),
    "evaluations",
)

const SME_TOUR_CACHE = new Map<string, TourDefinition>()

const resolveSmeJourneyTour = (ctx: OnboardingStepsContext): TourDefinition => {
    if (ctx.userOnboardingStatus.fullJourney !== "idle") {
        return resolveGlobalAppTour()
    }
    const store = getDefaultStore()
    const isChat = store.get(appChatModeAtom)
    const playgroundRoute = getPlaygroundRoute()
    const onlineEvaluationsRoute = getOnlineEvaluationsRoute()
    const demoEvaluationRoute = getDemoEvaluationRunRoute()
    const cacheKey = `${isChat ? "chat" : "completion"}|${playgroundRoute ?? "none"}|${onlineEvaluationsRoute ?? "none"}|${demoEvaluationRoute ?? "none"}`
    const cached = SME_TOUR_CACHE.get(cacheKey)
    if (cached) return cached

    const playgroundSteps = isChat
        ? CHAT_PLAYGROUND_SECTION_STEPS
        : COMPLETION_PLAYGROUND_SECTION_STEPS

    const tour: TourDefinition = [
        {
            tour: "sme-guided-journey",
            steps: [
                ...APP_SECTION_STEPS,
                ...playgroundSteps,
                {
                    title: "Lets move to online evaluations now",
                    content:
                        "Now that you've explored the playground, let's move on to setting up always-on evaluations.",

                    showControls: true,
                    showSkip: true,
                    pointerPadding: 6,
                    pointerRadius: 12,
                    onboardingSection: "playground",
                    nextRoute: getOnlineEvaluationsRoute() ?? undefined,
                },
                {
                    title: "Inspect demo-evaluation",
                    content: (
                        <span>
                            Opening demo-evaluation so you can inspect the live table, overview, and
                            metrics we&apos;ve prepared.
                        </span>
                    ),

                    showControls: true,
                    showSkip: true,
                    pointerPadding: 6,
                    pointerRadius: 12,
                    onboardingSection: "evaluation",
                    nextRoute: demoEvaluationRoute ?? undefined,
                },
                ...ONLINE_EVAL_RUN_SECTION_STEPS,
            ],
        },
    ]
    SME_TOUR_CACHE.set(cacheKey, tour)
    return tour
}

const APP_MANAGEMENT_TOUR_MAP: Record<string, (ctx: OnboardingStepsContext) => TourDefinition> = {
    Hobbyist: () => resolveGlobalAppTour(),
    "ML/AI Engineer or Data scientist": () => resolveGlobalAppTour(),
    "Frontend / Backend Developer": () => resolveGlobalAppTour(),
    sme: (ctx) => resolveSmeJourneyTour(ctx),
}

export const APP_MANAGEMENT_TOURS = new Proxy(APP_MANAGEMENT_TOUR_MAP, {
    get(target, prop: string | symbol) {
        if (typeof prop === "string" && prop in target) {
            return target[prop]
        }
        return target.Hobbyist
    },
}) as typeof APP_MANAGEMENT_TOUR_MAP
