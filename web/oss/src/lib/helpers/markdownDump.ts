/** Building blocks for agent-pasteable markdown dumps (inspector download buttons). */

export const mdJson = (value: unknown): string => {
    if (value == null) return "null"
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

/** Fence with more backticks than any run inside the content, so inner fences survive. */
export const mdFence = (content: string, lang = ""): string => {
    const longestRun = content.match(/`+/g)?.reduce((n, run) => Math.max(n, run.length), 0) ?? 0
    const ticks = "`".repeat(Math.max(3, longestRun + 1))
    return `${ticks}${lang}\n${content}\n${ticks}`
}

export const mdHeader = (title: string, sessionId: string): string =>
    `# ${title}\n\n- session: \`${sessionId}\`\n- dumped_at: ${new Date().toISOString()}\n`
