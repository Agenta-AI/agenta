// Identity + tour-seen state
export {
    onboardingStorageUserIdAtom,
    isNewUserAtom,
    seenToursAtom,
    markTourSeenAtom,
    hasTourBeenSeenAtom,
    resetSeenToursAtom,
    activeTourIdAtom,
} from "./atoms"

// Widget + event state
export {
    onboardingWidgetCompletionAtom,
    onboardingWidgetConfigAtom,
    onboardingWidgetActivationAtom,
    onboardingWidgetEventsAtom,
    onboardingWidgetExpandedSectionsAtom,
    onboardingWidgetManuallyCollapsedAtom,
    onboardingWidgetStatusAtom,
    onboardingWidgetUIStateAtom,
    recordWidgetEventAtom,
    setOnboardingWidgetActivationAtom,
    setOnboardingWidgetConfigAtom,
    setWidgetSectionExpandedAtom,
    setWidgetSectionManuallyCollapsedAtom,
    hasSeenCloseTooltipAtom,
    openWidgetAtom,
    computedExpandedSectionsAtom,
    firstIncompleteSectionIdAtom,
} from "./widgetStore"

export type {OnboardingWidgetUIState} from "./widgetStore"
export type {
    OnboardingWidgetConfig,
    OnboardingWidgetItem,
    OnboardingWidgetSection,
    OnboardingWidgetStatus,
} from "./types"
