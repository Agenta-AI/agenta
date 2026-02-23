/**
 * Playground Snapshot Schema
 *
 * Defines the schema for playground URL snapshots that capture the current
 * selection state including draft changes.
 *
 * @example
 * ```typescript
 * import {
 *     type PlaygroundSnapshot,
 *     validateSnapshot,
 *     SNAPSHOT_VERSION,
 * } from '@agenta/playground/snapshot'
 *
 * const snapshot: PlaygroundSnapshot = {
 *     v: SNAPSHOT_VERSION,
 *     selection: [
 *         { kind: 'commit', id: 'rev-123', runnableType: 'legacyAppRevision' },
 *         { kind: 'draft', draftKey: 'dk-1', runnableType: 'legacyAppRevision' },
 *     ],
 *     drafts: [
 *         {
 *             draftKey: 'dk-1',
 *             sourceRevisionId: 'rev-456',
 *             runnableType: 'legacyAppRevision',
 *             patch: {
 *                 parameters: {...},
 *             },
 *         },
 *     ],
 * }
 * ```
 */

import type {RunnableDraftPatch, RunnableType} from "@agenta/entities/runnable"

// ============================================================================
// VERSION
// ============================================================================

/**
 * Current snapshot schema version.
 */
export const SNAPSHOT_VERSION = 2 as const

// ============================================================================
// SELECTION ITEM TYPES
// ============================================================================

/**
 * Optional metadata about how an entity is placed in the playground graph.
 * Used to restore downstream chain entities during URL hydration.
 */
export interface SnapshotEntityMetadata {
    /** Playground entity type (e.g., "legacyAppRevision", "evaluatorRevision") */
    entityType?: string
    /** Node depth in the playground graph (0 = root) */
    depth?: number
    /** Optional display label captured at snapshot creation time */
    label?: string
}

/**
 * Selection item for a committed revision (no local changes).
 */
export interface CommitSelectionItem extends SnapshotEntityMetadata {
    kind: "commit"
    /** Revision ID */
    id: string
    /** Runnable type (e.g., 'legacyAppRevision', 'evaluatorRevision') */
    runnableType: RunnableType
}

/**
 * Selection item for a draft revision (has local changes).
 * References a draft entry by draftKey.
 */
export interface DraftSelectionItem extends SnapshotEntityMetadata {
    kind: "draft"
    /** Key referencing a draft in the drafts array */
    draftKey: string
    /** Runnable type (e.g., 'legacyAppRevision', 'evaluatorRevision') */
    runnableType: RunnableType
}

/**
 * Union type for selection items.
 */
export type SelectionItem = CommitSelectionItem | DraftSelectionItem

// ============================================================================
// DRAFT ENTRY
// ============================================================================

/**
 * Draft entry containing the patch data for a draft revision.
 */
export interface SnapshotDraftEntry {
    /** Unique key for this draft (referenced by selection items) */
    draftKey: string
    /** The committed revision this draft is based on */
    sourceRevisionId: string
    /** Runnable type for this draft (determines which adapter applies the patch) */
    runnableType: RunnableType
    /** The patch containing draft changes (shape depends on runnableType) */
    patch: RunnableDraftPatch
}

// ============================================================================
// LOADABLE CONNECTION
// ============================================================================

/**
 * Loadable connection state captured in a URL snapshot.
 * Present when the playground is connected to an API-backed testset.
 */
export interface SnapshotLoadableConnection {
    /** Testset revision UUID (= loadableState.connectedSourceId) */
    revisionId: string
    /** Display name, e.g. "MyTestset v3" */
    sourceName: string | null
    /** Testset entity UUID (for connectedTestsetAtom) */
    testsetId: string | null
}

// ============================================================================
// SNAPSHOT SCHEMA
// ============================================================================

/**
 * Playground snapshot schema.
 *
 * This schema captures the complete state needed to restore a playground
 * configuration including:
 * - Which revisions are selected (with runnable type per item)
 * - Draft changes for any modified revisions (with runnable type per draft)
 * - Optional testset connection (v=2+)
 *
 * Supports mixed runnable types in a single snapshot (e.g., AppRevision + EvaluatorRevision).
 */
export interface PlaygroundSnapshot {
    /** Schema version */
    v: typeof SNAPSHOT_VERSION
    /** Array of selected items (commits or drafts) */
    selection: SelectionItem[]
    /** Array of draft entries with patch data */
    drafts: SnapshotDraftEntry[]
    /** Present when connected to an API-backed testset */
    loadable?: SnapshotLoadableConnection
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Result of snapshot validation.
 */
export interface ValidationResult<T> {
    ok: boolean
    value?: T
    error?: string
}

/**
 * Type guard for CommitSelectionItem.
 */
function isCommitSelectionItem(item: unknown): item is CommitSelectionItem {
    if (typeof item !== "object" || item === null) return false
    const i = item as CommitSelectionItem
    if (i.kind !== "commit" || typeof i.id !== "string") return false
    if (typeof i.runnableType !== "string") return false
    if (!hasValidEntityMetadata(i)) return false
    return true
}

/**
 * Type guard for DraftSelectionItem.
 */
function isDraftSelectionItem(item: unknown): item is DraftSelectionItem {
    if (typeof item !== "object" || item === null) return false
    const i = item as DraftSelectionItem
    if (i.kind !== "draft" || typeof i.draftKey !== "string") return false
    if (typeof i.runnableType !== "string") return false
    if (!hasValidEntityMetadata(i)) return false
    return true
}

function hasValidEntityMetadata(item: SnapshotEntityMetadata): boolean {
    if (item.entityType !== undefined && typeof item.entityType !== "string") {
        return false
    }

    if (item.label !== undefined && typeof item.label !== "string") {
        return false
    }

    if (item.depth !== undefined) {
        if (
            typeof item.depth !== "number" ||
            !Number.isFinite(item.depth) ||
            !Number.isInteger(item.depth) ||
            item.depth < 0
        ) {
            return false
        }
    }

    return true
}

/**
 * Type guard for SelectionItem.
 */
function isSelectionItem(item: unknown): item is SelectionItem {
    return isCommitSelectionItem(item) || isDraftSelectionItem(item)
}

/**
 * Type guard for SnapshotDraftEntry.
 */
function isSnapshotDraftEntry(entry: unknown): entry is SnapshotDraftEntry {
    if (typeof entry !== "object" || entry === null) return false

    const e = entry as SnapshotDraftEntry
    if (typeof e.draftKey !== "string") return false
    if (typeof e.sourceRevisionId !== "string") return false
    if (typeof e.patch !== "object" || e.patch === null) return false
    if (typeof e.runnableType !== "string") return false
    return true
}

/**
 * Type guard for SnapshotLoadableConnection.
 */
function isSnapshotLoadableConnection(value: unknown): value is SnapshotLoadableConnection {
    if (typeof value !== "object" || value === null) return false
    const v = value as Record<string, unknown>
    if (typeof v.revisionId !== "string") return false
    if (v.sourceName !== null && typeof v.sourceName !== "string") return false
    if (v.testsetId !== null && typeof v.testsetId !== "string") return false
    return true
}

/**
 * Validate the core selection and drafts fields (shared between v=1 and v=2).
 */
function validateSelectionAndDrafts(obj: Record<string, unknown>): string | null {
    if (!Array.isArray(obj.selection)) {
        return "Snapshot selection must be an array"
    }

    for (let i = 0; i < obj.selection.length; i++) {
        if (!isSelectionItem(obj.selection[i])) {
            return `Invalid selection item at index ${i}`
        }
    }

    if (!Array.isArray(obj.drafts)) {
        return "Snapshot drafts must be an array"
    }

    for (let i = 0; i < obj.drafts.length; i++) {
        if (!isSnapshotDraftEntry(obj.drafts[i])) {
            return `Invalid draft entry at index ${i}`
        }
    }

    const draftKeys = new Set(obj.drafts.map((d: {draftKey: string}) => d.draftKey))
    for (const item of obj.selection) {
        if (isDraftSelectionItem(item) && !draftKeys.has(item.draftKey)) {
            return `Draft key "${item.draftKey}" not found in drafts array`
        }
    }

    return null
}

/**
 * Validate a parsed snapshot object.
 *
 * Accepts both v=1 (legacy) and v=2 (current) snapshots.
 * v=1 snapshots are normalized to v=2 without a loadable field.
 *
 * @param data - The parsed data to validate
 * @returns ValidationResult with the validated snapshot or an error
 */
export function validateSnapshot(data: unknown): ValidationResult<PlaygroundSnapshot> {
    // Check basic structure
    if (typeof data !== "object" || data === null) {
        return {ok: false, error: "Snapshot must be an object"}
    }

    const obj = data as Record<string, unknown>

    // Handle v=1 snapshots (backwards compat) — normalize to v=2 without loadable
    if (obj.v === 1) {
        const fieldError = validateSelectionAndDrafts(obj)
        if (fieldError) return {ok: false, error: fieldError}

        return {
            ok: true,
            value: {
                v: SNAPSHOT_VERSION,
                selection: obj.selection as SelectionItem[],
                drafts: obj.drafts as SnapshotDraftEntry[],
                // No loadable field for v=1 snapshots
            },
        }
    }

    // Check version
    if (obj.v !== SNAPSHOT_VERSION) {
        return {
            ok: false,
            error: `Unsupported snapshot version: ${obj.v}. Expected version ${SNAPSHOT_VERSION}.`,
        }
    }

    // Validate selection and drafts
    const fieldError = validateSelectionAndDrafts(obj)
    if (fieldError) return {ok: false, error: fieldError}

    // Check optional loadable field (v=2+)
    if (obj.loadable !== undefined && !isSnapshotLoadableConnection(obj.loadable)) {
        return {ok: false, error: "Invalid loadable connection in snapshot"}
    }

    return {ok: true, value: obj as unknown as PlaygroundSnapshot}
}

/**
 * Create an empty snapshot.
 */
export function createEmptySnapshot(): PlaygroundSnapshot {
    return {
        v: SNAPSHOT_VERSION,
        selection: [],
        drafts: [],
    }
}
