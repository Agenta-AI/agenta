/** The start of every message the system writes when it commits a Testset on its own. */
const SYSTEM_MESSAGE_PREFIXES = ["Updated testset:", "Patched testset", "Initial commit"]

/**
 * The commit message to show on a row, or null when there is nothing a person wrote.
 * The old app computed this check and never used it, so system text showed on testset rows.
 */
export const visibleCommitMessage = (message: string | null | undefined): string | null => {
    const trimmed = message?.trim()
    if (!trimmed) return null
    return SYSTEM_MESSAGE_PREFIXES.some((prefix) => trimmed.startsWith(prefix)) ? null : trimmed
}
