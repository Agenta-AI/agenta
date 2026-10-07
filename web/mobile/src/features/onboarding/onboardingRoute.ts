import type {OnboardingDraft} from "./onboardingDraft"

/** Canonical order; analytics numbers steps by it and the URL names them by it. */
export const ONBOARDING_STEPS = ["role", "source", "credits", "templates", "review"] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

/** The four progress dots: each is the step it opens, and the templates dot covers review. */
export const PROGRESS_STEPS = ["role", "source", "credits", "templates"] as const
export const PROGRESS: Record<OnboardingStep, number> = {
    role: 0,
    source: 1,
    credits: 2,
    templates: 3,
    review: 3,
}

/** The gallery's focused panel: a blank start, one template, or (`null`) the list alone. */
export type GalleryFocus = {kind: "scratch"} | {kind: "template"; key: string} | null

/** Where the flow is, as its URL says: `/onboarding/<step>[/<template key | scratch>]`. */
export type OnboardingRoute =
    | {step: Exclude<OnboardingStep, "templates">}
    | {step: "templates"; focus: GalleryFocus}

const SCRATCH = "scratch"

export const stepRoute = (step: OnboardingStep): OnboardingRoute =>
    step === "templates" ? {step, focus: null} : {step}

/** The route a path's segments name, or `null` when they name none. */
export const parseOnboardingRoute = (segments: readonly string[]): OnboardingRoute | null => {
    const [step, detail, ...rest] = segments
    if (rest.length > 0) return null
    if (step === undefined) return {step: "role"}
    if (step === "templates") {
        if (!detail) return {step, focus: null}
        return {
            step,
            focus: detail === SCRATCH ? {kind: "scratch"} : {kind: "template", key: detail},
        }
    }
    if (detail !== undefined) return null
    return step === "source" || step === "credits" || step === "review" ? {step} : null
}

/** The path after `/onboarding`, without a leading slash; the role step is the bare page. */
export const onboardingRoutePath = (route: OnboardingRoute): string => {
    if (route.step === "role") return ""
    if (route.step !== "templates" || !route.focus) return route.step
    const detail = route.focus.kind === "scratch" ? SCRATCH : encodeURIComponent(route.focus.key)
    return `templates/${detail}`
}

type Answers = Pick<OnboardingDraft, "role" | "source" | "templateKey">

const answered = (answers: Answers) => answers.role !== null && answers.source !== null

/** What each step needs answered before it opens. */
const OPENS: Record<OnboardingStep, (answers: Answers) => boolean> = {
    role: () => true,
    source: (answers) => answers.role !== null,
    credits: answered,
    templates: answered,
    review: (answers) => answered(answers) && answers.templateKey !== null,
}

export const isStepOpen = (step: OnboardingStep, answers: Answers) => OPENS[step](answers)

/** The latest step the answers open, for a link to a step the user has not reached. */
export const furthestOnboardingRoute = (answers: Answers): OnboardingRoute =>
    stepRoute(ONBOARDING_STEPS.findLast((step) => OPENS[step](answers)) ?? "role")

/** The requested route when the answers open it, else the furthest one they do. */
export const guardOnboardingRoute = (
    requested: OnboardingRoute | null,
    answers: Answers,
): OnboardingRoute =>
    requested && OPENS[requested.step](answers) ? requested : furthestOnboardingRoute(answers)

/** Each step's heading id: focus lands on it, and its choices are labelled by it. */
export const onboardingHeadingId = (step: OnboardingStep) => `onboarding-heading-${step}`

export const onboardingStepNumber = (step: OnboardingStep) => ONBOARDING_STEPS.indexOf(step) + 1

export const stepIndex = (step: OnboardingStep) => ONBOARDING_STEPS.indexOf(step)
