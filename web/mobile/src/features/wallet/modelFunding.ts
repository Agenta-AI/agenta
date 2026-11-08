/** What pays for this agent's model calls, and whether a cheaper route is one switch away. */
export type ModelFunding = "credits-with-own-key" | "credits-no-own-key" | "own-key"

interface FundingConnection {
    mode?: string | null
    slug?: string | null
    namespace?: string | null
}

interface FundingCandidate {
    slug: string | null
    namespace?: string | null
}

export const modelFunding = (
    connection: FundingConnection | null | undefined,
    candidates: readonly FundingCandidate[],
): ModelFunding => {
    const builtinSlugs = new Set(
        candidates.filter((c) => c.namespace === "builtin").map((c) => c.slug),
    )
    // Older saves carry no namespace; the gateway then resolves a built-in slug, or no slug, to credits.
    const creditFunded =
        connection?.namespace === "builtin" ||
        (!connection?.namespace &&
            (connection?.mode ?? "agenta") === "agenta" &&
            (!connection?.slug || builtinSlugs.has(connection.slug)))
    if (!creditFunded) return "own-key"
    return candidates.some((c) => c.namespace !== "builtin")
        ? "credits-with-own-key"
        : "credits-no-own-key"
}
