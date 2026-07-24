import {atom} from "jotai"

import {navSimplifiedDefaultAtom} from "@/oss/lib/onboarding/atoms"

import {onboardingSessionAtom} from "./atoms"

/**
 * Pre-commit onboarding is the current surface (minting or describing an agent, no real agent
 * yet). The truth the session-driven adjustments below derive from (the signup-era nav default
 * that drives {@link advancedNavHiddenAtom} is separate).
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

/**
 * The simplified, agent-focused sidebar hides advanced areas (Prompts, Evaluation, Registry,
 * Evaluations, Overview). Unlike the selectors above, this derives from the durable signup-era
 * default ({@link navSimplifiedDefaultAtom}) — set once at signup, not the live session — so
 * existing users keep the full nav. Stable seam: Phase 2 layers a user override here
 * (`override ?? default`) without touching consumers.
 */
export const advancedNavHiddenAtom = atom((get) => get(navSimplifiedDefaultAtom))
