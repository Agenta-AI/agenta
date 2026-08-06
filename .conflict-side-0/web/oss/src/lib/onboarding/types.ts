import type {Step, Tour} from "@agentaai/nextstepjs"

/**
 * Extended step with lifecycle hooks and metadata
 */
export interface OnboardingStep extends Step {
    /** Step title */
    title: string
    /** Step content */
    content: React.ReactNode
    /** Called when the step becomes active */
    onEnter?: () => void
    /** Called when leaving the step */
    onExit?: () => void
    /** Called for cleanup when tour ends (skip/complete) */
    onCleanup?: () => void
    /** Called before advancing to next step - can be async */
    onNext?: () => void | Promise<void>
    /** Called before moving to previous step - can be async */
    onPrev?: () => void | Promise<void>
    /** Optional panel key for step-specific UI sync */
    panelKey?: string
    /** Show navigation controls */
    showControls?: boolean
    /** Show skip button */
    showSkip?: boolean
    /** Custom labels for control buttons */
    controlLabels?: {
        next?: string
        previous?: string
        finish?: string
    }
    /** Action to perform when user clicks Next */
    nextAction?: {
        selector: string
        type?: "click"
        waitForSelector?: string
        waitForSelectorVisible?: boolean
        waitForHiddenSelector?: string
        waitTimeoutMs?: number
        waitPollInterval?: number
        advanceOnActionClick?: boolean
    }
    /** Action to perform when user clicks Previous */
    prevAction?: {
        selector: string
        type?: "click"
        waitForSelector?: string
        waitForSelectorVisible?: boolean
        waitForHiddenSelector?: string
        waitTimeoutMs?: number
        waitPollInterval?: number
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
