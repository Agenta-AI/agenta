import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {atom} from "jotai"

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

/**
 * Pre-commit onboarding in a project that has NO agents yet — the genuine first run, and the only
 * state where the agent-dependent pages are actually dead ends. The list is read only while
 * onboarding is active (jotai tracks dependencies lazily), and it's the same query the sidebar's
 * agents group already mounts. An unresolved list counts as first-run so nothing flashes enabled
 * then disabled.
 */
export const isFirstRunOnboardingAtom = atom((get) => {
    if (!get(isOnboardingActiveAtom)) return false
    const {data, isPending} = get(agentWorkflowsListQueryStateAtom)
    return isPending || data.length === 0
})

// ── App-behavior adjustments driven by onboarding ────────────────────────────
// Consumers (sidebar, layout, nav guards) read these NAMED selectors — never the raw session
// atom or an ad-hoc pathname check — so onboarding-driven UI tweaks stay in this one module.

/** During onboarding, Home IS the current surface → the sidebar shows it selected. */
export const homeNavHighlightedAtom = atom((get) => get(isOnboardingActiveAtom))

/** On a first run, clicking Home only bounces back here → make it a no-op. Once an agent exists
 * Home is a real destination (the agents list), so it stays clickable. */
export const homeNavInertAtom = atom((get) => get(isFirstRunOnboardingAtom))

/**
 * On a first run, nav links whose pages dead-end on an empty table (no apps/eval data yet) are
 * disabled. Links that work app-less (Observability, Test sets, Evaluators, Prompts) stay live.
 */
export const deadEndNavDisabledAtom = atom((get) => get(isFirstRunOnboardingAtom))

// `advancedNavHiddenAtom` — the simplified-nav gate, and now also the gate that decides which
// APP the user gets — lives in `@agenta/shared/state`, which `/m` can read too. Import it from
// there; the selectors above stay session-scoped and app-local.
