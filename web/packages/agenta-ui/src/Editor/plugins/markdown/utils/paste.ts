const BLOCK_MARKDOWN_PATTERN = /^(?: {0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|~~~)|\|.+\|\s*$)/m
const INLINE_MARKDOWN_PATTERN =
    /(?:\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\([^\n)]+\))/

export function looksLikeMarkdown(value: string): boolean {
    return BLOCK_MARKDOWN_PATTERN.test(value) || INLINE_MARKDOWN_PATTERN.test(value)
}
