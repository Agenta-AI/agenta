/** The start of every message the system writes when it commits a Testset on its own. */
const SYSTEM_MESSAGE_PREFIXES = ["Updated testset:", "Patched testset", "Initial commit"]

/**
 * The commit message to show on a row, or null when there is nothing a person wrote.
 */
export const visibleCommitMessage = (message: string | null | undefined): string | null => {
    const trimmed = message?.trim()
    if (!trimmed) return null
    return SYSTEM_MESSAGE_PREFIXES.some((prefix) => trimmed.startsWith(prefix)) ? null : trimmed
}
