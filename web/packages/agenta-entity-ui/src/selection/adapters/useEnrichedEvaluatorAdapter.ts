/**
 * Enriched Evaluator Adapter Hooks
 *
 * Package-level hooks that provide evaluator-aware browse/select adapters
 * with colored type tags. Replaces the OSS-only `useEvaluatorBrowseAdapter.ts`.
 *
 * Data sources (all from `@agenta/entities/workflow`):
 * - `evaluatorKeyMapAtom` — Map<workflowId, evaluatorKey> derived from batch-fetched revisions
 * - `evaluatorTemplatesMapAtom` — Map<evaluatorKey, displayName> from template definitions
 *
 * Adapter factory (from `@agenta/entity-ui/selection`):
 * - `createWorkflowRevisionAdapter` — Workflow → Revision adapter (skipVariantLevel: true)
 */

import type React from "react"
import {useMemo, useRef} from "react"

import {
    evaluatorKeyMapAtom,
    evaluatorTemplatesMapAtom,
    evaluatorTemplatesDataAtom,
    evaluatorConfigsQueryStateAtom,
    humanEvaluatorsListQueryAtom,
    workflowAppTypeAtomFamily,
    workflowsListDataAtom,
} from "@agenta/entities/workflow"
import {atom, getDefaultStore, useAtomValue} from "jotai"

import {renderEvaluatorPickerLabelNode} from "./evaluatorLabelUtils"
import {
    createWorkflowRevisionAdapter,
    type WorkflowRevisionSelectionResult,
} from "./workflowRevisionRelationAdapter"

// ============================================================================
// SHARED ENRICHMENT HOOK
// ============================================================================

/**
 * Hook that provides the evaluator key map and template definitions map.
 *
 * Uses package-level atoms (auto-fetching) instead of legacy SWR hooks,
 * so it works on any page without manual data population.
 */
export function useEvaluatorEnrichedData() {
    const evaluatorKeyMap = useAtomValue(evaluatorKeyMapAtom)
    const evaluatorDefsByKey = useAtomValue(evaluatorTemplatesMapAtom)

    return {evaluatorKeyMap, evaluatorDefsByKey}
}

/**
 * Map of workflow ID → isHuman, derived from the latest revision's type.
 * Workflow-level flags don't have is_feedback — it only exists at the revision level.
 */
function useWorkflowHumanMap() {
    const workflows = useAtomValue(workflowsListDataAtom)

    return useMemo(() => {
        const store = getDefaultStore()
        return new Map(
            workflows.map((workflow) => [
                workflow.id,
                store.get(workflowAppTypeAtomFamily(workflow.id)) === "human",
            ]),
        )
    }, [workflows])
}

// ============================================================================
// BROWSE ADAPTER (All workflows, colored tags, human filtered out)
// ============================================================================

/**
 * Hook that returns a browse adapter for the combined workflow select.
 * Shows colored evaluator type tags and filters out human evaluators.
 *
 * Used by PlaygroundVariantConfigHeader for browsing all workflow types.
 */
export function useEnrichedEvaluatorBrowseAdapter() {
    const {evaluatorKeyMap, evaluatorDefsByKey} = useEvaluatorEnrichedData()
    const workflowHumanMap = useWorkflowHumanMap()
    const evaluatorKeyMapRef = useRef(evaluatorKeyMap)
    const evaluatorDefsByKeyRef = useRef(evaluatorDefsByKey)
    const workflowHumanMapRef = useRef(workflowHumanMap)

    evaluatorKeyMapRef.current = evaluatorKeyMap
    evaluatorDefsByKeyRef.current = evaluatorDefsByKey
    workflowHumanMapRef.current = workflowHumanMap

    return useMemo(() => {
        const getLabelNode = (entity: unknown): React.ReactNode =>
            renderEvaluatorPickerLabelNode(
                entity,
                evaluatorKeyMapRef.current,
                evaluatorDefsByKeyRef.current,
            )

        return createWorkflowRevisionAdapter({
            skipVariantLevel: true,
            excludeRevisionZero: true,
            filterWorkflows: (entity: unknown) => {
                const w = entity as {id: string}
                return !workflowHumanMapRef.current.get(w.id)
            },
            grandparentOverrides: {
                getLabelNode,
            },
        })
    }, [])
}

// ============================================================================
// EVALUATOR-ONLY ADAPTER (Evaluators only, colored tags, no human)
// ============================================================================

/**
 * Hook that returns an adapter for the evaluator-only picker.
 * Filters to evaluators only (excluding human), with colored type tags.
 *
 * Used by annotation pages and playground evaluator connect flow.
 *
 * @param revisionLabelOverride - Optional custom label renderer for revision level
 */
export function useEnrichedEvaluatorOnlyAdapter(
    revisionLabelOverride?: (entity: unknown) => React.ReactNode,
) {
    const {evaluatorKeyMap, evaluatorDefsByKey} = useEvaluatorEnrichedData()
    const templates = useAtomValue(evaluatorTemplatesDataAtom)
    const evaluatorKeyMapRef = useRef(evaluatorKeyMap)
    const evaluatorDefsByKeyRef = useRef(evaluatorDefsByKey)
    const revisionLabelOverrideRef = useRef(revisionLabelOverride)

    evaluatorKeyMapRef.current = evaluatorKeyMap
    evaluatorDefsByKeyRef.current = evaluatorDefsByKey
    revisionLabelOverrideRef.current = revisionLabelOverride

    const hasRevisionLabelOverride = Boolean(revisionLabelOverride)

    // Build a stable Map<evaluatorKey, primaryCategory> from template data
    const templateCategoryMap = useMemo(() => {
        const map = new Map<string, string>()
        for (const t of templates) {
            if (t.key && t.categories?.length) {
                map.set(t.key, t.categories[0].toLowerCase())
            }
        }
        return map
    }, [templates])
    const templateCategoryMapRef = useRef(templateCategoryMap)
    templateCategoryMapRef.current = templateCategoryMap

    // Stable atom that wraps evaluatorConfigsQueryStateAtom into ListQueryState<unknown>.
    // Uses a proper Jotai atom so filtering reactively updates when revision data resolves.
    const autoEvaluatorsListAtom = useMemo(
        () =>
            atom((get) => {
                const state = get(evaluatorConfigsQueryStateAtom)
                return {
                    data: state.data as unknown[],
                    isPending: state.isPending,
                    isError: state.isError,
                    error: state.error ?? null,
                }
            }),
        [],
    )

    return useMemo(() => {
        const getLabelNode = (entity: unknown): React.ReactNode =>
            renderEvaluatorPickerLabelNode(
                entity,
                evaluatorKeyMapRef.current,
                evaluatorDefsByKeyRef.current,
            )

        // Resolve workflowId → evaluatorKey → primary category
        const getGroupKey = (entity: unknown): string | null | undefined => {
            const w = entity as {id: string}
            const key = evaluatorKeyMapRef.current.get(w.id)
            if (!key) return "custom"
            return templateCategoryMapRef.current.get(key) ?? "custom"
        }

        const CATEGORY_LABELS: Record<string, string> = {
            ai_llm: "AI / LLM",
            classifiers: "Classifiers",
            similarity: "Similarity",
            custom: "Custom",
            rag: "RAG",
        }

        const getGroupLabel = (key: string): string => CATEGORY_LABELS[key] ?? key

        const options: NonNullable<Parameters<typeof createWorkflowRevisionAdapter>[0]> = {
            skipVariantLevel: true,
            excludeRevisionZero: true,
            workflowListAtom: autoEvaluatorsListAtom,
            grandparentOverrides: {
                getLabelNode,
                getGroupKey,
                getGroupLabel,
                buildTabs: (entities: unknown[]) => {
                    const ORDERED_CATEGORIES = ["ai_llm", "classifiers", "similarity", "custom"]
                    const categorySeen = new Set<string>()
                    for (const e of entities) {
                        const w = e as {id: string}
                        const key = evaluatorKeyMapRef.current.get(w.id)
                        const cat = key
                            ? (templateCategoryMapRef.current.get(key) ?? "custom")
                            : "custom"
                        categorySeen.add(cat)
                    }
                    const result: {key: string; label: string}[] = [{key: "all", label: "All"}]
                    for (const cat of ORDERED_CATEGORIES) {
                        if (categorySeen.has(cat)) {
                            result.push({key: cat, label: CATEGORY_LABELS[cat]})
                        }
                    }
                    return result
                },
            },
        }

        if (hasRevisionLabelOverride) {
            options.revisionOverrides = {
                getLabelNode: (entity: unknown) =>
                    revisionLabelOverrideRef.current
                        ? revisionLabelOverrideRef.current(entity)
                        : null,
            }
        }

        return createWorkflowRevisionAdapter(options)
    }, [hasRevisionLabelOverride, autoEvaluatorsListAtom])
}

type AnnotationWorkflowRevisionSelectionResult = WorkflowRevisionSelectionResult & {
    metadata: WorkflowRevisionSelectionResult["metadata"] & {
        isHuman: boolean
    }
}

/**
 * Hook that returns an adapter for human evaluators only.
 * Used by annotation queue creation so only human feedback schemas can be selected.
 */
export function useEnrichedHumanEvaluatorAdapter(
    revisionLabelOverride?: (entity: unknown) => React.ReactNode,
) {
    const {evaluatorKeyMap, evaluatorDefsByKey} = useEvaluatorEnrichedData()
    const evaluatorKeyMapRef = useRef(evaluatorKeyMap)
    const evaluatorDefsByKeyRef = useRef(evaluatorDefsByKey)
    const revisionLabelOverrideRef = useRef(revisionLabelOverride)

    evaluatorKeyMapRef.current = evaluatorKeyMap
    evaluatorDefsByKeyRef.current = evaluatorDefsByKey
    revisionLabelOverrideRef.current = revisionLabelOverride

    const hasRevisionLabelOverride = Boolean(revisionLabelOverride)

    // Stable atom that wraps humanEvaluatorsListQueryAtom into ListQueryState<unknown>.
    // Uses a proper Jotai atom so filtering reactively updates when revision data resolves.
    const humanEvaluatorsListAtom = useMemo(
        () =>
            atom((get) => {
                const query = get(humanEvaluatorsListQueryAtom)
                return {
                    data: (query.data?.refs ?? []) as unknown[],
                    isPending: query.isPending ?? false,
                    isError: query.isError ?? false,
                    error: (query.error as Error | null) ?? null,
                }
            }),
        [],
    )

    return useMemo(() => {
        const getLabelNode = (entity: unknown): React.ReactNode =>
            renderEvaluatorPickerLabelNode(
                entity,
                evaluatorKeyMapRef.current,
                evaluatorDefsByKeyRef.current,
            )

        const options: NonNullable<Parameters<typeof createWorkflowRevisionAdapter>[0]> = {
            skipVariantLevel: true,
            excludeRevisionZero: true,
            workflowListAtom: humanEvaluatorsListAtom,
            grandparentOverrides: {
                getLabelNode,
            },
            toSelection: (path, leafEntity) => {
                const revision = leafEntity as {id: string; version?: number}
                const workflow = path[0]
                const revisionItem = path[1]

                const selection: AnnotationWorkflowRevisionSelectionResult = {
                    type: "workflowRevision",
                    id: revision.id,
                    label: `${workflow?.label ?? "Evaluator"} / ${revisionItem?.label ?? `v${revision.version ?? 0}`}`,
                    path,
                    metadata: {
                        workflowId: workflow?.id ?? "",
                        workflowName: workflow?.label ?? "",
                        variantId: "",
                        variantName: "",
                        revision: revision.version ?? 0,
                        isHuman: true,
                    },
                }

                return selection
            },
        }

        if (hasRevisionLabelOverride) {
            options.revisionOverrides = {
                getLabelNode: (entity: unknown) =>
                    revisionLabelOverrideRef.current
                        ? revisionLabelOverrideRef.current(entity)
                        : null,
            }
        }

        return createWorkflowRevisionAdapter(options)
    }, [hasRevisionLabelOverride, humanEvaluatorsListAtom])
}

/**
 * Hook that returns an adapter for annotation queues.
 * Includes both standard and human evaluators, with colored tags and runtime
 * metadata indicating whether the selected evaluator is human.
 */
export function useEnrichedAnnotationEvaluatorAdapter(
    revisionLabelOverride?: (entity: unknown) => React.ReactNode,
) {
    const {evaluatorKeyMap, evaluatorDefsByKey} = useEvaluatorEnrichedData()
    const workflowHumanMap = useWorkflowHumanMap()
    const evaluatorKeyMapRef = useRef(evaluatorKeyMap)
    const evaluatorDefsByKeyRef = useRef(evaluatorDefsByKey)
    const workflowHumanMapRef = useRef(workflowHumanMap)
    const revisionLabelOverrideRef = useRef(revisionLabelOverride)

    evaluatorKeyMapRef.current = evaluatorKeyMap
    evaluatorDefsByKeyRef.current = evaluatorDefsByKey
    workflowHumanMapRef.current = workflowHumanMap
    revisionLabelOverrideRef.current = revisionLabelOverride

    const hasRevisionLabelOverride = Boolean(revisionLabelOverride)

    return useMemo(() => {
        const getLabelNode = (entity: unknown): React.ReactNode =>
            renderEvaluatorPickerLabelNode(
                entity,
                evaluatorKeyMapRef.current,
                evaluatorDefsByKeyRef.current,
            )

        const options: Parameters<typeof createWorkflowRevisionAdapter>[0] = {
            skipVariantLevel: true,
            excludeRevisionZero: true,
            filterWorkflows: (entity: unknown) => {
                const workflow = entity as {
                    flags?: {is_evaluator?: boolean; is_feedback?: boolean} | null
                }

                return Boolean(workflow.flags?.is_evaluator || workflow.flags?.is_feedback)
            },
            grandparentOverrides: {
                getLabelNode,
            },
            toSelection: (path, leafEntity) => {
                const revision = leafEntity as {id: string; version?: number}
                const workflow = path[0]
                const revisionItem = path[1]
                const workflowId = workflow?.id ?? ""
                const isHuman = workflowHumanMapRef.current.get(workflowId) ?? false

                const selection: AnnotationWorkflowRevisionSelectionResult = {
                    type: "workflowRevision",
                    id: revision.id,
                    label: `${workflow?.label ?? "Workflow"} / ${revisionItem?.label ?? `v${revision.version ?? 0}`}`,
                    path,
                    metadata: {
                        workflowId,
                        workflowName: workflow?.label ?? "",
                        variantId: "",
                        variantName: "",
                        revision: revision.version ?? 0,
                        isHuman,
                    },
                }

                return selection
            },
        }

        if (hasRevisionLabelOverride) {
            options.revisionOverrides = {
                getLabelNode: (entity: unknown) =>
                    revisionLabelOverrideRef.current
                        ? revisionLabelOverrideRef.current(entity)
                        : null,
            }
        }

        return createWorkflowRevisionAdapter(options)
    }, [hasRevisionLabelOverride])
}
