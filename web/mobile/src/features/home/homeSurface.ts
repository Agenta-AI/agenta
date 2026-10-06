/**
 * Whether Home can be drawn yet, or we are still waiting to know what is in the project.
 *
 * Home is the surface for EVERY project now, empty or not: with no agents it opens on the
 * templates tab with the composer ready to describe one, which is the same job the first-run hero
 * did with one fewer page to learn. Two rules from the desktop original still matter:
 *
 * - **An error is not evidence of emptiness.** A failed fetch must never be read as "no agents",
 *   so it falls through to Home, which is the retryable surface.
 * - **An empty list that is still resolving is not an empty project.** Opening on templates and
 *   then swapping to a roster is a flash on arrival, so hold instead.
 *
 * A cached non-empty list short-circuits the hold, so a returning user never waits behind a
 * skeleton for a question that is already answered.
 */
export type HomeSurface = "loading" | "home" | "onboarding"

export interface HomeSurfaceInput {
    /** Agents in the resolved project. */
    agentCount: number
    /** The list query has produced nothing yet. */
    isPending: boolean
    /** The list query failed. */
    isError: boolean
    /** The guided first-agent flow replaces an empty project's Home. */
    onboardingFlow: boolean
    /** A `?onboarding-variant=` preview opens the flow on any project. */
    onboardingPreview: boolean
}

export const resolveHomeSurface = ({
    agentCount,
    isPending,
    isError,
    onboardingFlow,
    onboardingPreview,
}: HomeSurfaceInput): HomeSurface => {
    if (onboardingFlow && onboardingPreview) return "onboarding"
    if (isError) return "home"
    if (agentCount > 0) return "home"
    if (isPending) return "loading"
    return onboardingFlow ? "onboarding" : "home"
}
