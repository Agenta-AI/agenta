/**
 * Shared hook that provides a custom browse adapter for workflow selection
 * with colored evaluator type tags and human evaluator filtering.
 *
 * Used by both PlaygroundHeader (evaluator connect flow) and
 * PlaygroundVariantConfigHeader (combined workflow select in browse mode).
 */
import React, {useEffect, useMemo, useRef, useState} from "react"

import {getEvaluatorColor, parseEvaluatorKeyFromUri} from "@agenta/entities/evaluator"
import {workflowsListDataAtom} from "@agenta/entities/workflow"
import {createWorkflowRevisionAdapter} from "@agenta/entity-ui/selection"
import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {EntityListItemLabel} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"

import {evaluatorsAtom} from "@/oss/lib/atoms/evaluation"

// ---------------------------------------------------------------------------
// useEvaluatorKeyMap — batch-fetches evaluator revisions to resolve URIs
// ---------------------------------------------------------------------------

const evaluatorKeyCacheByProject = new Map<string, Map<string, string>>()
const evaluatorKeyRequestedIdsByProject = new Map<string, Set<string>>()
const evaluatorKeyPendingIdsByProject = new Map<string, Set<string>>()
const evaluatorKeyInFlightByProject = new Map<string, Promise<void>>()

function areStringMapsEqual(a: Map<string, string>, b: Map<string, string>): boolean {
    if (a.size !== b.size) return false
    for (const [key, value] of a.entries()) {
        if (b.get(key) !== value) return false
    }
    return true
}

function getOrCreateEvaluatorKeyCache(projectId: string): Map<string, string> {
    const existing = evaluatorKeyCacheByProject.get(projectId)
    if (existing) return existing
    const next = new Map<string, string>()
    evaluatorKeyCacheByProject.set(projectId, next)
    return next
}

function getOrCreateRequestedSet(projectId: string): Set<string> {
    const existing = evaluatorKeyRequestedIdsByProject.get(projectId)
    if (existing) return existing
    const next = new Set<string>()
    evaluatorKeyRequestedIdsByProject.set(projectId, next)
    return next
}

function getOrCreatePendingSet(projectId: string): Set<string> {
    const existing = evaluatorKeyPendingIdsByProject.get(projectId)
    if (existing) return existing
    const next = new Set<string>()
    evaluatorKeyPendingIdsByProject.set(projectId, next)
    return next
}

async function fetchEvaluatorKeysForIds(projectId: string, workflowIds: string[]): Promise<void> {
    if (workflowIds.length === 0) return

    const cache = getOrCreateEvaluatorKeyCache(projectId)

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/workflows/revisions/query`,
        {
            workflow_refs: workflowIds.map((id) => ({id})),
        },
        {params: {project_id: projectId}},
    )

    const revisions = response.data?.workflow_revisions ?? []
    for (const rev of revisions) {
        const workflowId = rev.workflow_id
        const uri = rev.data?.uri
        if (!workflowId || !uri) continue
        const key = parseEvaluatorKeyFromUri(uri)
        if (key) cache.set(workflowId, key)
    }
}

async function drainEvaluatorKeyQueue(projectId: string): Promise<void> {
    const pending = getOrCreatePendingSet(projectId)

    while (pending.size > 0) {
        const batchIds = Array.from(pending)
        pending.clear()
        await fetchEvaluatorKeysForIds(projectId, batchIds)
    }
}

async function ensureEvaluatorKeys(
    projectId: string,
    workflowIds: string[],
): Promise<Map<string, string>> {
    const cache = getOrCreateEvaluatorKeyCache(projectId)
    const requested = getOrCreateRequestedSet(projectId)
    const pending = getOrCreatePendingSet(projectId)

    for (const id of workflowIds) {
        if (cache.has(id) || requested.has(id)) continue
        requested.add(id)
        pending.add(id)
    }

    while (true) {
        const currentInFlight = evaluatorKeyInFlightByProject.get(projectId)
        if (currentInFlight) {
            await currentInFlight
            // Drain may have completed while new IDs were enqueued in the same tick.
            if (pending.size > 0 && !evaluatorKeyInFlightByProject.get(projectId)) {
                continue
            }
            break
        }

        if (pending.size === 0) break

        const nextFetch = drainEvaluatorKeyQueue(projectId).finally(() => {
            if (evaluatorKeyInFlightByProject.get(projectId) === nextFetch) {
                evaluatorKeyInFlightByProject.delete(projectId)
            }
        })
        evaluatorKeyInFlightByProject.set(projectId, nextFetch)
        await nextFetch
    }

    return cache
}

/**
 * Hook that batch-fetches evaluator revisions and returns a
 * workflowId → evaluatorKey lookup map.
 *
 * Fetches once per set of workflow IDs and caches the result.
 */
export function useEvaluatorKeyMap(
    workflowIds: string[],
    prefilledKeys?: Map<string, string>,
): Map<string, string> {
    const projectId = useAtomValue(projectIdAtom)
    const [keyMap, setKeyMap] = useState<Map<string, string>>(new Map())
    const appliedRef = useRef<string>("")

    const normalizedWorkflowIds = useMemo(
        () => Array.from(new Set(workflowIds.filter(Boolean))),
        [workflowIds],
    )
    const idsKey = useMemo(
        () => [...normalizedWorkflowIds].sort().join(","),
        [normalizedWorkflowIds],
    )

    useEffect(() => {
        if (!projectId || normalizedWorkflowIds.length === 0) {
            appliedRef.current = ""
            setKeyMap(new Map())
            return
        }

        if (prefilledKeys && prefilledKeys.size > 0) {
            const cache = getOrCreateEvaluatorKeyCache(projectId)
            for (const [id, key] of prefilledKeys.entries()) {
                if (id && key && !cache.has(id)) cache.set(id, key)
            }
        }

        const mapVersionKey = `${projectId}:${idsKey}`
        if (appliedRef.current === mapVersionKey) return

        let cancelled = false
        const loadKeys = async () => {
            try {
                const cache = await ensureEvaluatorKeys(projectId, normalizedWorkflowIds)
                if (cancelled) return

                const scoped = new Map<string, string>()
                for (const id of normalizedWorkflowIds) {
                    const key = cache.get(id)
                    if (key) scoped.set(id, key)
                }
                appliedRef.current = mapVersionKey
                setKeyMap((prev) => (areStringMapsEqual(prev, scoped) ? prev : scoped))
            } catch (err) {
                console.warn("[useEvaluatorKeyMap] Failed to fetch evaluator revisions:", err)
            }
        }

        void loadKeys()
        return () => {
            cancelled = true
        }
    }, [projectId, normalizedWorkflowIds, idsKey, prefilledKeys])

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
    return (entity: unknown): React.ReactNode =>
        renderEvaluatorPickerLabelNode(entity, evaluatorKeyMap, evaluatorDefsByKey)
}

function renderEvaluatorPickerLabelNode(
    entity: unknown,
    evaluatorKeyMap: Map<string, string>,
    evaluatorDefsByKey: Map<string, string>,
): React.ReactNode {
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

    // Get evaluator workflow IDs from the workflow list (shared with picker),
    // avoiding a second dedicated evaluator list request.
    const workflows = useAtomValue(workflowsListDataAtom)
    const prefilledKeys = useMemo(() => {
        const next = new Map<string, string>()
        for (const workflow of workflows) {
            if (!workflow.flags?.is_evaluator || !workflow.id) continue
            const uri = workflow.data?.uri
            if (!uri) continue
            const key = parseEvaluatorKeyFromUri(uri)
            if (key) next.set(workflow.id, key)
        }
        return next
    }, [workflows])
    const evaluatorWorkflowIds = useMemo(
        () =>
            workflows
                .filter((w) => w.flags?.is_evaluator)
                .map((w) => w.id)
                .filter((id): id is string => Boolean(id)),
        [workflows],
    )

    // Batch-fetch evaluator keys from revision data
    const evaluatorKeyMap = useEvaluatorKeyMap(evaluatorWorkflowIds, prefilledKeys)

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

    return useMemo(() => {
        const getLabelNode = (entity: unknown): React.ReactNode =>
            renderEvaluatorPickerLabelNode(entity, evaluatorKeyMap, evaluatorDefsByKey)

        return createWorkflowRevisionAdapter({
            excludeRevisionZero: true,
            filterWorkflows: (entity: unknown) => {
                const w = entity as {
                    flags?: {is_human?: boolean} | null
                }
                // Exclude human evaluators from browse mode
                return !w.flags?.is_human
            },
            grandparentOverrides: {
                getLabelNode,
            },
        })
    }, [evaluatorKeyMap, evaluatorDefsByKey])
}

/**
 * Hook that returns a custom adapter for the evaluator-only picker.
 * Filters to evaluators only (excluding human), with colored type tags.
 */
export function useEvaluatorOnlyAdapter(
    revisionLabelOverride?: (entity: unknown) => React.ReactNode,
) {
    const {evaluatorKeyMap, evaluatorDefsByKey} = useEvaluatorEnrichedData()
    const revisionLabelOverrideRef = useRef(revisionLabelOverride)

    revisionLabelOverrideRef.current = revisionLabelOverride

    const hasRevisionLabelOverride = Boolean(revisionLabelOverride)

    return useMemo(() => {
        const getLabelNode = (entity: unknown): React.ReactNode =>
            renderEvaluatorPickerLabelNode(entity, evaluatorKeyMap, evaluatorDefsByKey)

        const options: Parameters<typeof createWorkflowRevisionAdapter>[0] = {
            flags: {is_evaluator: true, is_human: false},
            excludeRevisionZero: true,
            skipVariantLevel: true,
            grandparentOverrides: {
                getLabelNode,
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
    }, [hasRevisionLabelOverride, evaluatorKeyMap, evaluatorDefsByKey])
}
