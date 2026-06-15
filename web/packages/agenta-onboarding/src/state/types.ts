/**
 * Pure-state types for the onboarding state/event layer.
 *
 * Tour-runtime types (OnboardingStep/OnboardingTour/InternalTour) and CurrentStepState depend
 * on @agentaai/nextstepjs and intentionally stay in the app
 * (web/oss/src/lib/onboarding/types.ts) alongside the registry, card, and provider. This
 * package carries only the framework-free widget/event state.
 */

export interface OnboardingWidgetItem {
    id: string
    title: string
    description?: string
    tourId?: string
    href?: string
    disabled?: boolean
    activationHint?: string
    completionEventIds?: string[]
    completionMode?: "all" | "any"
    subTaskIds?: string[]
}

export interface OnboardingWidgetSection {
    id: string
    title: string
    iconId?: "prompts" | "evaluations" | "registry" | "tracing"
    items: OnboardingWidgetItem[]
}

export interface OnboardingWidgetConfig {
    sections: OnboardingWidgetSection[]
}

export type OnboardingWidgetStatus = "pending" | "completed" | "dismissed"
