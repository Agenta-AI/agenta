import type {OnboardingDraft} from "./onboardingDraft"
import {ONBOARDING_QUESTIONS, type OnboardingQuestionId} from "./onboardingQuestions"

/** The steps after the questions, always shown. */
const FIXED_STEPS = ["credits", "templates", "review"] as const
type FixedStep = (typeof FIXED_STEPS)[number]

export type OnboardingStep = OnboardingQuestionId | FixedStep

/** The steps this flow shows, in order. */
export type OnboardingSteps = readonly OnboardingStep[]

export const isFixedStep = (step: string): step is FixedStep =>
    (FIXED_STEPS as readonly string[]).includes(step)

/** Every registry question, shown or not, then the fixed steps; analytics numbers steps by it. */
const canonicalSteps = (): OnboardingSteps => [
    ...ONBOARDING_QUESTIONS.map((question) => question.id),
    ...FIXED_STEPS,
]

export const stepIndex = (step: OnboardingStep) => canonicalSteps().indexOf(step)

export const isOnboardingStep = (value: string): value is OnboardingStep =>
    canonicalSteps().includes(value as OnboardingStep)

/** The enabled questions in registry order, then the fixed steps. */
export const onboardingSteps = (): OnboardingSteps => [
    ...ONBOARDING_QUESTIONS.filter((question) => question.enabled).map((question) => question.id),
    ...FIXED_STEPS,
]

/** The progress dots: every shown step but review, which shares the templates dot. */
export const progressSteps = (steps: OnboardingSteps) => steps.filter((step) => step !== "review")

export const progressIndex = (step: OnboardingStep, steps: OnboardingSteps) =>
    progressSteps(steps).indexOf(step === "review" ? "templates" : step)

/** The shown step after `step`. */
export const nextStep = (step: OnboardingStep, steps: OnboardingSteps): OnboardingStep =>
    steps[steps.indexOf(step) + 1] ?? step

/** The gallery's focused panel: a blank start, one template, or (`null`) the list alone. */
export type GalleryFocus = {kind: "scratch"} | {kind: "template"; key: string} | null

/** Where the flow is, as its URL says: `/onboarding/<step>[/<template key | scratch>]`. */
export type OnboardingRoute =
    | {step: Exclude<OnboardingStep, "templates">}
    | {step: "templates"; focus: GalleryFocus}

const SCRATCH = "scratch"

export const stepRoute = (step: OnboardingStep): OnboardingRoute =>
    step === "templates" ? {step, focus: null} : {step}

/** The route a path's segments name, or `null` when they name none (the bare page resumes). */
export const parseOnboardingRoute = (segments: readonly string[]): OnboardingRoute | null => {
    const [step, detail, ...rest] = segments
    if (rest.length > 0 || step === undefined || !isOnboardingStep(step)) return null
    if (step === "templates") {
        if (!detail) return {step, focus: null}
        return {
            step,
            focus: detail === SCRATCH ? {kind: "scratch"} : {kind: "template", key: detail},
        }
    }
    return detail === undefined ? {step} : null
}

/** The path after `/onboarding`, without a leading slash. */
export const onboardingRoutePath = (route: OnboardingRoute): string => {
    if (route.step !== "templates" || !route.focus) return route.step
    const detail = route.focus.kind === "scratch" ? SCRATCH : encodeURIComponent(route.focus.key)
    return `templates/${detail}`
}

type Answers = Pick<OnboardingDraft, "answers" | "templateKey">

/** A later step opens once every shown question before it is answered. */
export const isStepOpen = (step: OnboardingStep, draft: Answers, steps: OnboardingSteps) => {
    const at = steps.indexOf(step)
    if (at < 0) return false
    const asked = steps
        .slice(0, at)
        .every((earlier) => isFixedStep(earlier) || draft.answers[earlier] !== undefined)
    return asked && (step !== "review" || draft.templateKey !== null)
}

/** The latest step the answers open, for a link to a step the user has not reached. */
const furthestOnboardingRoute = (answers: Answers, steps: OnboardingSteps): OnboardingRoute =>
    stepRoute(steps.findLast((step) => isStepOpen(step, answers, steps)) ?? steps[0])

/** The requested route when the answers open it, else the furthest one they do. */
export const guardOnboardingRoute = (
    requested: OnboardingRoute | null,
    answers: Answers,
    steps: OnboardingSteps,
): OnboardingRoute =>
    requested && isStepOpen(requested.step, answers, steps)
        ? requested
        : furthestOnboardingRoute(answers, steps)

/** Each step's heading id: focus lands on it, and its choices are labelled by it. */
export const onboardingHeadingId = (step: OnboardingStep) => `onboarding-heading-${step}`
