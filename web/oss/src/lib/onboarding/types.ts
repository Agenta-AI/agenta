import type {Tour, Step} from "@agentaai/nextstepjs"

/**
 * Extended step with lifecycle hooks and metadata
 */
export interface OnboardingStep extends Step {
    /** Called when the step becomes active */
    onEnter?: () => void
    /** Called when leaving the step */
    onExit?: () => void
    /** Called for cleanup when tour ends (skip/complete) */
    onCleanup?: () => void
    /** Called before advancing to next step - can be async */
    onNext?: () => void | Promise<void>
    /** Custom labels for control buttons */
    controlLabels?: {
        next?: string
        previous?: string
        finish?: string
    }
}

/**
 * Tour definition with extended steps
 */
export interface OnboardingTour {
    /** Unique identifier for the tour */
    id: string
    /** Steps in the tour */
    steps: OnboardingStep[]
}

/**
 * Internal tour format compatible with nextstepjs
 */
export interface InternalTour extends Tour {
    tour: string
    steps: OnboardingStep[]
}

/**
 * Options for triggering a tour
 */
export interface TriggerTourOptions {
    /** Force show even if already seen */
    force?: boolean
}

/**
 * Tour registration options
 */
export interface RegisterTourOptions {
    /**
     * Condition function - tour only shows if this returns true
     * Useful for feature flags, user permissions, etc.
     */
    condition?: () => boolean
}

/**
 * Current step state exposed to card component
 */
export interface CurrentStepState {
    step: OnboardingStep | null
    currentStep: number
    totalSteps: number
}
