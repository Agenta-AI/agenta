/** Short words that read as acronyms in a skill title. */
const SKILL_ACRONYMS = new Set([
    "AI",
    "API",
    "CLI",
    "CSV",
    "HR",
    "HTTP",
    "ID",
    "IT",
    "JSON",
    "LLM",
    "MCP",
    "PDF",
    "PR",
    "QA",
    "SDK",
    "SQL",
    "UI",
    "URL",
])

/**
 * A skill's title from its SKILL.md name: `laptop-replacement-policy` → "Laptop Replacement Policy",
 * `pr-review` → "PR Review". A name with a space is already prose and is kept as written.
 */
export function skillDisplayName(name: string): string {
    const trimmed = name.trim()
    if (!trimmed || /\s/.test(trimmed)) return trimmed
    const words = trimmed.split(/[-_]+/).filter(Boolean)
    if (words.length === 0) return trimmed
    return words
        .map((word) => {
            const upper = word.toUpperCase()
            if (SKILL_ACRONYMS.has(upper)) return upper
            // A word that already carries capitals ("iOS", "GitHub") keeps them.
            if (word !== word.toLowerCase()) return word
            return word.charAt(0).toUpperCase() + word.slice(1)
        })
        .join(" ")
}
