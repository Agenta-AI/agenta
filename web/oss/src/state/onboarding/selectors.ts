import {atom} from "jotai"

import {onboardingSessionAtom} from "./atoms"

/**
 * Pre-commit onboarding is the current surface (minting or describing an agent, no real agent
 * yet). The one truth every app-behavior adjustment below derives from.
 */
export const isOnboardingActiveAtom = atom((get) => {
    const {active, committedRevisionId} = get(onboardingSessionAtom)
    return active && !committedRevisionId
})

// ── App-behavior adjustments driven by onboarding ────────────────────────────
// Consumers (sidebar, layout, nav guards) read these NAMED selectors — never the raw session
// atom or an ad-hoc pathname check — so onboarding-driven UI tweaks stay in this one module.

/** During onboarding, Home IS the current surface → the sidebar shows it selected. */
export const homeNavHighlightedAtom = atom((get) => get(isOnboardingActiveAtom))

/** During onboarding, clicking Home navigates to where you already are → make it a no-op. */
export const homeNavInertAtom = atom((get) => get(isOnboardingActiveAtom))

/**
 * During onboarding, nav links whose pages dead-end on an empty table (no apps/eval data yet) are
 * disabled. Links that work app-less (Observability, Test sets, Evaluators, Prompts) stay live.
 */
export const deadEndNavDisabledAtom = atom((get) => get(isOnboardingActiveAtom))
