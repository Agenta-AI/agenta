// Types
export type {
    OnboardingStep,
    OnboardingTour,
    InternalTour,
    TriggerTourOptions,
    RegisterTourOptions,
    CurrentStepState,
} from "./types"

// Registry
export {tourRegistry} from "./registry"

// Widget
export {
    onboardingWidgetCompletionAtom,
    onboardingWidgetConfigAtom,
    onboardingWidgetEventsAtom,
    onboardingWidgetExpandedSectionsAtom,
    onboardingWidgetStatusAtom,
    onboardingWidgetUIStateAtom,
    onboardingWidgetActivationAtom,
    recordWidgetEventAtom,
    setOnboardingWidgetConfigAtom,
    setOnboardingWidgetActivationAtom,
    setWidgetSectionExpandedAtom,
    hasSeenCloseTooltipAtom,
    openWidgetAtom,
} from "./widget"
export type {
    OnboardingWidgetConfig,
    OnboardingWidgetItem,
    OnboardingWidgetSection,
    OnboardingWidgetStatus,
    OnboardingWidgetUIState,
} from "./widget"
export {defaultWidgetConfig} from "./widget"

// Atoms
export {
    isNewUserAtom,
    seenToursAtom,
    markTourSeenAtom,
    hasTourBeenSeenAtom,
    resetSeenToursAtom,
    activeTourIdAtom,
    currentStepStateAtom,
} from "./atoms"
