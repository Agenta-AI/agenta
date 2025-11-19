import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {StepMeta} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import {canonicalizeMetricKey} from "@/oss/lib/metricUtils"

import {GeneralAutoEvalMetricColumns, GeneralHumanEvalMetricColumns} from "../../constants/table"
import {
    titleize,
    formatReferenceLabel,
    humanizeIdentifier,
    humanizeStepKey,
} from "../../utils/labelHelpers"

import {evaluationEvaluatorsByRunQueryAtomFamily} from "./evaluators"
import {evaluationRunQueryAtomFamily} from "./run"
import type {
    EvaluationColumnKind,
    EvaluationTableColumn,
    EvaluationTableColumnGroup,
    EvaluationTableColumnsResult,
    EvaluatorDefinition,
} from "./types"

interface RawMapping {
    step?: {
        key?: unknown
        path?: unknown
    }
    column?: {
        kind?: unknown
        name?: unknown
    }
}

const isMappingPayload = (
    mapping: RawMapping,
): mapping is {
    step: {
        key: string
        path: string
    }
    column: {
        kind: EvaluationColumnKind
        name: string
    }
} => {
    const stepKey = typeof mapping?.step?.key === "string"
    const stepPath = typeof mapping?.step?.path === "string"
    const columnName = typeof mapping?.column?.name === "string"
    const columnKind =
        mapping?.column?.kind === "testset" ||
        mapping?.column?.kind === "query" ||
        mapping?.column?.kind === "invocation" ||
        mapping?.column?.kind === "annotation" ||
        mapping?.column?.kind === "evaluator"

    return Boolean(stepKey && stepPath && columnName && columnKind)
}

const splitPath = (path: string) => path.split(".").filter(Boolean)

const METRIC_TYPE_FALLBACK = "string"

const createMetaColumns = (options?: {includeAction?: boolean}): EvaluationTableColumn[] => {
    const columns: EvaluationTableColumn[] = [
        {
            id: "meta:scenario-index-status",
            label: "#",
            displayLabel: "#",
            kind: "meta",
            path: "scenarioIndex",
            pathSegments: ["scenarioIndex"],
            stepType: "meta",
            order: 0,
            width: 72,
            minWidth: 72,
            sticky: "left",
            visibleFor: ["auto", "human"],
            metaRole: "scenarioIndexStatus",
            isSortable: false,
        },
    ]

    if (options?.includeAction ?? true) {
        columns.push({
            id: "meta:action",
            label: "Actions",
            displayLabel: "Actions",
            kind: "meta",
            path: "action",
            pathSegments: ["action"],
            stepType: "meta",
            order: 10_000,
            width: 140,
            minWidth: 140,
            sticky: "right",
            visibleFor: ["auto", "human"],
            metaRole: "action",
            isSortable: false,
        })
    }

    return columns
}

const widthByStepType: Record<string, number> = {
    input: 400,
    invocation: 400,
    annotation: 160,
}

type StepRole = "input" | "invocation" | "query"

type StepGroupInfo = {
    id: string
    label: string
    kind: "input" | "invocation"
    columns: EvaluationTableColumn[]
    order: number
    meta?: {
        stepRole: StepRole
        stepKey?: string
        refs?: Record<string, any>
    }
}

const deriveStepGroupLabel = (role: StepRole, stepMeta?: StepMeta): string => {
    const refs = stepMeta?.refs ?? {}

    if (role === "input") {
        if (refs.testset) {
            const label = formatReferenceLabel(refs.testset)
            return label ? `Testset ${label}` : "Testset"
        }

        if (refs.query) {
            const baseLabel =
                formatReferenceLabel(refs.query) ?? humanizeStepKey(stepMeta?.key, "Query")
            const variantLabel = formatReferenceLabel(refs.query_variant)
            const revisionVersion = refs.query_revision?.version
            const revisionLabel =
                revisionVersion !== undefined && revisionVersion !== null
                    ? `Rev ${revisionVersion}`
                    : formatReferenceLabel(refs.query_revision)

            const parts: string[] = [`Query ${baseLabel}`]
            if (variantLabel && variantLabel !== baseLabel) {
                parts.push(`Variant ${variantLabel}`)
            }
            if (revisionLabel) {
                parts.push(revisionLabel.startsWith("Rev") ? revisionLabel : `Rev ${revisionLabel}`)
            }
            return parts.join(" · ")
        }
    } else if (role === "invocation") {
        const applicationLabel =
            formatReferenceLabel(refs.application) ??
            formatReferenceLabel(refs.agent) ??
            formatReferenceLabel(refs.tool)
        const variantLabel = formatReferenceLabel(refs.application_variant)
        const revisionVersion = refs.application_revision?.version
        const revisionLabel =
            revisionVersion !== undefined && revisionVersion !== null
                ? `Rev ${revisionVersion}`
                : formatReferenceLabel(refs.application_revision)

        const parts: string[] = []
        if (applicationLabel) {
            parts.push(`Application ${applicationLabel}`)
        }
        if (variantLabel && variantLabel !== applicationLabel) {
            parts.push(`Variant ${variantLabel}`)
        }
        if (revisionLabel) {
            parts.push(revisionLabel.startsWith("Rev") ? revisionLabel : `Rev ${revisionLabel}`)
        }
        if (parts.length) {
            return parts.join(" · ")
        }
    } else if (role === "query") {
        const baseLabel =
            formatReferenceLabel(refs.query) ??
            formatReferenceLabel(refs.query_revision) ??
            humanizeStepKey(
                refs.query?.slug ?? refs.query_revision?.slug ?? refs.query?.id,
                "Query",
            )
        if (baseLabel) {
            const variantLabel = formatReferenceLabel(refs.query_variant)
            const revisionVersion = refs.query_revision?.version
            const revisionLabel =
                revisionVersion !== undefined && revisionVersion !== null
                    ? `Rev ${revisionVersion}`
                    : formatReferenceLabel(refs.query_revision)

            const parts: string[] = [`Query ${baseLabel}`]
            if (variantLabel && variantLabel !== baseLabel) {
                parts.push(`Variant ${variantLabel}`)
            }
            if (revisionLabel && revisionLabel !== baseLabel) {
                parts.push(revisionLabel.startsWith("Rev") ? revisionLabel : `Rev ${revisionLabel}`)
            }
            return parts.join(" · ")
        }
    }

    return humanizeStepKey(stepMeta?.key, role)
}

const registerStepGroup = ({
    column,
    stepMeta,
    role,
    registry,
    groupIdOverride,
    groupKindOverride,
    labelOverride,
}: {
    column: EvaluationTableColumn
    stepMeta?: StepMeta
    role: StepRole
    registry: Map<string, StepGroupInfo>
    groupIdOverride?: string
    groupKindOverride?: EvaluationTableColumnGroup["kind"]
    labelOverride?: string
}) => {
    const key = stepMeta?.key ?? column.stepKey ?? `${role}:unknown`
    const groupId = groupIdOverride ?? `${role}:${key}`
    column.groupId = groupId

    const order = column.order ?? (role === "invocation" ? 200 : 100)
    const existing = registry.get(groupId)
    if (existing) {
        existing.columns.push(column)
        existing.order = Math.min(existing.order, order)
        return
    }

    registry.set(groupId, {
        id: groupId,
        label: labelOverride ?? deriveStepGroupLabel(role, stepMeta),
        kind: groupKindOverride ?? (role === "invocation" ? "invocation" : "input"),
        columns: [column],
        order,
        meta: {
            stepRole: role,
            stepKey: stepMeta?.key ?? column.stepKey,
            refs: stepMeta?.refs ?? {},
        },
    })
}

const buildDefaultResult = (
    metaColumns: EvaluationTableColumn[],
): EvaluationTableColumnsResult => ({
    columns: metaColumns,
    groups: [],
    staticMetricColumns: {
        auto: GeneralAutoEvalMetricColumns,
        human: GeneralHumanEvalMetricColumns,
    },
    evaluators: [],
    ungroupedColumns: metaColumns,
})

const tableColumnsBaseAtomFamily = atomFamily((runId: string | null) =>
    atom((get) => {
        const fallbackMetaColumns = createMetaColumns({includeAction: true})
        if (!runId) {
            return buildDefaultResult(fallbackMetaColumns)
        }

        const runQuery = get(evaluationRunQueryAtomFamily(runId))
        const runData = runQuery.data
        if (!runData) {
            return buildDefaultResult(fallbackMetaColumns)
        }

        const stepMetas = Object.values(runData.runIndex.steps ?? {})
        const hasHumanInvocation = stepMetas.some(
            (meta) => meta.kind === "invocation" && meta.origin === "human",
        )
        const hasHumanAnnotation = stepMetas.some(
            (meta) => meta.kind === "annotation" && meta.origin === "human",
        )
        const includeActionColumn = hasHumanInvocation || hasHumanAnnotation

        const metaColumns = createMetaColumns({includeAction: includeActionColumn})

        const evaluatorQuery = get(evaluationEvaluatorsByRunQueryAtomFamily(runId))
        const evaluators = evaluatorQuery?.data ?? []

        const mappings = Array.isArray(runData.camelRun?.data?.mappings)
            ? runData.camelRun.data.mappings
            : []

        const counters: Record<"input" | "invocation" | "annotation", number> = {
            input: 0,
            invocation: 0,
            annotation: 0,
        }

        const stepGroups = new Map<string, StepGroupInfo>()

        const dynamicColumns: EvaluationTableColumn[] = mappings
            .filter(isMappingPayload)
            .filter((mapping) => !mapping.column.name.includes("_dedup_id"))
            .flatMap((mapping) => {
                const stepMeta = runData.runIndex.steps[mapping.step.key]
                const stepType = stepMeta?.kind ?? "annotation"
                const pathSegments = splitPath(mapping.step.path)
                const valueKey = pathSegments[pathSegments.length - 1] ?? mapping.column.name
                if (mapping.column.kind === "query") {
                    const buildQueryColumn = ({
                        suffix,
                        path,
                        stepRole,
                    }: {
                        suffix: string
                        path: string
                        stepRole: "input" | "invocation"
                    }): EvaluationTableColumn => {
                        const queryOrderBase = stepRole === "input" ? 100 : 200
                        const queryOrder =
                            queryOrderBase + counters[stepRole as keyof typeof counters]++
                        const resolvedPath = path
                        const resolvedPathSegments = splitPath(resolvedPath)
                        const resolvedValueKey =
                            resolvedPathSegments[resolvedPathSegments.length - 1] ?? valueKey
                        const columnLabel = titleize(suffix)
                        return {
                            id: `${mapping.step.key}:query:${suffix}`,
                            label: columnLabel,
                            displayLabel: columnLabel,
                            kind: mapping.column.kind as EvaluationColumnKind,
                            stepKey: mapping.step.key,
                            path: resolvedPath,
                            pathSegments: resolvedPathSegments,
                            stepType: stepRole,
                            valueKey: resolvedValueKey,
                            order: queryOrder,
                            width: widthByStepType[stepRole] ?? widthByStepType.input,
                            minWidth: widthByStepType[stepRole] ?? widthByStepType.input,
                        }
                    }

                    const basePath = mapping.step.path
                    const inputPath = basePath.endsWith(".inputs") ? basePath : `${basePath}.inputs`
                    const outputPath = basePath.endsWith(".outputs")
                        ? basePath
                        : `${basePath}.outputs`

                    const queryColumns = [
                        buildQueryColumn({
                            suffix: "inputs",
                            path: inputPath,
                            stepRole: "input",
                        }),
                        buildQueryColumn({
                            suffix: "outputs",
                            path: outputPath,
                            stepRole: "invocation",
                        }),
                    ]

                    const queryGroupId = `query:${mapping.step.key}`
                    queryColumns.forEach((column) =>
                        registerStepGroup({
                            column,
                            stepMeta,
                            role: "query",
                            registry: stepGroups,
                            groupIdOverride: queryGroupId,
                            groupKindOverride: "input",
                        }),
                    )

                    return queryColumns
                }

                const canonicalMetricKey =
                    stepType === "annotation" ? canonicalizeMetricKey(mapping.step.path) : undefined
                const orderBase = stepType === "input" ? 100 : stepType === "invocation" ? 200 : 300
                const order = orderBase + counters[stepType as keyof typeof counters]++
                const columnId = `${mapping.column.kind}:${mapping.column.name}:${order}`
                const width = widthByStepType[stepType] ?? undefined
                const evaluatorRef = stepMeta?.refs?.evaluator

                const baseColumn: EvaluationTableColumn = {
                    id: columnId,
                    label: mapping.column.name,
                    displayLabel: titleize(mapping.column.name),
                    kind: mapping.column.kind as EvaluationColumnKind,
                    stepKey: mapping.step.key,
                    path: mapping.step.path,
                    pathSegments,
                    stepType,
                    valueKey,
                    metricKey:
                        canonicalMetricKey ?? (stepType === "annotation" ? valueKey : undefined),
                    evaluatorId: evaluatorRef?.id,
                    evaluatorSlug: evaluatorRef?.slug,
                    order,
                    width,
                    minWidth: width,
                    groupId:
                        stepType === "annotation"
                            ? evaluatorRef?.id
                                ? `annotation:${evaluatorRef.id}`
                                : "annotations"
                            : undefined,
                }

                if (baseColumn.stepType === "input" || baseColumn.stepType === "invocation") {
                    registerStepGroup({
                        column: baseColumn,
                        stepMeta,
                        role: baseColumn.stepType,
                        registry: stepGroups,
                    })
                }

                return [baseColumn]
            })

        const evaluatorById = new Map(evaluators.map((definition) => [definition.id, definition]))

        const annotationGroups = new Map<
            string,
            {label: string; columns: EvaluationTableColumn[]}
        >()

        const enrichedDynamicColumns = dynamicColumns.map((column) => {
            if (column.stepType !== "annotation") {
                return column
            }

            const evaluator = column.evaluatorId ? evaluatorById.get(column.evaluatorId) : undefined
            const metricKey = column.metricKey || column.valueKey
            const metricDefinition = evaluator?.metrics.find(
                (metric) => metric.name === metricKey || metric.path === metricKey,
            )
            const metricType =
                metricDefinition?.metricType || column.metricType || METRIC_TYPE_FALLBACK
            const evaluatorLabel = evaluator?.name || column.evaluatorSlug || "Annotations"
            const groupKey = column.evaluatorId ? `annotation:${column.evaluatorId}` : "annotations"

            const groupLabel = titleize(String(evaluatorLabel))
            if (!annotationGroups.has(groupKey)) {
                annotationGroups.set(groupKey, {label: groupLabel, columns: []})
            }

            const enrichedColumn: EvaluationTableColumn = {
                ...column,
                metricKey,
                metricType,
                evaluatorName: evaluator?.name,
                displayLabel: metricDefinition?.displayLabel || column.displayLabel || column.label,
                description: metricDefinition?.description || column.description,
                groupId: groupKey,
            }

            annotationGroups.get(groupKey)?.columns.push(enrichedColumn)
            return enrichedColumn
        })

        const combinedColumns = [...metaColumns, ...enrichedDynamicColumns]

        const groups: EvaluationTableColumnGroup[] = []
        const pushGroup = (
            id: string,
            label: string,
            kind: EvaluationTableColumnGroup["kind"],
            columns: EvaluationTableColumn[],
            order: number,
            extra?: Partial<EvaluationTableColumnGroup>,
        ) => {
            if (!columns.length) return
            groups.push({
                id,
                label,
                kind,
                columnIds: columns.map((column) => column.id),
                order,
                ...extra,
            })
        }
        const stepGroupEntries = Array.from(stepGroups.values()).sort(
            (a, b) => (a.order ?? 0) - (b.order ?? 0),
        )
        stepGroupEntries.forEach((groupInfo) => {
            pushGroup(
                groupInfo.id,
                groupInfo.label,
                groupInfo.kind,
                groupInfo.columns,
                groupInfo.order,
                groupInfo.meta ? {meta: groupInfo.meta} : undefined,
            )
        })

        const maxStepOrder = stepGroupEntries.length
            ? Math.max(...stepGroupEntries.map((entry) => entry.order ?? 0))
            : 200
        let annotationOrder = maxStepOrder + 100

        annotationGroups.forEach((group, key) => {
            pushGroup(key, group.label, "annotation", group.columns, annotationOrder)
            annotationOrder += 1
        })

        if (GeneralAutoEvalMetricColumns.length) {
            groups.push({
                id: "metrics:auto",
                // label: "Metrics (Auto)",
                label: "Metrics",
                kind: "metric",
                columnIds: [],
                order: annotationOrder,
                staticMetricColumns: GeneralAutoEvalMetricColumns,
            })
            annotationOrder += 1
        }

        if (GeneralHumanEvalMetricColumns.length) {
            groups.push({
                id: "metrics:human",
                label: "Metrics (Human)",
                kind: "metric",
                columnIds: [],
                order: annotationOrder,
                staticMetricColumns: GeneralHumanEvalMetricColumns,
            })
            annotationOrder += 1
        }

        groups.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

        const sortedColumns = [...combinedColumns].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

        const groupedIds = new Set<string>()
        groups.forEach((group) => group.columnIds.forEach((id) => groupedIds.add(id)))
        const ungroupedColumns = sortedColumns.filter((column) => !groupedIds.has(column.id))

        return {
            columns: sortedColumns,
            groups,
            staticMetricColumns: {
                auto: GeneralAutoEvalMetricColumns,
                human: GeneralHumanEvalMetricColumns,
            },
            evaluators,
            ungroupedColumns,
        }
    }),
)

export const tableColumnsAtomFamily = atomFamily((runId: string | null) =>
    atom((get) => get(tableColumnsBaseAtomFamily(runId))),
)
