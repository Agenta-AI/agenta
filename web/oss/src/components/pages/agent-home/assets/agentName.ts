/** Longest name we'll derive. Past this a roster row truncates and stops being scannable. */
const MAX_LENGTH = 48

/** Openers people type before the actual task; they say nothing about what the agent does. */
const LEADING_FILLER =
    /^(?:please\s+|can you\s+|could you\s+|i(?:'d like| would like| want| need)\s+(?:an?\s+agent\s+(?:that|to|which)\s+|to\s+)?|build\s+(?:me\s+)?an?\s+agent\s+(?:that|to|which)\s+|create\s+(?:me\s+)?an?\s+agent\s+(?:that|to|which)\s+|make\s+(?:me\s+)?an?\s+agent\s+(?:that|to|which)\s+|an?\s+agent\s+(?:that|to|which)\s+)/i

/**
 * A display name for an agent, derived from the task that created it.
 *
 * Every free-text create used to land on the literal default "New agent", so a roster of five
 * agents read as five copies of the same thing and the session list's agent column carried no
 * information at all. Returns `null` when there is nothing to work with, so the caller keeps
 * whatever fallback it already had.
 */
export function agentNameFromTask(task: string | undefined | null): string | null {
    if (!task) return null

    // First line only: people paste a title followed by a spec, and the title is the name.
    const firstLine = task.split("\n")[0] ?? ""
    const cleaned = firstLine
        .replace(/^[#>\-*\s]+/, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(LEADING_FILLER, "")
        .replace(/[.,!?;:]+$/, "")
        .trim()

    if (!cleaned) return null

    const truncated =
        cleaned.length <= MAX_LENGTH
            ? cleaned
            : // Cut on a word boundary; a name sliced mid-word looks like a bug, not a summary.
              cleaned.slice(0, cleaned.lastIndexOf(" ", MAX_LENGTH) + 1 || MAX_LENGTH).trim()

    return truncated ? truncated[0].toUpperCase() + truncated.slice(1) : null
}
