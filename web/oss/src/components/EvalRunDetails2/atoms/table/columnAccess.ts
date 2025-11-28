import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {RunIndex} from "@/oss/lib/evaluations/buildRunIndex"

import {splitPath} from "../../utils/valueAccess"

import {tableColumnsAtomFamily} from "./columns"
import {evaluationRunIndexAtomFamily} from "./run"
import type {EvaluationTableColumn} from "./types"

interface AnnotationDescriptor {
    metricPathCandidates: string[][]
    segmentVariants: string[][]
    coerceBoolean: boolean
}

interface InvocationDescriptor {
    traceValueCandidates: {path: string; valueKey?: string}[]
}

export interface ColumnValueDescriptor {
    columnId: string
    columnKind: EvaluationTableColumn["kind"]
    stepType: EvaluationTableColumn["stepType"]
    stepKey?: string
    path: string
    pathSegments: string[]
    valueKey?: string
    metricKey?: string
    metricType?: string
    preferTestcase?: boolean
    annotation?: AnnotationDescriptor
    invocation?: InvocationDescriptor
}

export type ColumnDescriptorInput = Pick<
    EvaluationTableColumn,
    | "id"
    | "kind"
    | "stepType"
    | "stepKey"
    | "path"
    | "pathSegments"
    | "valueKey"
    | "metricKey"
    | "metricType"
>

const buildMetricPathCandidates = (column: ColumnDescriptorInput): string[][] => {
    const candidates: string[][] = []
    const seen = new Set<string>()

    const push = (segments: string[]) => {
        if (!segments.length) return
        const signature = segments.join(".")
        if (seen.has(signature)) return
        seen.add(signature)
        candidates.push(segments)
    }

    if (typeof column.metricKey === "string" && column.metricKey.trim().length) {
        push(column.metricKey.split(".").filter(Boolean))
    }
    if (typeof column.valueKey === "string" && column.valueKey.trim().length) {
        push(column.valueKey.split(".").filter(Boolean))
    }

    const pathSegments = column.pathSegments ?? splitPath(column.path)
    const lastSegment = pathSegments[pathSegments.length - 1]
    if (lastSegment) {
        push([lastSegment])
    }

    return candidates
}

const buildAnnotationSegmentVariants = (pathSegments: string[]): string[][] => {
    if (!pathSegments.length) return []

    const variants: string[][] = []
    const seen = new Set<string>()
    const push = (segments: string[]) => {
        const signature = segments.join(".")
        if (!segments.length || seen.has(signature)) return
        seen.add(signature)
        variants.push(segments)
    }

    push(pathSegments)
    if (pathSegments[0] === "annotation") {
        push(pathSegments.slice(1))
    }
    if (pathSegments[0] === "attributes" && pathSegments[1] === "ag") {
        push(pathSegments.slice(2))
    }
    if (pathSegments[0] === "attributes") {
        push(pathSegments.slice(1))
    }

    return variants
}

const inferBooleanMetric = (column: EvaluationTableColumn): boolean => {
    const metricType = column.metricType?.toLowerCase() ?? ""
    const path = column.path.toLowerCase()
    const valueKey = column.valueKey?.toLowerCase() ?? ""
    const metricKey = column.metricKey?.toLowerCase() ?? ""

    if (metricType === "boolean") return true
    if (valueKey.includes("success") || valueKey.includes("passed")) return true
    if (metricKey.includes("success") || metricKey.includes("passed")) return true
    if (path.includes("success") || path.includes("passed")) return true
    return false
}

const buildInvocationDescriptor = (column: ColumnDescriptorInput): InvocationDescriptor => ({
    traceValueCandidates: [
        {
            path: column.path,
            valueKey: column.valueKey,
        },
    ],
})

const buildAnnotationDescriptor = (column: ColumnDescriptorInput): AnnotationDescriptor => {
    const pathSegments = column.pathSegments ?? splitPath(column.path)
    return {
        metricPathCandidates: buildMetricPathCandidates(column),
        segmentVariants: buildAnnotationSegmentVariants(pathSegments),
        coerceBoolean: inferBooleanMetric(column),
    }
}

export const createColumnValueDescriptor = (
    column: ColumnDescriptorInput,
    runIndex: RunIndex | null | undefined,
): ColumnValueDescriptor => {
    const stepMeta = column.stepKey ? runIndex?.steps?.[column.stepKey] : null
    const descriptor: ColumnValueDescriptor = {
        columnId: column.id,
        columnKind: column.kind,
        stepType: column.stepType,
        stepKey: column.stepKey,
        path: column.path,
        pathSegments: column.pathSegments ?? splitPath(column.path),
        valueKey: column.valueKey,
        metricKey: column.metricKey,
        metricType: column.metricType,
        preferTestcase: Boolean(stepMeta?.refs?.testset?.id),
    }

    if (column.stepType === "invocation") {
        descriptor.invocation = buildInvocationDescriptor(column)
    }

    if (column.stepType === "annotation") {
        descriptor.annotation = buildAnnotationDescriptor(column)
    }

    return descriptor
}

export const columnValueDescriptorMapAtomFamily = atomFamily((runId: string | null) =>
    atom<Record<string, ColumnValueDescriptor>>((get) => {
        const columnResult = get(tableColumnsAtomFamily(runId))
        const runIndex = get(evaluationRunIndexAtomFamily(runId))

        const map: Record<string, ColumnValueDescriptor> = {}
        columnResult.columns.forEach((column) => {
            map[column.id] = createColumnValueDescriptor(column, runIndex)
        })

        return map
    }),
)
