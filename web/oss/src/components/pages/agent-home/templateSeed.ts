/**
 * Whether a `?template=` seed must leave the composer alone. Only a catalog that resolved the key
 * LATE yields, and only to what the user started while it loaded: a draft, or typed text. A key
 * the catalog already had is an explicit pick, so it replaces any earlier template's setup.
 */
export const templateSeedYields = ({
    late,
    hasDraft,
    composerText,
}: {
    late: boolean
    hasDraft: boolean
    composerText: string
}): boolean => late && (hasDraft || composerText.trim() !== "")
