export type {
    OnboardingWidgetConfig,
    OnboardingWidgetItem,
    OnboardingWidgetSection,
    OnboardingWidgetStatus,
} from "./types"

export {
    onboardingWidgetCompletionAtom,
    onboardingWidgetConfigAtom,
    onboardingWidgetEventsAtom,
    onboardingWidgetExpandedSectionsAtom,
    onboardingWidgetStatusAtom,
    onboardingWidgetUIStateAtom,
    recordWidgetEventAtom,
    setOnboardingWidgetConfigAtom,
    setWidgetSectionExpandedAtom,
    hasSeenCloseTooltipAtom,
    openWidgetAtom,
} from "./store"

export {defaultWidgetConfig} from "./config"
export type {OnboardingWidgetUIState} from "./store"
