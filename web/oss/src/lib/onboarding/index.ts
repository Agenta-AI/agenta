// App-local onboarding surface. The framework-free state/event layer lives in
// @agenta/onboarding/state and is imported DIRECTLY by consumers (the OSS lint rule
// forbids re-exporting @agenta/* symbols from app barrels — it breaks tree-shaking).
// Only the tour-runtime pieces that depend on @agentaai/nextstepjs, plus app content,
// stay here.

// Tour-runtime types (depend on @agentaai/nextstepjs)
export type {
    OnboardingStep,
    OnboardingTour,
    InternalTour,
    TriggerTourOptions,
    RegisterTourOptions,
    CurrentStepState,
} from "./types"

// Tour registry (app-owned singleton; no package consumer)
export {tourRegistry} from "./registry"

// currentStepStateAtom stays in the app (couples to OnboardingStep / nextstepjs)
export {currentStepStateAtom} from "./atoms"

// Widget config is app content (references app routes/sections)
export {defaultWidgetConfig} from "./widget/config"
