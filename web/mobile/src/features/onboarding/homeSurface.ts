/**
 * Which of the three home surfaces a project gets: the first-run hero, the normal Home, or a
 * hold while we still do not know.
 *
 * Mirrors desktop's `useAgentsFirstRun` (`web/oss/src/components/pages/agents/store.ts:75`) with
 * the signals this app's list atom actually carries. Two of its rules matter and are kept:
 *
 * - **An error is not evidence of emptiness.** A failed fetch must never send someone who already
 *   has agents into onboarding, so it falls through to Home, which is the retryable surface.
 * - **An empty list that is still resolving is not a first run.** Painting Home and then swapping
 *   it for the hero is a flash on the surface a new user sees first, so hold instead.
 *
 * Desktop needed a `useQuery` observer here because jotai replays an unmounted atom's last value
 * and its decision was a REDIRECT, which cannot be taken back. This one renders in place, so a
 * stale replay corrects itself on the render after the real data lands.
 *
 * A cached non-empty list short-circuits the hold, so a returning user never waits behind a
 * skeleton for a question that is already answered.
 */
export type HomeSurface = "loading" | "first-run" | "home"

export interface HomeSurfaceInput {
    /** Agents in the resolved project. */
    agentCount: number
    /** The list query has produced nothing yet. */
    isPending: boolean
    /** The list query failed. */
    isError: boolean
}

export const resolveHomeSurface = ({
    agentCount,
    isPending,
    isError,
}: HomeSurfaceInput): HomeSurface => {
    if (isError) return "home"
    if (agentCount > 0) return "home"
    if (isPending) return "loading"
    return "first-run"
}
