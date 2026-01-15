/**
 * Revision Level Factory
 *
 * Shared factory for creating revision-level configurations for git-based entities.
 * Provides standard handling for version, created_at, message, and author fields.
 *
 * @example
 * ```typescript
 * import { createRevisionLevel } from './revisionLevelFactory'
 *
 * const revisionLevel = createRevisionLevel({
 *   type: 'appRevision',
 *   listAtomFamily: revisionsByVariantListAtom,
 *   // Optional overrides
 *   fieldMappings: {
 *     version: 'revision', // Use 'revision' field instead of 'version'
 *   },
 * })
 * ```
 */

import React from "react"

import {formatVersion, RevisionLabel} from "@agenta/ui"
import type {Atom} from "jotai"

import {UserAuthorLabel} from "../../../shared/user"
import type {SelectableEntityType, ListQueryState} from "../types"

import type {CreateHierarchyLevelOptions} from "./types"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Standard fields for git-based revision entities
 */
export interface RevisionEntity {
    id: string
    version?: number
    revision?: number
    created_at?: string
    createdAt?: string
    message?: string
    commitMessage?: string
    author?: string | null
    created_by_id?: string | null
}

/**
 * Field mappings for customizing which fields to use
 */
export interface RevisionFieldMappings {
    /** Field name for ID (default: 'id') */
    id?: string
    /** Field name for version number (default: 'version' or 'revision') */
    version?: string
    /** Field name for creation date (default: 'created_at' or 'createdAt') */
    createdAt?: string
    /** Field name for commit message (default: 'message' or 'commitMessage') */
    message?: string
    /** Field name for author (default: 'author' or 'created_by_id') */
    author?: string
}

/**
 * Options for creating a revision level
 */
export interface CreateRevisionLevelOptions {
    /** Entity type for this revision level */
    type: SelectableEntityType

    /** Atom family for fetching revisions by parent ID */
    listAtomFamily?: (parentId: string) => Atom<ListQueryState<unknown>>

    /** Static atom for fetching all revisions (if no parent dependency) */
    listAtom?: Atom<ListQueryState<unknown>>

    /** Callback to enable/prepare the query before loading */
    onBeforeLoad?: (parentId: string) => void

    /** Custom field mappings */
    fieldMappings?: RevisionFieldMappings

    /** Whether this level has children (default: false) */
    hasChildren?: boolean

    /** Whether this level is selectable (default: true) */
    isSelectable?: boolean

    /** Max width for message truncation in label (default: 180) */
    maxMessageWidth?: number

    /** Whether to show compact label (version only) */
    compact?: boolean

    /**
     * Custom author renderer function.
     * Use this to resolve user IDs to display names.
     * The function receives the raw author string (usually a user ID)
     * and should return a React node.
     *
     * If not provided, uses the shared UserAuthorLabel component which
     * resolves user IDs via the configured user atoms.
     *
     * @example
     * ```typescript
     * renderAuthor: (authorId) => React.createElement(CustomUserLabel, { userId: authorId })
     * ```
     */
    renderAuthor?: (author: string) => React.ReactNode

    /**
     * Whether to use the shared user resolution for author display.
     * When true (default), uses UserAuthorLabel to resolve user IDs.
     * Set to false to display raw author strings.
     * @default true
     */
    resolveAuthor?: boolean
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get a field value from an entity with fallback field names
 */
function getField<T>(entity: unknown, ...fieldNames: string[]): T | undefined {
    const obj = entity as Record<string, unknown>
    for (const name of fieldNames) {
        if (name in obj && obj[name] !== undefined) {
            return obj[name] as T
        }
    }
    return undefined
}

/**
 * Extract standard revision fields from an entity
 */
function extractRevisionFields(
    entity: unknown,
    mappings: RevisionFieldMappings = {},
): {
    id: string
    version: number
    createdAt: string | undefined
    message: string | undefined
    author: string | undefined
} {
    return {
        id: getField<string>(entity, mappings.id ?? "id") ?? "",
        version: getField<number>(entity, mappings.version ?? "version", "revision") ?? 0,
        createdAt: getField<string>(entity, mappings.createdAt ?? "created_at", "createdAt"),
        message: getField<string>(entity, mappings.message ?? "message", "commitMessage"),
        author: getField<string>(entity, mappings.author ?? "author", "created_by_id"),
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a revision-level configuration for git-based entities
 *
 * This factory provides standard handling for:
 * - Version number display with formatting
 * - Creation date formatting
 * - Commit message display with truncation
 * - Author display
 *
 * @example
 * ```typescript
 * // Basic usage
 * const revisionLevel = createRevisionLevel({
 *   type: 'appRevision',
 *   listAtomFamily: revisionsByVariantListAtom,
 * })
 *
 * // With custom field mappings
 * const revisionLevel = createRevisionLevel({
 *   type: 'revision',
 *   listAtomFamily: revisionsListAtom,
 *   fieldMappings: {
 *     version: 'revision', // Use 'revision' field
 *     createdAt: 'date',   // Use 'date' field
 *   },
 * })
 *
 * // With onBeforeLoad for lazy queries
 * const revisionLevel = createRevisionLevel({
 *   type: 'revision',
 *   listAtomFamily: revisionsListAtom,
 *   onBeforeLoad: (parentId) => enableQuery(parentId),
 * })
 * ```
 */
export function createRevisionLevel(
    options: CreateRevisionLevelOptions,
): CreateHierarchyLevelOptions<unknown> {
    const {
        type,
        listAtom,
        listAtomFamily,
        onBeforeLoad,
        fieldMappings = {},
        hasChildren = false,
        isSelectable = true,
        maxMessageWidth = 180,
        compact = false,
        renderAuthor,
        resolveAuthor = true,
    } = options

    // Default author renderer using shared user resolution
    const defaultRenderAuthor = resolveAuthor
        ? (authorId: string) => React.createElement(UserAuthorLabel, {userId: authorId})
        : undefined

    const effectiveRenderAuthor = renderAuthor ?? defaultRenderAuthor

    return {
        type,
        listAtom,
        listAtomFamily,
        onBeforeLoad,

        getId: (entity: unknown) => {
            const fields = extractRevisionFields(entity, fieldMappings)
            return fields.id
        },

        getLabel: (entity: unknown) => {
            const fields = extractRevisionFields(entity, fieldMappings)
            const versionStr = formatVersion(fields.version)
            if (fields.message) {
                return `${versionStr} - ${fields.message}`
            }
            return versionStr
        },

        getLabelNode: (entity: unknown) => {
            const fields = extractRevisionFields(entity, fieldMappings)

            if (compact) {
                return React.createElement(RevisionLabel, {
                    version: fields.version,
                    compact: true,
                })
            }

            return React.createElement(RevisionLabel, {
                version: fields.version,
                message: fields.message,
                createdAt: fields.createdAt,
                author: fields.author,
                renderAuthor: effectiveRenderAuthor,
                maxMessageWidth,
            })
        },

        hasChildren: () => hasChildren,
        isSelectable: () => isSelectable,
    }
}

// ============================================================================
// PRESETS
// ============================================================================

/**
 * Preset for testset revisions
 */
export function createTestsetRevisionLevel(
    listAtomFamily: (testsetId: string) => Atom<ListQueryState<unknown>>,
    onBeforeLoad?: (testsetId: string) => void,
): CreateHierarchyLevelOptions<unknown> {
    return createRevisionLevel({
        type: "revision",
        listAtomFamily,
        onBeforeLoad,
    })
}

/**
 * Preset for app revisions
 */
export function createAppRevisionLevel(
    listAtomFamily: (variantId: string) => Atom<ListQueryState<unknown>>,
): CreateHierarchyLevelOptions<unknown> {
    return createRevisionLevel({
        type: "appRevision",
        listAtomFamily,
        fieldMappings: {
            version: "revision", // App revisions use 'revision' field
        },
    })
}

/**
 * Preset for evaluator revisions
 */
export function createEvaluatorRevisionLevel(
    listAtomFamily: (variantId: string) => Atom<ListQueryState<unknown>>,
): CreateHierarchyLevelOptions<unknown> {
    return createRevisionLevel({
        type: "evaluatorRevision",
        listAtomFamily,
        fieldMappings: {
            version: "revision", // Evaluator revisions use 'revision' field
        },
    })
}
