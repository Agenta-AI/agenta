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
    workflowToRevisionRelation,
    workflowVariantToRevisionRelation,
    workflowVariantsListQueryStateAtomFamily,
    workflowRevisionsListQueryStateAtomFamily,
    type WorkflowQueryFlags,
} from "@agenta/entities/workflow"
import {EntityListItemLabel} from "@agenta/ui/components/presentational"
import {atom} from "jotai"
import type {Atom} from "jotai"

import type {
    EntitySelectionAdapter,
    EntitySelectionResult,
    ListQueryState,
    SelectionPathItem,
} from "../types"

import {createThreeLevelAdapter, createTwoLevelAdapter} from "./createAdapterFromRelations"
import {createRevisionLevel} from "./revisionLevelFactory"

// ============================================================================
// WORKFLOW TYPE GROUPING HELPERS
// ============================================================================

const WORKFLOW_GROUP_LABELS: Record<string, string> = {
    completion: "Completion",
    chat: "Chat",
    custom: "Custom",
    evaluator: "Evaluator",
    human: "Human",
}

function getWorkflowGroupKey(entity: unknown): string {
    const flags = (entity as {flags?: Record<string, boolean> | null}).flags
    if (flags?.is_evaluator) return "evaluator"
    if (flags?.is_chat) return "chat"
    if (flags?.is_custom) return "custom"
    if (flags?.is_feedback) return "human"
    return "completion"
}

function getWorkflowGroupLabel(key: string): string {
    return WORKFLOW_GROUP_LABELS[key] ?? key
}

/**
 * Render a workflow list item with a type tag trailing element.
 * Shows: "workflow name" + [Completion] / [Chat] / etc.
 * Only shows the tag when it's NOT the default "completion" type.
 */
function getWorkflowDisplayName(entity: unknown): string {
    const w = entity as {name?: string; slug?: string}
    return w.name?.trim() || w.slug?.trim() || "Unnamed"
}

function renderWorkflowLabelNode(entity: unknown): React.ReactNode {
    const groupKey = getWorkflowGroupKey(entity)
    const tag =
        groupKey !== "completion"
            ? React.createElement(
                  "span",
                  {
                      className: "text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500",
                  },
                  getWorkflowGroupLabel(groupKey),
              )
            : undefined

    return React.createElement(EntityListItemLabel, {
        label: getWorkflowDisplayName(entity),
        trailing: tag,
    })
}

// ============================================================================
// WORKFLOW VARIANT SUBTITLE HELPER
// ============================================================================

/**
 * Extract a subtitle for workflow variant display.
 * Shows description if available, otherwise falls back to updated_at or created_at date.
 */
function getWorkflowVariantSubtitle(entity: unknown): string | undefined {
    const v = entity as {
        description?: string | null
        updated_at?: string | null
        created_at?: string | null
    }
    if (v.description) return v.description

    const dateStr = v.updated_at ?? v.created_at
    if (dateStr) {
        const date = new Date(dateStr)
        if (!isNaN(date.getTime())) {
            const label = v.updated_at ? "Updated" : "Created"
            return `${label} ${date.toLocaleDateString(undefined, {month: "short", day: "numeric", year: "numeric"})}`
        }
    }
    return undefined
}

// ============================================================================
// SHARED WORKFLOW REVISION LEVEL
// ============================================================================

/**
 * Shared revision level config created via the revisionLevelFactory.
 * Provides:
 * - Standard version/date field extraction (no commit message — keeps layout to 2 lines)
 * - Author resolution via UserAuthorLabel (resolveAuthor: true by default)
 * - Consistent RevisionLabel rendering with renderAuthor
 * - Proper placeholder nodes
 */
const workflowRevisionLevel = createRevisionLevel({
    type: "workflowRevision",
})

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
 * Uses the workflow backend API via `/workflows/` endpoints.
 * Fetches all workflows (no flag filter) by default.
 */
export const workflowRevisionAdapter = createThreeLevelAdapter<WorkflowRevisionSelectionResult>({
    name: "workflowRevision",
    grandparentType: "workflow",
    grandparentLabel: "Workflow",
    grandparentListAtom: workflowsListQueryStateAtom as Atom<ListQueryState<unknown>>,
    grandparentOverrides: {
        getId: (entity: unknown) => (entity as {id: string}).id,
        getLabel: getWorkflowDisplayName,
        getLabelNode: renderWorkflowLabelNode,
        getGroupKey: getWorkflowGroupKey,
        getGroupLabel: getWorkflowGroupLabel,
        hasChildren: true,
        isSelectable: false,
    },
    parentType: "workflowVariant",
    parentLabel: "Variant",
    parentRelation: workflowToVariantRelation as EntityRelation<unknown, unknown>,
    parentOverrides: {
        autoSelectSingle: true,
        getId: (entity: unknown) => (entity as {id: string}).id ?? "",
        getLabel: (entity: unknown) => getWorkflowDisplayName(entity),
        getLabelNode: (entity: unknown) => {
            const v = entity as {name?: string}
            return React.createElement(EntityListItemLabel, {
                label: v.name?.trim() || (v as {slug?: string}).slug?.trim() || "Unnamed",
                subtitle: getWorkflowVariantSubtitle(entity),
            })
        },
        hasChildren: true,
        isSelectable: false,
    },
    childType: "workflowRevision",
    childLabel: "Revision",
    childRelation: workflowVariantToRevisionRelation as EntityRelation<unknown, unknown>,
    childOverrides: {
        autoSelectSingle: true,
        getId: workflowRevisionLevel.getId,
        getLabel: workflowRevisionLevel.getLabel,
        getLabelNode: workflowRevisionLevel.getLabelNode,
        getPlaceholderNode: workflowRevisionLevel.getPlaceholderNode,
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
     * Custom workflow (grandparent) level overrides (3-level mode only).
     * Use this to customize how workflow items are rendered in the picker.
     *
     * @example
     * ```typescript
     * // Custom label rendering for evaluator workflows
     * grandparentOverrides: {
     *     getLabelNode: (entity) => <MyCustomLabel entity={entity} />,
     * }
     * ```
     */
    grandparentOverrides?: {
        getLabelNode?: (entity: unknown) => React.ReactNode
        getGroupKey?: (entity: unknown) => string
        getGroupLabel?: (key: string) => string
    }

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

    /**
     * Custom filter function for the workflow list (3-level mode only).
     * Applied after flag filtering. Return true to include the workflow.
     *
     * @example
     * ```typescript
     * // Exclude human evaluators from the list
     * filterWorkflows: (entity) => {
     *     const w = entity as { flags?: { is_feedback?: boolean } }
     *     return !w.flags?.is_feedback
     * }
     * ```
     */
    filterWorkflows?: (entity: unknown) => boolean

    /**
     * When true, collapses the 3-level hierarchy (Workflow → Variant → Revision)
     * into a 2-level hierarchy (Workflow → Revision) by using the direct
     * workflow-to-revision relation.
     *
     * Use this when each workflow has a single variant and the variant level
     * adds no value to the selection UI.
     *
     * @default false
     */
    skipVariantLevel?: boolean

    /**
     * Custom workflow list atom override.
     * When provided, uses this atom instead of the default `workflowsListQueryStateAtom`
     * (and skips `flags`/`filterWorkflows` since the atom already provides filtered data).
     *
     * Use this when filtering depends on async/reactive data (e.g., revision-level flags)
     * that can't be reliably read via a synchronous `filterWorkflows` callback.
     */
    workflowListAtom?: Atom<ListQueryState<unknown>>
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
        grandparentOverrides = {},
        variantOverrides = {},
        revisionOverrides = {},
        toSelection,
        emptyMessage,
        loadingMessage,
        flags,
        filterWorkflows,
        skipVariantLevel = false,
        workflowListAtom,
    } = options

    const emptyListState: ListQueryState<unknown> = {
        data: [],
        isPending: false,
        isError: false,
        error: null,
    }

    // Skip-variant mode: Workflow → Revision (2-level, uses workflowToRevisionRelation)
    if (skipVariantLevel && !workflowId && !workflowIdAtom) {
        // When a custom workflowListAtom is provided, use it directly (it handles its own filtering).
        // Otherwise, apply flags/filterWorkflows on top of the default workflows list.
        const resolvedWorkflowsListAtom = workflowListAtom
            ? workflowListAtom
            : (() => {
                  const needsFiltering = !!flags || !!filterWorkflows
                  return needsFiltering
                      ? atom<ListQueryState<unknown>>((get) => {
                            const state = get(
                                workflowsListQueryStateAtom as Atom<ListQueryState<unknown>>,
                            )
                            const filtered = (state.data ?? []).filter((w) => {
                                if (flags) {
                                    const wf = w as {flags?: Record<string, boolean> | null}
                                    if (!wf.flags) return false
                                    const flagsMatch = Object.entries(flags).every(
                                        ([key, val]) => wf.flags?.[key] === val,
                                    )
                                    if (!flagsMatch) return false
                                }
                                if (filterWorkflows && !filterWorkflows(w)) return false
                                return true
                            })
                            return {...state, data: filtered}
                        })
                      : (workflowsListQueryStateAtom as Atom<ListQueryState<unknown>>)
              })()

        return createTwoLevelAdapter<WorkflowRevisionSelectionResult>({
            name: "workflowRevision",
            parentType: "workflow",
            parentLabel: "Evaluator",
            parentListAtom: resolvedWorkflowsListAtom,
            parentOverrides: {
                getId: (entity: unknown) => (entity as {id: string}).id,
                getLabel: getWorkflowDisplayName,
                getLabelNode: grandparentOverrides.getLabelNode ?? renderWorkflowLabelNode,
                hasChildren: true,
                isSelectable: false,
            },
            childType: "workflowRevision",
            childLabel: "Revision",
            childRelation: workflowToRevisionRelation as EntityRelation<unknown, unknown>,
            childOverrides: {
                autoSelectSingle: true,
                getId: revisionOverrides.getId ?? workflowRevisionLevel.getId,
                getLabel: revisionOverrides.getLabel ?? workflowRevisionLevel.getLabel,
                getLabelNode: revisionOverrides.getLabelNode ?? workflowRevisionLevel.getLabelNode,
                getPlaceholderNode: workflowRevisionLevel.getPlaceholderNode,
                filterItems: excludeRevisionZero
                    ? (r: unknown) => (r as {version?: number}).version !== 0
                    : undefined,
            },
            selectionType: "workflowRevision",
            toSelection:
                toSelection ??
                ((path, leafEntity) => {
                    const revision = leafEntity as {id: string; version?: number}
                    const workflow = path[0]

                    return {
                        type: "workflowRevision",
                        id: revision.id,
                        label: `${workflow?.label ?? "Evaluator"} / v${revision.version ?? 0}`,
                        path,
                        metadata: {
                            workflowId: workflow?.id ?? "",
                            workflowName: workflow?.label ?? "",
                            variantId: "",
                            variantName: "",
                            revision: revision.version ?? 0,
                        },
                    }
                }),
            emptyMessage: emptyMessage ?? "No evaluators found",
            loadingMessage: loadingMessage ?? "Loading evaluators...",
        })
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
                getLabel: variantOverrides.getLabel ?? ((v: unknown) => getWorkflowDisplayName(v)),
                getLabelNode:
                    variantOverrides.getLabelNode ??
                    ((entity: unknown) => {
                        const v = entity as {name?: string}
                        return React.createElement(EntityListItemLabel, {
                            label:
                                v.name?.trim() || (v as {slug?: string}).slug?.trim() || "Unnamed",
                            subtitle: getWorkflowVariantSubtitle(entity),
                        })
                    }),
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
                getId: revisionOverrides.getId ?? workflowRevisionLevel.getId,
                getLabel: revisionOverrides.getLabel ?? workflowRevisionLevel.getLabel,
                getLabelNode: revisionOverrides.getLabelNode ?? workflowRevisionLevel.getLabelNode,
                getPlaceholderNode: workflowRevisionLevel.getPlaceholderNode,
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

    // 2-level mode (skip variant): Workflow → Revision
    // Uses workflowToRevisionRelation to go directly from workflow to revisions
    if (skipVariantLevel) {
        // Client-side filtered workflow list atom (applies flags + filterWorkflows)
        const needsFiltering = !!flags || !!filterWorkflows
        const filteredWorkflowsListAtom = needsFiltering
            ? atom<ListQueryState<unknown>>((get) => {
                  const state = get(workflowsListQueryStateAtom as Atom<ListQueryState<unknown>>)
                  const filtered = (state.data ?? []).filter((w) => {
                      if (flags) {
                          const wf = w as {flags?: Record<string, boolean> | null}
                          if (!wf.flags) return false
                          const flagsMatch = Object.entries(flags).every(
                              ([key, val]) => wf.flags?.[key] === val,
                          )
                          if (!flagsMatch) return false
                      }
                      if (filterWorkflows && !filterWorkflows(w)) return false
                      return true
                  })
                  return {...state, data: filtered}
              })
            : (workflowsListQueryStateAtom as Atom<ListQueryState<unknown>>)

        return createTwoLevelAdapter<WorkflowRevisionSelectionResult>({
            name: "workflowRevision",
            parentType: "workflow",
            parentLabel: "Workflow",
            parentListAtom: filteredWorkflowsListAtom,
            parentOverrides: {
                getId: (entity: unknown) => (entity as {id: string}).id,
                getLabel: getWorkflowDisplayName,
                getLabelNode: grandparentOverrides.getLabelNode ?? renderWorkflowLabelNode,
                getGroupKey: grandparentOverrides.getGroupKey ?? getWorkflowGroupKey,
                getGroupLabel: grandparentOverrides.getGroupLabel ?? getWorkflowGroupLabel,
                hasChildren: true,
                isSelectable: false,
            },
            childType: "workflowRevision",
            childLabel: "Revision",
            childRelation: workflowToRevisionRelation as EntityRelation<unknown, unknown>,
            childOverrides: {
                autoSelectSingle: true,
                getId: revisionOverrides.getId ?? workflowRevisionLevel.getId,
                getLabel: revisionOverrides.getLabel ?? workflowRevisionLevel.getLabel,
                getLabelNode: revisionOverrides.getLabelNode ?? workflowRevisionLevel.getLabelNode,
                getPlaceholderNode: workflowRevisionLevel.getPlaceholderNode,
                filterItems: excludeRevisionZero
                    ? (r: unknown) => (r as {version?: number}).version !== 0
                    : undefined,
            },
            selectionType: "workflowRevision",
            toSelection:
                toSelection ??
                ((path, leafEntity) => {
                    const revision = leafEntity as {id: string; version?: number}
                    const workflow = path[0]
                    const revisionItem = path[1]

                    return {
                        type: "workflowRevision",
                        id: revision.id,
                        label: `${workflow?.label ?? "Workflow"} / ${revisionItem?.label ?? "Revision"}`,
                        path,
                        metadata: {
                            workflowId: workflow?.id ?? "",
                            workflowName: workflow?.label ?? "",
                            variantId: "",
                            variantName: "",
                            revision: revision.version ?? 0,
                        },
                    }
                }),
            emptyMessage: emptyMessage ?? "No workflows found",
            loadingMessage: loadingMessage ?? "Loading workflows...",
        })
    }

    // 3-level mode: Workflow → Variant → Revision
    // When no customizations are needed, return the default adapter
    const hasGrandparentOverrides = Object.keys(grandparentOverrides).length > 0
    if (!flags && !filterWorkflows && !hasGrandparentOverrides && !revisionOverrides.getLabelNode) {
        return workflowRevisionAdapter
    }

    // Client-side filtered workflow list atom (applies flags + filterWorkflows)
    const needsFiltering = !!flags || !!filterWorkflows
    const filteredWorkflowsListAtom = needsFiltering
        ? atom<ListQueryState<unknown>>((get) => {
              const state = get(workflowsListQueryStateAtom as Atom<ListQueryState<unknown>>)
              const filtered = (state.data ?? []).filter((w) => {
                  if (flags) {
                      const wf = w as {flags?: Record<string, boolean> | null}
                      if (!wf.flags) return false
                      const flagsMatch = Object.entries(flags).every(
                          ([key, val]) => wf.flags?.[key] === val,
                      )
                      if (!flagsMatch) return false
                  }
                  if (filterWorkflows && !filterWorkflows(w)) return false
                  return true
              })
              return {...state, data: filtered}
          })
        : (workflowsListQueryStateAtom as Atom<ListQueryState<unknown>>)

    return createThreeLevelAdapter<WorkflowRevisionSelectionResult>({
        name: "workflowRevision",
        grandparentType: "workflow",
        grandparentLabel: "Workflow",
        grandparentListAtom: filteredWorkflowsListAtom,
        grandparentOverrides: {
            getId: (entity: unknown) => (entity as {id: string}).id,
            getLabel: (entity: unknown) => getWorkflowDisplayName(entity),
            getLabelNode: grandparentOverrides.getLabelNode ?? renderWorkflowLabelNode,
            getGroupKey: grandparentOverrides.getGroupKey ?? getWorkflowGroupKey,
            getGroupLabel: grandparentOverrides.getGroupLabel ?? getWorkflowGroupLabel,
            hasChildren: true,
            isSelectable: false,
        },
        parentType: "workflowVariant",
        parentLabel: "Variant",
        parentRelation: workflowToVariantRelation as EntityRelation<unknown, unknown>,
        parentOverrides: {
            autoSelectSingle: true,
            getId: (entity: unknown) => (entity as {id: string}).id ?? "",
            getLabel: (entity: unknown) => getWorkflowDisplayName(entity),
            getLabelNode: (entity: unknown) => {
                const v = entity as {name?: string}
                return React.createElement(EntityListItemLabel, {
                    label: v.name?.trim() || (v as {slug?: string}).slug?.trim() || "Unnamed",
                    subtitle: getWorkflowVariantSubtitle(entity),
                    reserveSubtitleSpace: true,
                })
            },
            getPlaceholderNode: (text: string) =>
                React.createElement(EntityListItemLabel, {
                    label: text,
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
            getId: workflowRevisionLevel.getId,
            getLabel: workflowRevisionLevel.getLabel,
            getLabelNode: revisionOverrides.getLabelNode ?? workflowRevisionLevel.getLabelNode,
            getPlaceholderNode: workflowRevisionLevel.getPlaceholderNode,
            filterItems: excludeRevisionZero
                ? (r: unknown) => (r as {version?: number}).version !== 0
                : undefined,
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
