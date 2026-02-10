/**
 * Revision Label Utilities
 *
 * Provides unified formatting utilities for displaying revision/version labels
 * across all entity types that support versioning (testsets, app revisions,
 * evaluator revisions, etc.)
 *
 * These are pure utility functions that work with any entity containing
 * version/revision fields, making them reusable across the entire codebase.
 *
 * @example
 * ```typescript
 * import {
 *     getRevisionLabel,
 *     getVersionLabel,
 *     getFullRevisionLabel,
 *     isLocalDraftId,
 *     formatLocalDraftLabel,
 * } from '@agenta/entities/shared'
 *
 * // Simple version display
 * getVersionLabel(3)  // "v3"
 *
 * // Full revision display
 * getRevisionLabel({ version: 3, message: 'Initial commit' }, { showMessage: true })
 * // "v3 - Initial commit"
 *
 * // Handle local drafts
 * if (isLocalDraftId(id)) {
 *     return formatLocalDraftLabel(sourceRevision)  // "Draft (based on v3)"
 * }
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Minimal interface for entities with version information.
 * Any entity with these optional fields can use the revision label utilities.
 */
export interface VersionedEntity {
    /** Version/revision number (0 = draft, 1+ = committed) */
    version?: number | null
    /** Revision number (alias for version in some entities) */
    revision?: number | null
    /** Commit message describing changes */
    message?: string | null
    /** Author who created this version */
    author?: string | null
    /** Variant or entity name */
    variantName?: string | null
    /** Alternative name field */
    name?: string | null
    /** Internal: source revision for local drafts (set by cloneAsLocalDraft) */
    _sourceRevision?: number | null
}

/**
 * Options for formatting revision labels
 */
export interface RevisionLabelOptions {
    /** Show version number (e.g., "v1"). Default: true */
    showVersion?: boolean
    /** Show commit message. Default: false */
    showMessage?: boolean
    /** Show author name. Default: false */
    showAuthor?: boolean
    /** Separator between parts. Default: " - " */
    separator?: string
    /** Prefix for version (e.g., "v" for "v1"). Default: "v" */
    versionPrefix?: string
}

/**
 * Comprehensive revision label information.
 * Returned by getRevisionLabelInfo for components that need full context.
 */
export interface RevisionLabelInfo {
    /** The version/revision number (null if not available) */
    version: number | null
    /** The entity/variant name (null if not found) */
    name: string | null
    /** Whether this is a local draft (not committed to server) */
    isLocalDraft: boolean
    /** Source version for local drafts (e.g., copied from v3) */
    sourceVersion: number | null
    /** Formatted label for display (e.g., "v3", "Draft (based on v3)", "Draft") */
    label: string
    /** Commit message if available */
    message: string | null
    /** Author if available */
    author: string | null
}

// ============================================================================
// LOCAL DRAFT DETECTION
// ============================================================================

/**
 * Common prefixes for local/draft entity IDs.
 * Used to identify entities that haven't been committed to the server.
 */
const LOCAL_DRAFT_PREFIXES = ["local-", "new-", "draft-"]

/**
 * Check if an ID represents a local draft entity.
 *
 * Local drafts are entities that exist only in browser memory and haven't
 * been committed to the server. They typically use prefixed IDs like
 * "local-abc123-timestamp" or "new-xyz".
 *
 * Also recognizes numeric-only IDs (timestamps) as local drafts since
 * server IDs are always UUIDs which contain hyphens.
 *
 * @param id - Entity ID to check
 * @returns true if the ID represents a local draft
 *
 * @example
 * ```typescript
 * isLocalDraftId("local-abc-123456")  // true
 * isLocalDraftId("new-testset")       // true
 * isLocalDraftId("1706300000000")     // true (timestamp-only ID)
 * isLocalDraftId("abc-def-ghi")       // false (server ID)
 * ```
 */
export function isLocalDraftId(id: string | null | undefined): boolean {
    if (!id) return false

    // Check for known prefixes
    if (LOCAL_DRAFT_PREFIXES.some((prefix) => id.startsWith(prefix))) {
        return true
    }

    // Also recognize numeric-only IDs as local drafts
    // Server IDs are UUIDs which always contain hyphens
    // Numeric-only IDs are typically timestamps from legacy local draft creation
    if (/^\d+$/.test(id)) {
        return true
    }

    return false
}

/**
 * Check if an ID is a placeholder ID used during pending hydrations.
 *
 * Placeholder IDs are temporary IDs used when restoring comparison mode state
 * from a URL before the actual local drafts can be created. They have the format
 * `__pending_hydration__dk-{uuid}`.
 *
 * @param id - Entity ID to check
 * @returns true if the ID is a placeholder
 *
 * @example
 * ```typescript
 * isPlaceholderId("__pending_hydration__dk-abc123")  // true
 * isPlaceholderId("local-abc-123")                    // false
 * isPlaceholderId("abc-def-ghi")                      // false
 * ```
 */
export function isPlaceholderId(id: string | null | undefined): boolean {
    if (!id) return false
    return id.startsWith("__pending_hydration__")
}

/**
 * Extract the source entity ID from a local draft ID.
 *
 * For local drafts with format "local-{sourceId}-{timestamp}",
 * this extracts the original source entity ID.
 *
 * @param localDraftId - The local draft ID
 * @returns Source entity ID, or null if not a valid local draft ID
 *
 * @example
 * ```typescript
 * extractSourceIdFromDraft("local-abc123-1706300000")  // "abc123"
 * extractSourceIdFromDraft("abc123")                    // null
 * ```
 */
export function extractSourceIdFromDraft(localDraftId: string): string | null {
    if (!isLocalDraftId(localDraftId)) return null

    // Handle "local-{sourceId}-{timestamp}" format
    if (localDraftId.startsWith("local-")) {
        const parts = localDraftId.split("-")
        if (parts.length >= 3) {
            // Remove 'local' prefix and timestamp suffix, rejoin middle parts
            return parts.slice(1, -1).join("-")
        }
    }

    return null
}

// ============================================================================
// VERSION FORMATTING
// ============================================================================

/**
 * Get a simple version label (e.g., "v3").
 *
 * @param version - Version number (can be null/undefined)
 * @param prefix - Prefix before the number. Default: "v"
 * @returns Formatted version string
 *
 * @example
 * ```typescript
 * getVersionLabel(3)        // "v3"
 * getVersionLabel(0)        // "v0"
 * getVersionLabel(null)     // "v0"
 * getVersionLabel(1, "r")   // "r1"
 * ```
 */
export function getVersionLabel(version: number | null | undefined, prefix = "v"): string {
    return `${prefix}${version ?? 0}`
}

/**
 * Format a local draft label with optional source version reference.
 *
 * @param sourceVersion - The version this draft was based on (if any)
 * @returns Formatted draft label
 *
 * @example
 * ```typescript
 * formatLocalDraftLabel(3)     // "Draft (based on v3)"
 * formatLocalDraftLabel(null)  // "Draft"
 * formatLocalDraftLabel(0)     // "Draft (based on v0)"
 * ```
 */
export function formatLocalDraftLabel(sourceVersion: number | null | undefined): string {
    if (sourceVersion != null) {
        return `Draft (based on v${sourceVersion})`
    }
    return "Draft"
}

// ============================================================================
// REVISION LABEL FORMATTING
// ============================================================================

/**
 * Format a revision/version entity for display.
 *
 * This is the main formatting function that handles various display options.
 * Works with any entity that has version, message, or author fields.
 *
 * @param entity - Entity with version/revision fields
 * @param options - Formatting options
 * @returns Formatted display string
 *
 * @example
 * ```typescript
 * // Simple version
 * getRevisionLabel({ version: 3 })
 * // "v3"
 *
 * // With commit message
 * getRevisionLabel({ version: 3, message: "Add feature" }, { showMessage: true })
 * // "v3 - Add feature"
 *
 * // With author
 * getRevisionLabel({ version: 3, author: "John" }, { showAuthor: true })
 * // "v3 - by John"
 *
 * // Full display
 * getRevisionLabel(
 *     { version: 3, message: "Add feature", author: "John" },
 *     { showMessage: true, showAuthor: true }
 * )
 * // "v3 - Add feature - by John"
 * ```
 */
export function getRevisionLabel(
    entity: VersionedEntity | null | undefined,
    options: RevisionLabelOptions = {},
): string {
    if (!entity) return "Unknown"

    const {
        showVersion = true,
        showMessage = false,
        showAuthor = false,
        separator = " - ",
        versionPrefix = "v",
    } = options

    const parts: string[] = []

    // Get version (support both 'version' and 'revision' field names)
    const version = entity.version ?? entity.revision

    if (showVersion && version != null) {
        parts.push(`${versionPrefix}${version}`)
    }

    if (showMessage && entity.message) {
        parts.push(entity.message)
    }

    if (showAuthor && entity.author) {
        parts.push(`by ${entity.author}`)
    }

    return parts.length > 0 ? parts.join(separator) : "Unknown"
}

/**
 * Get full revision label with message (convenience function).
 *
 * @param entity - Entity with version and message fields
 * @returns Formatted string like "v3 - Initial commit" or just "v3"
 */
export function getFullRevisionLabel(entity: VersionedEntity | null | undefined): string {
    return getRevisionLabel(entity, {showVersion: true, showMessage: true})
}

// ============================================================================
// COMPREHENSIVE LABEL INFO
// ============================================================================

/**
 * Get comprehensive revision label information.
 *
 * This function returns a structured object with all revision-related info,
 * useful for components that need to render different parts of the label
 * or handle local drafts specially.
 *
 * @param entity - Entity with version/revision fields
 * @param id - Optional entity ID (to detect local drafts)
 * @param sourceVersion - Optional source version for local drafts
 * @returns Comprehensive label information
 *
 * @example
 * ```typescript
 * // Regular revision
 * const info = getRevisionLabelInfo(
 *     { version: 3, variantName: "MyVariant", message: "Fix bug" },
 *     "rev-123"
 * )
 * // {
 * //   version: 3,
 * //   name: "MyVariant",
 * //   isLocalDraft: false,
 * //   sourceVersion: null,
 * //   label: "v3",
 * //   message: "Fix bug",
 * //   author: null
 * // }
 *
 * // Local draft
 * const draftInfo = getRevisionLabelInfo(
 *     { variantName: "MyVariant" },
 *     "local-abc-123",
 *     3  // source version
 * )
 * // {
 * //   version: null,
 * //   name: "MyVariant",
 * //   isLocalDraft: true,
 * //   sourceVersion: 3,
 * //   label: "Draft (based on v3)",
 * //   message: null,
 * //   author: null
 * // }
 * ```
 */
export function getRevisionLabelInfo(
    entity: VersionedEntity | null | undefined,
    id?: string | null,
    sourceVersion?: number | null,
): RevisionLabelInfo {
    const isLocal = id ? isLocalDraftId(id) : false
    const version = entity?.version ?? entity?.revision ?? null
    const name = entity?.variantName ?? entity?.name ?? null

    // For local drafts, use the provided sourceVersion or try to get from entity
    const resolvedSourceVersion = isLocal
        ? (sourceVersion ?? entity?._sourceRevision ?? null)
        : null

    // Determine label
    let label: string
    if (isLocal) {
        label = formatLocalDraftLabel(resolvedSourceVersion)
    } else if (version != null) {
        label = getVersionLabel(version)
    } else {
        label = "Unknown"
    }

    return {
        version: isLocal ? null : version,
        name,
        isLocalDraft: isLocal,
        sourceVersion: resolvedSourceVersion,
        label,
        message: entity?.message ?? null,
        author: entity?.author ?? null,
    }
}
