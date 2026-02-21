/**
 * Shared hook that provides a custom browse adapter for workflow selection
 * with colored evaluator type tags and human evaluator filtering.
 *
 * Used by both PlaygroundHeader (evaluator connect flow) and
 * PlaygroundVariantConfigHeader (combined workflow select in browse mode).
 */
import React, {useEffect, useMemo, useRef, useState} from "react"

import {
    getEvaluatorColor,
    parseEvaluatorKeyFromUri,
    evaluatorsListDataAtom,
} from "@agenta/entities/evaluator"
import {createWorkflowRevisionAdapter} from "@agenta/entity-ui/selection"
import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {EntityListItemLabel} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"

import {evaluatorsAtom} from "@/oss/lib/atoms/evaluation"

// ---------------------------------------------------------------------------
// useEvaluatorKeyMap — batch-fetches evaluator revisions to resolve URIs
// ---------------------------------------------------------------------------

/**
 * Hook that batch-fetches evaluator revisions and returns a
 * workflowId → evaluatorKey lookup map.
 *
 * Fetches once per set of workflow IDs and caches the result.
 */
export function useEvaluatorKeyMap(workflowIds: string[]): Map<string, string> {
    const projectId = useAtomValue(projectIdAtom)
    const [keyMap, setKeyMap] = useState<Map<string, string>>(new Map())
    const fetchedRef = useRef<string>("")

    // Stable key for the current set of workflow IDs
    const idsKey = useMemo(() => [...workflowIds].sort().join(","), [workflowIds])

    useEffect(() => {
        if (!projectId || workflowIds.length === 0 || idsKey === fetchedRef.current) return
        fetchedRef.current = idsKey

        const fetchKeys = async () => {
            try {
                const response = await axios.post(
                    `${getAgentaApiUrl()}/preview/workflows/revisions/query`,
                    {
                        workflow_refs: workflowIds.map((id) => ({id})),
                    },
                    {params: {project_id: projectId}},
                )

                const revisions = response.data?.workflow_revisions ?? []
                const map = new Map<string, string>()

                for (const rev of revisions) {
                    const workflowId = rev.workflow_id
                    const uri = rev.data?.uri
                    if (workflowId && uri) {
                        const key = parseEvaluatorKeyFromUri(uri)
                        if (key) {
                            map.set(workflowId, key)
                        }
                    }
                }

                setKeyMap(map)
            } catch (err) {
                console.warn("[useEvaluatorKeyMap] Failed to fetch evaluator revisions:", err)
            }
        }

        void fetchKeys()
    }, [projectId, workflowIds, idsKey])

    return keyMap
}

// ---------------------------------------------------------------------------
// buildEvaluatorPickerLabelNode — creates getLabelNode with colored tags
// ---------------------------------------------------------------------------

/**
 * Build a getLabelNode callback for evaluator workflow items.
 * Shows colored tags based on evaluator type (Human, Custom Code, or built-in name).
 * For non-evaluator workflows (apps), shows the default label without a tag.
 */
export function buildEvaluatorPickerLabelNode(
    evaluatorKeyMap: Map<string, string>,
    evaluatorDefsByKey: Map<string, string>,
) {
    return (entity: unknown): React.ReactNode => {
        const w = entity as {
            id: string
            name?: string
            flags?: {is_human?: boolean; is_custom?: boolean; is_evaluator?: boolean} | null
        }
        const name = w.name ?? "Unnamed"

        // Only show colored tags for evaluator-type workflows
        if (!w.flags?.is_evaluator) {
            return React.createElement(EntityListItemLabel, {label: name})
        }

        // Resolve tag label and color key:
        // 1. For human evaluators, use "Human" label directly from flags
        // 2. For custom evaluators, use "Custom Code" label directly from flags
        // 3. For built-in evaluators, look up from revision data URI → evaluator defs
        let tagLabel: string | null = null
        let colorSource: string | null = null

        if (w.flags?.is_human) {
            tagLabel = "Human"
            colorSource = "human"
        } else if (w.flags?.is_custom) {
            tagLabel = "Custom Code"
            colorSource = "custom"
        } else {
            const evaluatorKey = evaluatorKeyMap.get(w.id)
            if (evaluatorKey) {
                tagLabel = evaluatorDefsByKey.get(evaluatorKey) ?? null
                colorSource = evaluatorKey
            }
        }

        const color = colorSource ? getEvaluatorColor(colorSource) : null

        const tag = tagLabel
            ? React.createElement(
                  "span",
                  {
                      className: "text-[10px] px-1.5 py-0.5 rounded",
                      style: color
                          ? {
                                backgroundColor: color.bg,
                                color: color.text,
                                borderColor: color.border,
                                borderWidth: "1px",
                                borderStyle: "solid",
                            }
                          : undefined,
                  },
                  tagLabel,
              )
            : undefined

        return React.createElement(EntityListItemLabel, {
            label: name,
            trailing: tag,
        })
    }
}

// ---------------------------------------------------------------------------
// useEvaluatorEnrichedAdapter — shared data for evaluator-aware adapters
// ---------------------------------------------------------------------------

/**
 * Hook that provides the evaluator key map and definitions map,
 * used to build evaluator-aware browse adapters.
 */
export function useEvaluatorEnrichedData() {
    // Read evaluator definitions for display names
    const evaluatorDefs = useAtomValue(evaluatorsAtom)
    const evaluatorDefsByKey = useMemo(
        () => new Map(evaluatorDefs.map((d) => [d.key, d.name])),
        [evaluatorDefs],
    )

    // Get evaluator workflow IDs from the evaluator entity list
    const evaluatorWorkflows = useAtomValue(evaluatorsListDataAtom)
    const evaluatorWorkflowIds = useMemo(
        () => evaluatorWorkflows.map((w) => w.id),
        [evaluatorWorkflows],
    )

    // Batch-fetch evaluator keys from revision data
    const evaluatorKeyMap = useEvaluatorKeyMap(evaluatorWorkflowIds)

    return {evaluatorKeyMap, evaluatorDefsByKey}
}

// ---------------------------------------------------------------------------
// useEvaluatorBrowseAdapter — browse adapter with colored tags + filtering
// ---------------------------------------------------------------------------

/**
 * Hook that returns a custom browse adapter for the combined workflow select.
 * Shows colored evaluator type tags and filters out human evaluators.
 */
export function useEvaluatorBrowseAdapter() {
    const {evaluatorKeyMap, evaluatorDefsByKey} = useEvaluatorEnrichedData()

    return useMemo(
        () =>
            createWorkflowRevisionAdapter({
                excludeRevisionZero: true,
                filterWorkflows: (entity: unknown) => {
                    const w = entity as {
                        flags?: {is_human?: boolean} | null
                    }
                    // Exclude human evaluators from browse mode
                    return !w.flags?.is_human
                },
                grandparentOverrides: {
                    getLabelNode: buildEvaluatorPickerLabelNode(
                        evaluatorKeyMap,
                        evaluatorDefsByKey,
                    ),
                },
            }),
        [evaluatorKeyMap, evaluatorDefsByKey],
    )
}

/**
 * Hook that returns a custom adapter for the evaluator-only picker.
 * Filters to evaluators only (excluding human), with colored type tags.
 */
export function useEvaluatorOnlyAdapter(
    revisionLabelOverride?: (entity: unknown) => React.ReactNode,
) {
    const {evaluatorKeyMap, evaluatorDefsByKey} = useEvaluatorEnrichedData()

    return useMemo(
        () =>
            createWorkflowRevisionAdapter({
                flags: {is_evaluator: true, is_human: false},
                grandparentOverrides: {
                    getLabelNode: buildEvaluatorPickerLabelNode(
                        evaluatorKeyMap,
                        evaluatorDefsByKey,
                    ),
                },
                ...(revisionLabelOverride
                    ? {revisionOverrides: {getLabelNode: revisionLabelOverride}}
                    : {}),
            }),
        [evaluatorKeyMap, evaluatorDefsByKey, revisionLabelOverride],
    )
}
