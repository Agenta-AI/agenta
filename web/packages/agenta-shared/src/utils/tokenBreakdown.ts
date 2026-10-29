/** A token count split into parts that add up to its total. */
export interface TokenBreakdown {
    input: number
    cacheRead: number
    cacheWrite: number
    output: number
    total: number
}

export interface TokenCounts {
    prompt?: number | null
    completion?: number | null
    cacheRead?: number | null
    cacheWrite?: number | null
    total?: number | null
    /** `false` when the producer says `prompt` excludes the cached tokens. */
    inputIncludesCache?: boolean | string | null
}

const count = (value: number | null | undefined) =>
    typeof value === "number" && value > 0 ? value : 0

/**
 * Split token counts into input, cache read, cache write and output, or null when nothing was
 * read from or written to a cache, or when the prompt or completion count is missing.
 *
 * OpenTelemetry GenAI counts cached tokens inside the prompt count; the Agenta runner does not,
 * and marks its spans `input_tokens_includes_cache = false`. An inclusive prompt count has the
 * cached tokens taken out, so the four parts add up to the total either way. A count that is
 * smaller than its cached tokens, or that adds up to the total with them, cannot include them.
 */
export const splitTokenUsage = ({
    prompt,
    completion,
    cacheRead,
    cacheWrite,
    total,
    inputIncludesCache,
}: TokenCounts): TokenBreakdown | null => {
    const read = count(cacheRead)
    const write = count(cacheWrite)
    if (!read && !write) return null
    if (typeof prompt !== "number" || typeof completion !== "number") return null

    const cache = read + write
    const promptCount = count(prompt)
    const output = count(completion)
    const excludesCache =
        inputIncludesCache === false ||
        inputIncludesCache === "false" ||
        promptCount < cache ||
        (typeof total === "number" && promptCount + cache + output === total)
    const input = excludesCache ? promptCount : promptCount - cache

    return {
        input,
        cacheRead: read,
        cacheWrite: write,
        output,
        total: typeof total === "number" ? total : input + cache + output,
    }
}
