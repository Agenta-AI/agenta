import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import type {ColumnsType} from "antd/es/table"
import {useAtomValue, useSetAtom} from "jotai"

import {
    INVOCATION_METRIC_KEYS,
    INVOCATION_METRIC_LABELS,
} from "@/oss/components/EvalRunDetails/components/views/OverviewView/constants"
import {
    ColumnVisibilityMenuTrigger,
    createColumnVisibilityAwareCell,
    createComponentCell,
    createTableColumns,
} from "@/oss/components/InfiniteVirtualTable"
import type {TableColumnConfig} from "@/oss/components/InfiniteVirtualTable/columns/types"
import {getEvaluatorMetricBlueprintAtom} from "@/oss/components/References/atoms/metricBlueprint"
import {PreviewCreatedByCell} from "@/oss/components/References/cells/CreatedByCells"
import {humanizeEvaluatorName, humanizeMetricPath} from "@/oss/lib/evaluations/utils/metrics"
import {canonicalizeMetricKey} from "@/oss/lib/metricUtils"

import {
    createEvaluatorOutputTypesKey,
    getOutputTypesMap,
    isStringOutputType,
    subscribeToOutputTypes,
} from "../../atoms/evaluatorOutputTypes"
import RunActionsCell from "../../components/cells/ActionsCell"
import {PreviewCreatedCell} from "../../components/cells/CreatedCells"
import PreviewKindCell from "../../components/cells/KindCell"
import {RunMetricCellContent} from "../../components/cells/RunMetricCell"
import {PreviewRunNameCell} from "../../components/cells/RunNameCells"
import {PreviewStatusCell} from "../../components/cells/StatusCells"
import MetricColumnHeader from "../../components/headers/MetricColumnHeader"
import MetricGroupHeader from "../../components/headers/MetricGroupHeader"
import {METRIC_COLUMN_CONFIG} from "../../constants"
import type {EvaluationRunTableRow} from "../../types"
import type {EvaluationRunsColumnExportMetadata} from "../../types/exportMetadata"
import type {RunMetricDescriptor} from "../../types/runMetrics"
import {
    buildReferenceBlueprint,
    buildReferenceColumnKey,
    type ReferenceColumnDescriptor,
} from "../../utils/referenceSchema"

import {
    REFERENCE_CELL_RENDERERS,
    REFERENCE_COLUMN_DIMENSIONS,
    shouldUpdateApplicationCell,
    shouldUpdateCreatedAtCell,
    shouldUpdateCreatedByCell,
    shouldUpdateEvaluatorCell,
    shouldUpdateMetricCell,
    shouldUpdateNameCell,
    shouldUpdateReferenceCell,
    shouldUpdateRowKeyCell,
    shouldUpdateStatusCell,
    shouldUpdateVariantCell,
} from "./constants"
import type {EvaluatorHandles, UseEvaluationRunsColumnsParams} from "./types"
import {
    areMetricGroupsEqual,
    deriveDescriptorLabel,
    formatMetricExportLabel,
    getReferenceVisibilityLabel,
    mergeEvaluatorHandles,
    normalizeDescriptorLabelForGroup,
    normalizeString,
    resolveCreatedAtForExport,
    resolveEvaluationKindForExport,
    resolveEvaluatorHandles,
    resolveEvaluatorReferenceCandidate,
    resolveReferenceExportValue,
    resolveRunNameForExport,
    resolveStatusForExport,
    sanitizeGroupLabel,
    withColumnVisibilityHeader,
} from "./utils"

export {
    formatMetricExportLabel,
    resolveReferenceExportValue,
    resolveRunNameForExport,
} from "./utils"

const useEvaluationRunsColumns = ({
    evaluationKind,
    rows,
    scopeId,
    supportsPreviewMetrics,
    isAutoOrHuman,
    onOpenDetails,
    onVariantNavigation,
    onTestsetNavigation,
    onRequestDelete,
    resolveAppId,
    onExportRow,
    rowExportingKey,
}: UseEvaluationRunsColumnsParams) => {
    const blueprintAtom = useMemo(() => getEvaluatorMetricBlueprintAtom(scopeId), [scopeId])
    const evaluatorBlueprint = useAtomValue(blueprintAtom)
    const setEvaluatorBlueprint = useSetAtom(blueprintAtom)
    const stableRows = rows

    // Track seen run IDs to avoid recomputing metric groups when only new rows are added
    const seenRunIdsRef = useRef<Set<string>>(new Set())
    const stablePreviewEntriesRef = useRef<
        {
            runId: string | null
            projectId: string | null
            meta: NonNullable<(typeof rows)[0]["previewMeta"]>
        }[]
    >([])

    // Stabilize reference blueprint - only recompute when structure changes
    const stableReferenceBlueprintRef = useRef<ReferenceColumnDescriptor[]>([])

    // Track the previous evaluationKind to detect tab changes
    const prevEvaluationKindRef = useRef(evaluationKind)

    // Reset refs and evaluator blueprint when evaluationKind changes (tab switch)
    useEffect(() => {
        if (prevEvaluationKindRef.current !== evaluationKind) {
            seenRunIdsRef.current = new Set()
            stablePreviewEntriesRef.current = []
            stableReferenceBlueprintRef.current = []
            // Also reset the evaluator blueprint atom to clear stale column data
            setEvaluatorBlueprint([])
            prevEvaluationKindRef.current = evaluationKind
        }
    }, [evaluationKind, setEvaluatorBlueprint])

    const previewRunEntries = useMemo(() => {
        const entries = stableRows
            .filter((row) => !row.__isSkeleton && row.preview && row.previewMeta)
            .map((row) => ({
                runId: row.preview?.id ?? row.runId ?? null,
                projectId: row.projectId ?? null,
                meta: row.previewMeta!,
            }))
            .filter((entry) => Boolean(entry.runId))

        // Check if we have any new run IDs that we haven't seen before
        const currentRunIds = new Set(entries.map((e) => e.runId).filter(Boolean) as string[])
        const hasNewRuns = [...currentRunIds].some((id) => !seenRunIdsRef.current.has(id))

        if (hasNewRuns) {
            // Update seen run IDs
            currentRunIds.forEach((id) => seenRunIdsRef.current.add(id))
            stablePreviewEntriesRef.current = entries
            return entries
        }

        // Return stable reference if no new runs
        return stablePreviewEntriesRef.current.length > 0
            ? stablePreviewEntriesRef.current
            : entries
    }, [stableRows])

    const referenceBlueprint = useMemo(() => {
        const newBlueprint = buildReferenceBlueprint(stableRows, evaluationKind)

        // Check if blueprint structure changed (compare by role keys)
        const prevKeys = stableReferenceBlueprintRef.current
            .map((d) => `${d.role}:${d.roleOrdinal}`)
            .join("|")
        const newKeys = newBlueprint.map((d) => `${d.role}:${d.roleOrdinal}`).join("|")

        if (prevKeys !== newKeys) {
            stableReferenceBlueprintRef.current = newBlueprint
            return newBlueprint
        }

        return stableReferenceBlueprintRef.current.length > 0
            ? stableReferenceBlueprintRef.current
            : newBlueprint
    }, [stableRows, evaluationKind])

    const ensuredReferenceBlueprint = useMemo(() => {
        if (evaluationKind !== "all") {
            return referenceBlueprint
        }
        const hasQueryColumn = referenceBlueprint.some((descriptor) => descriptor.role === "query")
        if (hasQueryColumn) {
            return referenceBlueprint
        }
        const fallbackDescriptor: ReferenceColumnDescriptor = {
            slotIndex: referenceBlueprint.length,
            role: "query",
            roleOrdinal: 1,
            label: "Query",
        }
        return [...referenceBlueprint, fallbackDescriptor]
    }, [evaluationKind, referenceBlueprint])

    const invocationMetricDescriptors = useMemo(
        () =>
            INVOCATION_METRIC_KEYS.map(
                (key) =>
                    ({
                        id: `invocation:${key}`,
                        label: INVOCATION_METRIC_LABELS[key] ?? humanizeMetricPath(key),
                        metricKey: key,
                        metricPath: key,
                        kind: "invocation",
                    }) as RunMetricDescriptor,
            ),
        [],
    )

    const evaluatorMetricGroups = useMemo(() => {
        if (!supportsPreviewMetrics || !previewRunEntries.length) return []

        const groups = new Map<
            string,
            {
                id: string
                label: string
                referenceId: string | null
                projectIds: Set<string>
                handles: EvaluatorHandles | null
                metrics: Map<string, RunMetricDescriptor>
            }
        >()

        previewRunEntries.forEach(({runId, meta, projectId}) => {
            if (!runId) return
            const metaSteps = Array.isArray(meta.steps) ? meta.steps : []
            const metaMappings = Array.isArray(meta.mappings) ? meta.mappings : []

            const stepInfoMap = new Map<
                string,
                {
                    slug: string
                    label: string
                    id: string | null
                    handles: EvaluatorHandles
                }
            >()

            metaSteps.forEach((step) => {
                if (!step || typeof step.key !== "string") return
                const type = typeof step.type === "string" ? step.type.toLowerCase() : ""
                if (type !== "annotation") return
                const refs = step.references ?? {}
                const evaluatorHandles = resolveEvaluatorHandles(refs)
                if (projectId && !evaluatorHandles.projectId) {
                    evaluatorHandles.projectId = projectId
                }
                const evaluatorRef = resolveEvaluatorReferenceCandidate(refs)
                const slugCandidate =
                    evaluatorHandles.slug ??
                    normalizeString(evaluatorRef?.slug) ??
                    normalizeString(evaluatorRef?.key) ??
                    normalizeString(evaluatorRef?.id) ??
                    normalizeString(step.key) ??
                    step.key
                const labelCandidate =
                    evaluatorHandles.name ??
                    normalizeString(evaluatorRef?.name) ??
                    slugCandidate ??
                    step.key
                stepInfoMap.set(step.key, {
                    slug: slugCandidate ?? step.key,
                    label: humanizeEvaluatorName(labelCandidate ?? step.key),
                    id: evaluatorHandles.id ?? normalizeString(evaluatorRef?.id) ?? null,
                    handles: evaluatorHandles,
                })
            })

            metaMappings.forEach((mapping) => {
                const kind = normalizeString(mapping?.kind)?.toLowerCase()
                if (kind && !["annotation", "evaluator"].includes(kind)) return
                const stepKey = typeof mapping?.stepKey === "string" ? mapping.stepKey : null
                if (!stepKey) return
                const stepInfo = stepInfoMap.get(stepKey)
                if (!stepInfo) return
                const metricPath = normalizeString(mapping?.path)
                if (!metricPath) return
                const canonicalPath = canonicalizeMetricKey(metricPath)
                const descriptorId = `${stepInfo.slug}:${canonicalPath}`
                const metricLabelSource = mapping?.name ?? metricPath
                const metricLabel = humanizeMetricPath(metricLabelSource ?? metricPath)
                const outputType = normalizeString(mapping?.outputType)?.toLowerCase() ?? null

                const handles = {...(stepInfo.handles ?? {})}
                if (projectId && !handles.projectId) {
                    handles.projectId = projectId
                }
                const referenceIdCandidate =
                    handles.id ?? handles.revisionId ?? handles.variantId ?? stepInfo.id ?? null

                let group = groups.get(stepInfo.slug)
                if (!group) {
                    group = {
                        id: stepInfo.slug,
                        label: stepInfo.label,
                        referenceId: referenceIdCandidate,
                        projectIds: new Set<string>(),
                        handles: handles,
                        metrics: new Map<string, RunMetricDescriptor>(),
                    }
                    groups.set(stepInfo.slug, group)
                }
                if (referenceIdCandidate && !group.referenceId) {
                    group.referenceId = referenceIdCandidate
                }
                if (handles) {
                    group.handles = mergeEvaluatorHandles(group.handles, handles)
                }
                if (projectId) {
                    group.projectIds.add(projectId)
                }

                let descriptor = group.metrics.get(descriptorId)
                if (!descriptor) {
                    descriptor = {
                        id: descriptorId,
                        label: metricLabel,
                        metricKey: metricPath,
                        metricPath,
                        stepKey,
                        kind: "evaluator",
                        outputType,
                        stepKeysByRunId: {[runId]: stepKey},
                        metricPathsByRunId: {[runId]: metricPath},
                        evaluatorRef: {
                            slug: handles.slug ?? stepInfo.slug,
                            id: handles.id ?? null,
                            variantId: handles.variantId ?? null,
                            variantSlug: handles.variantSlug ?? null,
                            revisionId: handles.revisionId ?? null,
                            revisionSlug: handles.revisionSlug ?? null,
                            projectId: handles.projectId ?? projectId ?? null,
                        },
                    }
                    group.metrics.set(descriptorId, descriptor)
                } else {
                    descriptor.stepKeysByRunId = {
                        ...(descriptor.stepKeysByRunId ?? {}),
                        [runId]: stepKey,
                    }
                    descriptor.metricPathsByRunId = {
                        ...(descriptor.metricPathsByRunId ?? {}),
                        [runId]: metricPath,
                    }
                    if (!descriptor.label || descriptor.label === descriptor.id) {
                        descriptor.label = metricLabel
                    }
                    // Preserve outputType if already set, otherwise use the new one
                    if (!descriptor.outputType && outputType) {
                        descriptor.outputType = outputType
                    }
                    const priorRef = descriptor.evaluatorRef ?? {}
                    descriptor.evaluatorRef = {
                        slug: priorRef.slug ?? handles.slug ?? stepInfo.slug,
                        id: priorRef.id ?? handles.id ?? null,
                        variantId: priorRef.variantId ?? handles.variantId ?? null,
                        variantSlug: priorRef.variantSlug ?? handles.variantSlug ?? null,
                        revisionId: priorRef.revisionId ?? handles.revisionId ?? null,
                        revisionSlug: priorRef.revisionSlug ?? handles.revisionSlug ?? null,
                        projectId: priorRef.projectId ?? handles.projectId ?? projectId ?? null,
                    }
                }
            })
        })

        return Array.from(groups.values())
            .map((group) => {
                const projectId =
                    group.projectIds.size === 1 ? (Array.from(group.projectIds)[0] ?? null) : null
                return {
                    id: group.id,
                    label: group.label,
                    evaluatorId: group.referenceId,
                    projectId,
                    handles: group.handles ?? null,
                    columns: Array.from(group.metrics.values())
                        .map((descriptor) => ({
                            ...descriptor,
                            evaluatorRef: {
                                ...(descriptor.evaluatorRef ?? {}),
                                projectId: descriptor.evaluatorRef?.projectId ?? projectId ?? null,
                            },
                        }))
                        .sort((a, b) => a.label.localeCompare(b.label)),
                }
            })
            .filter((group) => group.columns.length > 0)
            .sort((a, b) => a.label.localeCompare(b.label))
    }, [previewRunEntries, supportsPreviewMetrics])

    useEffect(() => {
        if (!supportsPreviewMetrics) {
            setEvaluatorBlueprint([])
            return
        }
        if (!evaluatorMetricGroups.length) return
        setEvaluatorBlueprint((prev) =>
            areMetricGroupsEqual(prev, evaluatorMetricGroups) ? prev : evaluatorMetricGroups,
        )
    }, [evaluatorMetricGroups, setEvaluatorBlueprint, supportsPreviewMetrics])

    const metricGroupsForRendering =
        supportsPreviewMetrics && (evaluatorMetricGroups.length || evaluatorBlueprint.length)
            ? evaluatorMetricGroups.length
                ? evaluatorMetricGroups
                : evaluatorBlueprint
            : []

    // Track output types version to trigger re-renders when they change
    const [outputTypesVersion, setOutputTypesVersion] = useState(0)

    // Subscribe to output types changes for all groups (using module-level cache)
    useEffect(() => {
        const unsubscribes: (() => void)[] = []

        // Check if any output types are already loaded (in case MetricGroupHeader set them before we subscribed)
        let hasExistingData = false
        metricGroupsForRendering.forEach((group) => {
            const groupHandles = group.handles ?? null
            const groupSlug = groupHandles?.slug ?? group.id
            const groupProjectId = groupHandles?.projectId ?? group.projectId ?? null
            const key = createEvaluatorOutputTypesKey(groupProjectId, groupSlug)
            const currentValue = getOutputTypesMap(key)

            if (currentValue.size > 0) {
                hasExistingData = true
            }

            // Subscribe to changes using module-level cache
            const unsubscribe = subscribeToOutputTypes(key, () => {
                setOutputTypesVersion((v) => v + 1)
            })
            unsubscribes.push(unsubscribe)
        })

        // If we found existing data, trigger a re-render immediately
        if (hasExistingData) {
            setOutputTypesVersion((v) => v + 1)
        }

        return () => {
            unsubscribes.forEach((unsub) => unsub())
        }
    }, [metricGroupsForRendering])

    // Helper function to check if a metric should be hidden (string output types are filtered out)
    const isMetricHidden = useCallback(
        (groupId: string, metricPath: string, descriptorOutputType: string | null | undefined) => {
            // First check descriptor's outputType
            if (descriptorOutputType === "string") {
                return true
            }

            // Find the group to get its project ID and slug
            const group = metricGroupsForRendering.find((g) => g.id === groupId)
            if (!group) return false

            const groupHandles = group.handles ?? null
            const groupSlug = groupHandles?.slug ?? group.id
            const groupProjectId = groupHandles?.projectId ?? group.projectId ?? null
            const key = createEvaluatorOutputTypesKey(groupProjectId, groupSlug)
            const outputTypesMap = getOutputTypesMap(key)

            if (outputTypesMap.size === 0) {
                return false
            }

            // Extract the metric name from the full path
            const metricName = metricPath.includes(".")
                ? (metricPath.split(".").pop() ?? metricPath)
                : metricPath
            const canonicalPath = canonicalizeMetricKey(metricName)
            const outputType = outputTypesMap.get(canonicalPath)

            if (outputType === undefined) {
                return false
            }

            return isStringOutputType(outputType)
        },

        [metricGroupsForRendering, outputTypesVersion],
    )

    const metricNodes: TableColumnConfig<EvaluationRunTableRow>[] = useMemo(() => {
        if (supportsPreviewMetrics) {
            const evaluatorNodes = metricGroupsForRendering
                .map((group) => {
                    const groupColumnKey = `group:${group.id}`
                    const groupHandles = group.handles ?? null
                    const groupSlug = groupHandles?.slug ?? group.id
                    const groupEvaluatorId =
                        groupHandles?.id ??
                        groupHandles?.revisionId ??
                        groupHandles?.variantId ??
                        group.evaluatorId ??
                        null
                    const groupProjectId = groupHandles?.projectId ?? group.projectId ?? null
                    const sanitizedGroupLabel =
                        sanitizeGroupLabel(group.label) ?? group.label ?? group.id
                    // Filter out columns with outputType "string" as they cannot be aggregated
                    const filteredColumns = group.columns.filter(
                        (col) => !isMetricHidden(group.id, col.metricPath, col.outputType),
                    )
                    return {
                        title: withColumnVisibilityHeader(
                            groupColumnKey,
                            <MetricGroupHeader
                                slug={groupSlug}
                                evaluatorId={groupEvaluatorId}
                                fallbackLabel={sanitizedGroupLabel}
                                columnKey={groupColumnKey}
                                projectId={groupProjectId}
                            />,
                        ),
                        key: groupColumnKey,
                        visibilityLabel: sanitizedGroupLabel ?? groupColumnKey,
                        align: "left" as const,
                        children: filteredColumns.map((descriptor) => {
                            const normalizedLabel =
                                normalizeDescriptorLabelForGroup(
                                    descriptor.label,
                                    sanitizedGroupLabel,
                                    descriptor.evaluatorRef?.slug ?? groupSlug,
                                ) ?? descriptor.label

                            // Enrich descriptor with outputType from the cache if not already set
                            let enrichedOutputType = descriptor.outputType
                            if (!enrichedOutputType) {
                                const key = createEvaluatorOutputTypesKey(groupProjectId, groupSlug)
                                const outputTypesMap = getOutputTypesMap(key)
                                if (outputTypesMap.size > 0) {
                                    const metricName = descriptor.metricPath.includes(".")
                                        ? (descriptor.metricPath.split(".").pop() ??
                                          descriptor.metricPath)
                                        : descriptor.metricPath
                                    const canonicalPath = canonicalizeMetricKey(metricName)
                                    enrichedOutputType = outputTypesMap.get(canonicalPath) ?? null
                                }
                            }

                            const normalizedDescriptor = {
                                ...descriptor,
                                ...(normalizedLabel ? {label: normalizedLabel} : {}),
                                ...(enrichedOutputType ? {outputType: enrichedOutputType} : {}),
                            }
                            return {
                                title: (
                                    <MetricColumnHeader
                                        descriptor={normalizedDescriptor}
                                        fallbackEvaluatorLabel={group.label}
                                        projectId={groupProjectId}
                                    />
                                ),
                                key: normalizedDescriptor.id,
                                visibilityLabel: deriveDescriptorLabel(
                                    normalizedDescriptor,
                                    sanitizedGroupLabel,
                                ),
                                width: normalizedDescriptor.width ?? 160,
                                ellipsis: true,
                                align: "left" as const,
                                exportLabel: formatMetricExportLabel(
                                    normalizedDescriptor,
                                    group.label,
                                ),
                                exportMetadata: {
                                    type: "metric",
                                    descriptor: normalizedDescriptor,
                                    groupLabel: sanitizedGroupLabel ?? group.label ?? null,
                                } satisfies EvaluationRunsColumnExportMetadata,
                                columnProps: {
                                    shouldCellUpdate: shouldUpdateMetricCell,
                                },
                                cell: createColumnVisibilityAwareCell<EvaluationRunTableRow>({
                                    columnKey: normalizedDescriptor.id,
                                    keepMounted: true,
                                    render: (record, _idx, isVisible) => (
                                        <RunMetricCellContent
                                            record={record}
                                            descriptor={normalizedDescriptor}
                                            isVisible={isVisible}
                                        />
                                    ),
                                    align: "left",
                                    className: "text-left",
                                }),
                            }
                        }),
                    }
                })
                .filter((group) => Array.isArray(group.children) && group.children.length > 0)

            const shouldShowInvocationMetrics =
                isAutoOrHuman ||
                evaluationKind === "online" ||
                evaluationKind === "all" ||
                evaluationKind === "custom"
            const invocationNode =
                invocationMetricDescriptors.length > 0 && shouldShowInvocationMetrics
                    ? {
                          title: withColumnVisibilityHeader("group:invocation", "Invocation"),
                          key: "group:invocation",
                          visibilityLabel: "Invocation",
                          align: "left" as const,
                          children: invocationMetricDescriptors.map((descriptor) => ({
                              title: <MetricColumnHeader descriptor={descriptor} />,
                              key: descriptor.id,
                              visibilityLabel:
                                  descriptor.label ?? descriptor.metricPath ?? descriptor.id,
                              width: descriptor.width ?? 160,
                              ellipsis: true,
                              align: "left" as const,
                              exportLabel: formatMetricExportLabel(descriptor, "Invocation"),
                              exportMetadata: {
                                  type: "metric",
                                  descriptor,
                                  groupLabel: "Invocation",
                              } satisfies EvaluationRunsColumnExportMetadata,
                              columnProps: {
                                  shouldCellUpdate: shouldUpdateMetricCell,
                              },
                              cell: createColumnVisibilityAwareCell<EvaluationRunTableRow>({
                                  columnKey: descriptor.id,
                                  keepMounted: true,
                                  render: (record, _idx, isVisible) => (
                                      <RunMetricCellContent
                                          record={record}
                                          descriptor={descriptor}
                                          isVisible={isVisible}
                                      />
                                  ),
                                  align: "left",
                                  className: "text-left",
                              }),
                          })),
                      }
                    : null

            return invocationNode ? [...evaluatorNodes, invocationNode] : evaluatorNodes
        }

        return METRIC_COLUMN_CONFIG[evaluationKind].map((descriptor) => ({
            title: <MetricColumnHeader descriptor={descriptor} />,
            key: descriptor.id,
            visibilityLabel: descriptor.label ?? descriptor.metricPath ?? descriptor.id,
            width: descriptor.width ?? 160,
            ellipsis: true,
            align: "left" as const,
            exportLabel: formatMetricExportLabel(descriptor),
            exportMetadata: {
                type: "metric",
                descriptor,
                groupLabel: null,
            } satisfies EvaluationRunsColumnExportMetadata,
            columnProps: {
                shouldCellUpdate: shouldUpdateMetricCell,
            },
            cell: createColumnVisibilityAwareCell<EvaluationRunTableRow>({
                columnKey: descriptor.id,
                keepMounted: true,
                render: (record, _idx, isVisible) => (
                    <RunMetricCellContent
                        record={record}
                        descriptor={descriptor}
                        isVisible={isVisible}
                    />
                ),
                align: "left",
                className: "text-left",
            }),
        }))
    }, [
        metricGroupsForRendering,
        invocationMetricDescriptors,
        evaluationKind,
        supportsPreviewMetrics,
        isAutoOrHuman,
        isMetricHidden,
    ])

    const columns = useMemo<ColumnsType<EvaluationRunTableRow>>(() => {
        const columnConfigs: TableColumnConfig<EvaluationRunTableRow>[] = []

        columnConfigs.push(
            {
                title: "Status",
                key: "status",
                width: 61,
                fixed: "left",
                visibilityLocked: true,
                align: "left",
                exportLabel: "Status",
                exportValue: resolveStatusForExport,
                columnProps: {
                    onHeaderCell: () => ({style: {minWidth: 56}}),
                    shouldCellUpdate: shouldUpdateStatusCell,
                },
                cell: createComponentCell<EvaluationRunTableRow>({
                    render: (record) => <PreviewStatusCell record={record} />,
                }),
            },
            {
                title: "Name",
                key: "name",
                width: 240,
                fixed: "left",
                visibilityLocked: true,
                align: "left",
                exportLabel: "Name",
                exportValue: resolveRunNameForExport,
                exportMetadata: {type: "runName"} satisfies EvaluationRunsColumnExportMetadata,
                columnProps: {
                    onHeaderCell: () => ({style: {minWidth: 200}}),
                    shouldCellUpdate: shouldUpdateNameCell,
                },
                cell: createComponentCell<EvaluationRunTableRow>({
                    render: (record) => <PreviewRunNameCell record={record} isVisible />,
                }),
            },
        )

        if (evaluationKind === "all") {
            columnConfigs.push({
                title: "Kind",
                key: "kind",
                width: 140,
                fixed: "left",
                align: "left",
                visibilityLocked: true,
                exportLabel: "Kind",
                exportValue: resolveEvaluationKindForExport,
                columnProps: {
                    onHeaderCell: () => ({style: {minWidth: 120}}),
                },
                cell: createComponentCell<EvaluationRunTableRow>({
                    render: (record) => <PreviewKindCell record={record} />,
                }),
            })
        }

        ensuredReferenceBlueprint
            .filter(
                (descriptor) => descriptor.role !== "evaluator" && descriptor.role !== "variant",
            )
            .forEach((descriptor) => {
                const columnKey = buildReferenceColumnKey(descriptor)
                const dimensions = REFERENCE_COLUMN_DIMENSIONS[descriptor.role]
                const visibilityLabel = getReferenceVisibilityLabel(descriptor)
                const columnBase: TableColumnConfig<EvaluationRunTableRow> = {
                    title: withColumnVisibilityHeader(columnKey, descriptor.label),
                    key: columnKey,
                    width: dimensions.width,
                    visibilityLabel,
                    align: "left",
                    exportLabel: descriptor.label,
                    exportValue: (record) => resolveReferenceExportValue(record, descriptor),
                    exportMetadata: {
                        type: "reference",
                        descriptor,
                    } satisfies EvaluationRunsColumnExportMetadata,
                    columnProps: {
                        onHeaderCell: () => ({style: {minWidth: dimensions.minWidth}}),
                        shouldCellUpdate:
                            descriptor.role === "application"
                                ? shouldUpdateApplicationCell
                                : descriptor.role === "variant"
                                  ? shouldUpdateVariantCell
                                  : descriptor.role === "evaluator"
                                    ? shouldUpdateEvaluatorCell
                                    : shouldUpdateReferenceCell,
                    },
                }

                const rendererFactory = REFERENCE_CELL_RENDERERS[descriptor.role]
                if (!rendererFactory) {
                    return
                }
                columnConfigs.push({
                    ...columnBase,
                    cell: createColumnVisibilityAwareCell<EvaluationRunTableRow>({
                        columnKey,
                        keepMounted: true,
                        render: rendererFactory(descriptor),
                    }),
                })
            })

        columnConfigs.push(...metricNodes)

        columnConfigs.push({
            title: <span className="whitespace-nowrap">Created on</span>,
            key: "createdAt",
            width: 200,
            align: "left",
            visibilityLocked: true,
            exportLabel: "Created on",
            exportValue: resolveCreatedAtForExport,
            columnProps: {
                onHeaderCell: () => ({style: {minWidth: 180}}),
                shouldCellUpdate: shouldUpdateCreatedAtCell,
            },
            cell: createComponentCell<EvaluationRunTableRow>({
                render: (record) => <PreviewCreatedCell record={record} isVisible />,
            }),
        })

        columnConfigs.push({
            title: <span className="whitespace-nowrap">Created by</span>,
            key: "createdBy",
            width: 200,
            align: "left",
            visibilityLocked: true,
            exportLabel: "Created by",
            exportMetadata: {type: "createdBy"} satisfies EvaluationRunsColumnExportMetadata,
            columnProps: {
                onHeaderCell: () => ({style: {minWidth: 180}}),
                shouldCellUpdate: shouldUpdateCreatedByCell,
            },
            cell: createComponentCell<EvaluationRunTableRow>({
                render: (record) => <PreviewCreatedByCell record={record} isVisible />,
            }),
        })

        columnConfigs.push({
            title: <ColumnVisibilityMenuTrigger variant="icon" />,
            key: "actions",
            width: 61,
            fixed: "right",
            visibilityLocked: true,
            align: "center",
            exportEnabled: false,
            columnProps: {
                onHeaderCell: () => ({style: {minWidth: 56}}),
                shouldCellUpdate: shouldUpdateRowKeyCell,
            },
            cell: createComponentCell<EvaluationRunTableRow>({
                render: (record) => (
                    <RunActionsCell
                        record={record}
                        onOpenDetails={onOpenDetails}
                        onVariantNavigation={onVariantNavigation}
                        onTestsetNavigation={onTestsetNavigation}
                        onRequestDelete={onRequestDelete}
                        resolveAppId={resolveAppId}
                        isVisible
                        onExportRow={onExportRow}
                        isExporting={rowExportingKey === record.key}
                    />
                ),
            }),
        })

        return createTableColumns<EvaluationRunTableRow>(columnConfigs)
    }, [
        evaluationKind,
        metricNodes,
        ensuredReferenceBlueprint,
        onOpenDetails,
        onVariantNavigation,
        onTestsetNavigation,
        onRequestDelete,
        resolveAppId,
        onExportRow,
        rowExportingKey,
    ])

    return columns
}

export {useEvaluationRunsColumns}
