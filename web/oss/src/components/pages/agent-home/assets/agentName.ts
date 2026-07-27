/** Words / characters kept when naming an agent after the message that created it. */
const NAME_WORD_LIMIT = 3
const NAME_CHAR_LIMIT = 32

/** Trimmed off the end so a truncated name doesn't dangle ("Route support tickets to the"). */
const TRAILING_FILLER = new Set([
    "a",
    "an",
    "and",
    "at",
    "based",
    "by",
    "for",
    "from",
    "in",
    "into",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "with",
])

/** Markdown the composer may emit — stripped so the name reads as plain prose. */
const stripMarkdown = (message: string) =>
    message
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6}|>)\s+/gm, " ")
        .replace(/[*_~]/g, "")
        .replace(/\s+/g, " ")
        .trim()

/**
 * Name an agent after the message that created it. The composer paths pass no name, so every
 * agent used to be "New agent" — and since the slug is minted from the name and is immutable,
 * every slug became `new-agent-<suffix>` (#5397). Returns "" when there's nothing usable to
 * name from; callers fall back to the generic default.
 */
export function deriveAgentNameFromMessage(message?: string): string {
    const cleaned = stripMarkdown(message?.trim() || "")
    if (!cleaned) return ""

    let name = cleaned.split(" ").slice(0, NAME_WORD_LIMIT).join(" ")
    if (name.length > NAME_CHAR_LIMIT) {
        const cut = name.slice(0, NAME_CHAR_LIMIT)
        const lastSpace = cut.lastIndexOf(" ")
        name = lastSpace > 0 ? cut.slice(0, lastSpace) : cut
    }

    const words = name.split(" ")
    while (words.length > 1 && TRAILING_FILLER.has(words[words.length - 1].toLowerCase())) {
        words.pop()
    }
    name = words.join(" ").replace(/[\s.,;:!?/\\|—–-]+$/, "")
    // An all-emoji / all-punctuation message would slug to nothing — keep the generic default.
    if (!/[a-z0-9]/i.test(name)) return ""

    return name.charAt(0).toUpperCase() + name.slice(1)
}
