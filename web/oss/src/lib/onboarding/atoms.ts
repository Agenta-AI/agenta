import {atom} from "jotai"

import type {CurrentStepState} from "./types"

/**
 * Current step state - exposed for the OnboardingCard component.
 *
 * This atom stays in the app rather than @agenta/onboarding because CurrentStepState.step is
 * OnboardingStep, which depends on @agentaai/nextstepjs (the tour runtime). Keeping it here lets
 * the package remain free of that dependency. All other onboarding state (identity, seen-tours,
 * widget/event atoms) lives in @agenta/onboarding/state and is re-exported from ./index.
 */
export const currentStepStateAtom = atom<CurrentStepState>({
    step: null,
    currentStep: 0,
    totalSteps: 0,
})
