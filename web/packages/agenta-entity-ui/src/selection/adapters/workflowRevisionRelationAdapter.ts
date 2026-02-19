/**
 * Workflow Revision Selection Adapter (Relation-Based)
 *
 * Adapter for selecting workflow revisions through the hierarchy:
 * - 3-level: Workflow → Variant → Revision (default)
 * - 2-level: Variant → Revision (when workflowId/workflowIdAtom is provided)
 *
 * Uses EntityRelation definitions from @agenta/entities/workflow.
 * Configurable via `WorkflowQueryFlags` to filter by model type:
 * - Apps: `{}` or `{ is_evaluator: false }` (no flags = all workflows)
 * - Evaluators: `{ is_evaluator: true }`
 * - Chat workflows: `{ is_chat: true }`
 *
 * @example
 * ```typescript
 * // 3-level mode (default — all workflows)
 * import { workflowRevisionAdapter } from '@agenta/entity-ui/selection'
 * <EntityPicker adapter={workflowRevisionAdapter} onSelect={handleSelect} />
 *
 * // 2-level mode (scoped to current workflow)
 * import { createWorkflowRevisionAdapter } from '@agenta/entity-ui/selection'
 * const adapter = createWorkflowRevisionAdapter({
 *   workflowIdAtom: selectedAppIdAtom,
 *   excludeRevisionZero: true,
 * })
 *
 * // Evaluator-specific adapter
 * const evaluatorAdapter = createWorkflowRevisionAdapter({
 *   workflowIdAtom: selectedEvaluatorIdAtom,
 *   flags: { is_evaluator: true },
 * })
 * ```
 */

import React from "react"

import type {EntityRelation} from "@agenta/entities/shared"
import {
    workflowsListQueryStateAtom,
    workflowToVariantRelation,
    workflowVariantToRevisionRelation,
    workflowVariantsListQueryStateAtomFamily,
    workflowRevisionsListQueryStateAtomFamily,
    type WorkflowQueryFlags,
} from "@agenta/entities/workflow"
import {RevisionLabel, VariantListItemLabel} from "@agenta/ui/components/presentational"
import {atom} from "jotai"
import type {Atom} from "jotai"

import type {
    EntitySelectionAdapter,
    EntitySelectionResult,
    ListQueryState,
    SelectionPathItem,
} from "../types"

import {createThreeLevelAdapter, createTwoLevelAdapter} from "./createAdapterFromRelations"

// ============================================================================
// TYPES
// ============================================================================

export interface WorkflowRevisionSelectionResult extends EntitySelectionResult {
    type: "workflowRevision"
    metadata: {
        workflowId: string
        workflowName: string
        variantId: string
        variantName: string
        revision: number
    }
}

// ============================================================================
// DEFAULT 3-LEVEL ADAPTER
// ============================================================================

/**
 * Workflow Revision selection adapter using relation-based factory.
 *
 * Hierarchy: Workflow → Variant → Revision
 *
 * Uses the workflow backend API via `/preview/workflows/` endpoints.
 * Fetches all workflows (no flag filter) by default.
 */
export const workflowRevisionAdapter = createThreeLevelAdapter<WorkflowRevisionSelectionResult>({
    name: "workflowRevision",
    grandparentType: "workflow",
    grandparentLabel: "Workflow",
    grandparentListAtom: workflowsListQueryStateAtom as Atom<ListQueryState<unknown>>,
    grandparentOverrides: {
        getId: (entity: unknown) => (entity as {id: string}).id,
        getLabel: (entity: unknown) => (entity as {name?: string}).name ?? "Unnamed",
        hasChildren: true,
        isSelectable: false,
    },
    parentType: "workflowVariant",
    parentLabel: "Variant",
    parentRelation: workflowToVariantRelation as EntityRelation<unknown, unknown>,
    parentOverrides: {
        autoSelectSingle: true,
        getId: (entity: unknown) => (entity as {id: string}).id ?? "",
        getLabel: (entity: unknown) => (entity as {name?: string}).name ?? "Unnamed",
        getLabelNode: (entity: unknown) => {
            const v = entity as {name?: string}
            return React.createElement(VariantListItemLabel, {
                name: v.name ?? "Unnamed",
                reserveSubtitleSpace: true,
            })
        },
        getPlaceholderNode: (text: string) =>
            React.createElement(VariantListItemLabel, {
                name: text,
                reserveSubtitleSpace: true,
            }),
        hasChildren: true,
        isSelectable: false,
    },
    childType: "workflowRevision",
    childLabel: "Revision",
    childRelation: workflowVariantToRevisionRelation as EntityRelation<unknown, unknown>,
    childOverrides: {
        autoSelectSingle: true,
        getLabelNode: (entity: unknown) => {
            const r = entity as {
                version?: number
                name?: string
                created_at?: string
                created_by_id?: string
            }
            return React.createElement(RevisionLabel, {
                version: r.version ?? 0,
                message: r.name,
                createdAt: r.created_at,
                author: r.created_by_id,
                maxMessageWidth: 180,
            })
        },
        getPlaceholderNode: (text: string) =>
            React.createElement(
                "div",
                {className: "flex flex-col gap-0.5"},
                React.createElement("span", {className: "text-zinc-400"}, text),
                React.createElement("span", {className: "invisible"}, "\u00A0"),
            ),
    },
    selectionType: "workflowRevision",
    toSelection: (
        path: SelectionPathItem[],
        leafEntity: unknown,
    ): WorkflowRevisionSelectionResult => {
        const revision = leafEntity as {id: string; version?: number}
        const workflow = path[0]
        const variant = path[1]
        const revisionItem = path[2]

        return {
            type: "workflowRevision",
            id: revision.id,
            label: `${workflow?.label ?? "Workflow"} / ${variant?.label ?? "Variant"} / ${revisionItem?.label ?? "Revision"}`,
            path,
            metadata: {
                workflowId: workflow?.id ?? "",
                workflowName: workflow?.label ?? "",
                variantId: variant?.id ?? "",
                variantName: variant?.label ?? "",
                revision: revision.version ?? 0,
            },
        }
    },
    emptyMessage: "No workflows found",
    loadingMessage: "Loading workflows...",
})

// ============================================================================
// CONFIGURABLE FACTORY
// ============================================================================

/**
 * Options for creating a configurable workflow revision adapter.
 */
export interface CreateWorkflowRevisionAdapterOptions {
    /**
     * Workflow ID to scope the adapter to (for 2-level mode).
     * When provided, uses the workflow variants/revisions atoms
     * scoped to this workflow.
     */
    workflowId?: string

    /**
     * Atom that provides the current workflow ID dynamically.
     * Use this when the workflow ID comes from app state (e.g., selectedAppIdAtom).
     * Takes precedence over static workflowId if both are provided.
     */
    workflowIdAtom?: Atom<string | null>

    /**
     * Whether to exclude revision 0 (initial/empty revisions) from the list.
     * @default false
     */
    excludeRevisionZero?: boolean

    /**
     * Custom variant level overrides.
     */
    variantOverrides?: {
        getId?: (entity: unknown) => string
        getLabel?: (entity: unknown) => string
        getLabelNode?: (entity: unknown) => React.ReactNode
        hasChildren?: boolean | ((entity: unknown) => boolean)
        isSelectable?: boolean | ((entity: unknown) => boolean)
    }

    /**
     * Custom revision level overrides.
     */
    revisionOverrides?: {
        getId?: (entity: unknown) => string
        getLabel?: (entity: unknown) => string
        getLabelNode?: (entity: unknown) => React.ReactNode
    }

    /**
     * Custom selection builder.
     */
    toSelection?: (
        path: SelectionPathItem[],
        leafEntity: unknown,
    ) => WorkflowRevisionSelectionResult

    /**
     * Empty state message.
     */
    emptyMessage?: string

    /**
     * Loading state message.
     */
    loadingMessage?: string

    /**
     * Workflow query flags for filtering the workflow list (3-level mode only).
     * When provided, the workflow list is client-side filtered to only include
     * workflows matching ALL specified flags.
     *
     * @example
     * ```typescript
     * // Only show evaluator workflows
     * flags: { is_evaluator: true }
     * ```
     */
    flags?: WorkflowQueryFlags
}

/**
 * Create a configurable workflow revision adapter.
 *
 * Supports two modes:
 * - **3-level mode** (default): Workflow → Variant → Revision
 * - **2-level mode**: Variant → Revision (when `workflowId` or `workflowIdAtom` is provided)
 *
 * @example
 * ```typescript
 * // 2-level mode for app playground
 * const adapter = createWorkflowRevisionAdapter({
 *   workflowIdAtom: selectedAppIdAtom,
 *   excludeRevisionZero: true,
 * })
 *
 * // 2-level mode for evaluator playground
 * const adapter = createWorkflowRevisionAdapter({
 *   workflowIdAtom: selectedEvaluatorIdAtom,
 * })
 * ```
 */
export function createWorkflowRevisionAdapter(
    options: CreateWorkflowRevisionAdapterOptions = {},
): EntitySelectionAdapter<WorkflowRevisionSelectionResult> {
    const {
        workflowId,
        workflowIdAtom,
        excludeRevisionZero = false,
        variantOverrides = {},
        revisionOverrides = {},
        toSelection,
        emptyMessage,
        loadingMessage,
        flags,
    } = options

    const emptyListState: ListQueryState<unknown> = {
        data: [],
        isPending: false,
        isError: false,
        error: null,
    }

    // Determine the variants list atom to use
    let resolvedVariantsListAtom: Atom<ListQueryState<unknown>> | undefined

    if (workflowIdAtom) {
        resolvedVariantsListAtom = atom((get) => {
            const resolvedWorkflowId = get(workflowIdAtom)
            if (!resolvedWorkflowId) {
                return emptyListState
            }
            return get(
                workflowVariantsListQueryStateAtomFamily(resolvedWorkflowId) as Atom<
                    ListQueryState<unknown>
                >,
            )
        })
    } else if (workflowId) {
        resolvedVariantsListAtom = workflowVariantsListQueryStateAtomFamily(workflowId) as Atom<
            ListQueryState<unknown>
        >
    }

    // Determine the revisions list atom family to use
    const resolvedRevisionsListAtomFamily = (variantId: string) =>
        workflowRevisionsListQueryStateAtomFamily(variantId) as Atom<ListQueryState<unknown>>

    // 2-level mode: Variant → Revision
    if (resolvedVariantsListAtom) {
        return createTwoLevelAdapter<WorkflowRevisionSelectionResult>({
            name: "workflowRevision",
            parentType: "workflowVariant",
            parentLabel: "Variant",
            parentListAtom: resolvedVariantsListAtom,
            parentOverrides: {
                getId: variantOverrides.getId ?? ((v: unknown) => (v as {id: string}).id ?? ""),
                getLabel:
                    variantOverrides.getLabel ??
                    ((v: unknown) => (v as {name?: string}).name ?? "Unnamed"),
                getLabelNode: variantOverrides.getLabelNode,
                hasChildren: variantOverrides.hasChildren ?? true,
                isSelectable: variantOverrides.isSelectable ?? false,
            },
            childType: "workflowRevision",
            childLabel: "Revision",
            childRelation: {
                ...workflowVariantToRevisionRelation,
                listAtomFamily: resolvedRevisionsListAtomFamily,
            } as EntityRelation<unknown, unknown>,
            childOverrides: {
                getId: revisionOverrides.getId ?? ((r: unknown) => (r as {id: string}).id ?? ""),
                getLabel:
                    revisionOverrides.getLabel ??
                    ((r: unknown) => {
                        const rev = r as {version?: number}
                        return `v${rev.version ?? 0}`
                    }),
                getLabelNode:
                    revisionOverrides.getLabelNode ??
                    ((r: unknown) => {
                        const rev = r as {
                            version?: number
                            name?: string
                            created_at?: string
                        }
                        return React.createElement(RevisionLabel, {
                            version: rev.version ?? 0,
                            message: rev.name,
                            createdAt: rev.created_at,
                            maxMessageWidth: 180,
                        })
                    }),
                filterItems: excludeRevisionZero
                    ? (r: unknown) => (r as {version?: number}).version !== 0
                    : undefined,
            },
            selectionType: "workflowRevision",
            toSelection:
                toSelection ??
                ((path, leafEntity) => {
                    const revision = leafEntity as {id: string; version?: number}
                    const variant = path[0]

                    return {
                        type: "workflowRevision",
                        id: revision.id,
                        label: `${variant?.label ?? "Variant"} / v${revision.version ?? 0}`,
                        path,
                        metadata: {
                            workflowId: workflowId ?? "",
                            workflowName: "",
                            variantId: variant?.id ?? "",
                            variantName: variant?.label ?? "",
                            revision: revision.version ?? 0,
                        },
                    }
                }),
            emptyMessage: emptyMessage ?? "No variants found",
            loadingMessage: loadingMessage ?? "Loading variants...",
        })
    }

    // 3-level mode: Workflow → Variant → Revision
    // When flags are provided, create a filtered adapter; otherwise use the default
    if (!flags) {
        return workflowRevisionAdapter
    }

    // Client-side filtered workflow list atom
    const filteredWorkflowsListAtom = atom<ListQueryState<unknown>>((get) => {
        const state = get(workflowsListQueryStateAtom as Atom<ListQueryState<unknown>>)
        const filtered = (state.data ?? []).filter((w) => {
            const wf = w as {flags?: Record<string, boolean> | null}
            if (!wf.flags) return false
            return Object.entries(flags).every(([key, val]) => wf.flags?.[key] === val)
        })
        return {...state, data: filtered}
    })

    return createThreeLevelAdapter<WorkflowRevisionSelectionResult>({
        name: "workflowRevision",
        grandparentType: "workflow",
        grandparentLabel: "Workflow",
        grandparentListAtom: filteredWorkflowsListAtom,
        grandparentOverrides: {
            getId: (entity: unknown) => (entity as {id: string}).id,
            getLabel: (entity: unknown) => (entity as {name?: string}).name ?? "Unnamed",
            hasChildren: true,
            isSelectable: false,
        },
        parentType: "workflowVariant",
        parentLabel: "Variant",
        parentRelation: workflowToVariantRelation as EntityRelation<unknown, unknown>,
        parentOverrides: {
            autoSelectSingle: true,
            getId: (entity: unknown) => (entity as {id: string}).id ?? "",
            getLabel: (entity: unknown) => (entity as {name?: string}).name ?? "Unnamed",
            getLabelNode: (entity: unknown) => {
                const v = entity as {name?: string}
                return React.createElement(VariantListItemLabel, {
                    name: v.name ?? "Unnamed",
                    reserveSubtitleSpace: true,
                })
            },
            getPlaceholderNode: (text: string) =>
                React.createElement(VariantListItemLabel, {
                    name: text,
                    reserveSubtitleSpace: true,
                }),
            hasChildren: true,
            isSelectable: false,
        },
        childType: "workflowRevision",
        childLabel: "Revision",
        childRelation: workflowVariantToRevisionRelation as EntityRelation<unknown, unknown>,
        childOverrides: {
            autoSelectSingle: true,
            getLabelNode:
                revisionOverrides.getLabelNode ??
                ((entity: unknown) => {
                    const r = entity as {
                        version?: number
                        name?: string
                        created_at?: string
                        created_by_id?: string
                    }
                    return React.createElement(RevisionLabel, {
                        version: r.version ?? 0,
                        message: r.name,
                        createdAt: r.created_at,
                        author: r.created_by_id,
                        maxMessageWidth: 180,
                    })
                }),
            getPlaceholderNode: (text: string) =>
                React.createElement(
                    "div",
                    {className: "flex flex-col gap-0.5"},
                    React.createElement("span", {className: "text-zinc-400"}, text),
                    React.createElement("span", {className: "invisible"}, "\u00A0"),
                ),
        },
        selectionType: "workflowRevision",
        toSelection:
            toSelection ??
            ((path, leafEntity) => {
                const revision = leafEntity as {id: string; version?: number}
                const workflow = path[0]
                const variant = path[1]
                const revisionItem = path[2]

                return {
                    type: "workflowRevision",
                    id: revision.id,
                    label: `${workflow?.label ?? "Workflow"} / ${variant?.label ?? "Variant"} / ${revisionItem?.label ?? "Revision"}`,
                    path,
                    metadata: {
                        workflowId: workflow?.id ?? "",
                        workflowName: workflow?.label ?? "",
                        variantId: variant?.id ?? "",
                        variantName: variant?.label ?? "",
                        revision: revision.version ?? 0,
                    },
                }
            }),
        emptyMessage: emptyMessage ?? "No workflows found",
        loadingMessage: loadingMessage ?? "Loading workflows...",
    })
}
