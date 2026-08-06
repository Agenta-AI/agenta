/**
 * Snapshot Diff Utilities
 *
 * Provides shallow-diff and shallow-merge helpers for snapshot draft patches.
 * Used by all snapshot adapters to minimize patch payload size by storing
 * only changed top-level parameter keys instead of the full parameters object.
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for computing a shallow diff.
 */
export interface ShallowDiffOptions {
    /**
     * Optional function to preprocess values before comparison.
     * The ORIGINAL (unprocessed) value is included in the diff result.
     *
     * Use case: LegacyAppRevision strips volatile keys (__id, __metadata)
     * before comparing, but the diff should contain the original values.
     */
    preprocess?: (value: unknown) => unknown
}

// ============================================================================
// DIFF
// ============================================================================

/**
 * Compute a shallow diff between draft and server parameter objects.
 *
 * Compares each top-level key's JSON.stringify'd value (after optional preprocessing).
 * Returns only keys where draft differs from server, or null if no changes.
 *
 * @param draft - The current draft parameters
 * @param server - The server (committed) parameters
 * @param options - Optional preprocessing for comparison
 * @returns Object with only changed keys (original values), or null if no changes
 *
 * @example
 * ```typescript
 * const server = { temperature: 0.7, model: "gpt-4", response_format: { type: "json_schema", ... } }
 * const draft  = { temperature: 0.9, model: "gpt-4", response_format: { type: "json_schema", ... } }
 *
 * computeShallowDiff(draft, server)
 * // => { temperature: 0.9 }  -- only the changed key
 * ```
 */
export function computeShallowDiff(
    draft: Record<string, unknown>,
    server: Record<string, unknown>,
    options?: ShallowDiffOptions,
): Record<string, unknown> | null {
    const preprocess = options?.preprocess
    const result: Record<string, unknown> = {}
    let hasChanges = false

    for (const key of Object.keys(draft)) {
        const draftVal = preprocess ? preprocess(draft[key]) : draft[key]
        const serverVal = preprocess ? preprocess(server[key]) : server[key]

        if (JSON.stringify(draftVal) !== JSON.stringify(serverVal)) {
            // Store ORIGINAL value (not preprocessed) in the diff
            result[key] = draft[key]
            hasChanges = true
        }
    }

    return hasChanges ? result : null
}

// ============================================================================
// PATCH APPLICATION
// ============================================================================

/**
 * Apply a shallow patch onto server parameters.
 *
 * Performs a simple shallow merge: `{...serverParams, ...patchParams}`.
 * Backward compatible — works correctly with both:
 * - Full-params patches (all keys present) => equivalent to full replacement
 * - Diff patches (only changed keys) => only those keys are overridden
 *
 * @param server - The server (committed) parameters
 * @param patch - The patch (diff or full) to apply
 * @returns Merged parameters
 */
export function applyShallowPatch(
    server: Record<string, unknown>,
    patch: Record<string, unknown>,
): Record<string, unknown> {
    return {...server, ...patch}
}
