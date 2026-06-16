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
    onboardingWidgetCompletionLoadingAtom,
} from "./widgetStore"

// Entity-driven completion (app-registered selectors)
export {
    setCompletionSelectors,
    getCompletionSelectors,
    resetCompletionSelectors,
} from "./completionSelectors"
export type {
    CompletionState,
    CompletionSelector,
    CompletionSelectorMap,
} from "./completionSelectors"

export type {OnboardingWidgetUIState} from "./widgetStore"
export type {
    OnboardingWidgetConfig,
    OnboardingWidgetItem,
    OnboardingWidgetSection,
    OnboardingWidgetStatus,
} from "./types"
