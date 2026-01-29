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
