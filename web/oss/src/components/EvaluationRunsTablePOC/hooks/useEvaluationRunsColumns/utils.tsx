import type {ReactNode} from "react"

import {humanizeMetricPath} from "@/oss/lib/evaluations/utils/metrics"
import {ColumnVisibilityHeader} from "@/oss/components/InfiniteVirtualTable"

import {EVALUATION_KIND_LABELS} from "../../constants"
import type {EvaluationRunTableRow} from "../../types"
import type {RunMetricDescriptor} from "../../types/runMetrics"
import {
    buildReferenceSequence,
    getSlotByRoleOrdinal,
    REFERENCE_ROLE_LABELS,
    type ReferenceColumnDescriptor,
    type ReferenceSlot,
} from "../../utils/referenceSchema"

import type {EvaluatorHandles, EvaluatorReferenceCandidate, RecordPath} from "./types"

const referenceSequenceCache = new WeakMap<
    EvaluationRunTableRow,
    ReturnType<typeof buildReferenceSequence>
>()

export const getValueAtPath = (source: unknown, path: RecordPath): unknown =>
    path.reduce<unknown>((current, segment) => {
        if (
            current === null ||
            current === undefined ||
            (typeof current !== "object" && typeof current !== "function")
        ) {
            return undefined
        }
        return (current as Record<string | number, unknown>)[segment]
    }, source)

export const createShouldCellUpdate =
    (...paths: RecordPath[]) =>
    (record: EvaluationRunTableRow, prevRecord: EvaluationRunTableRow) => {
        if (record === prevRecord) {
            return false
        }
        return paths.some(
            (path) => getValueAtPath(record, path) !== getValueAtPath(prevRecord, path),
        )
    }

export const normalizeString = (value: unknown): string | null => {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
}

export const resolveEvaluatorHandles = (
    refs: Record<string, any> | undefined | null,
): EvaluatorHandles => {
    if (!refs || typeof refs !== "object") {
        return {}
    }
    const evaluator = refs.evaluator ?? {}
    const evaluatorVariant = refs.evaluator_variant ?? refs.evaluatorVariant ?? {}
    const evaluatorRevision = refs.evaluator_revision ?? refs.evaluatorRevision ?? {}

    const slug =
        normalizeString(evaluator.slug) ??
        normalizeString(evaluator.key) ??
        normalizeString(evaluatorVariant.slug) ??
        normalizeString(evaluatorVariant.key) ??
        normalizeString(evaluatorRevision.slug) ??
        normalizeString(evaluatorRevision.key) ??
        null

    const name =
        normalizeString(evaluator.name) ??
        normalizeString(evaluatorVariant.name) ??
        normalizeString(evaluatorRevision.name) ??
        null

    const id = normalizeString(evaluator.id)
    const variantId = normalizeString(evaluatorVariant.id)
    const variantSlug =
        normalizeString(evaluatorVariant.slug) ?? normalizeString(evaluatorVariant.key) ?? null
    const revisionId = normalizeString(evaluatorRevision.id)
    const revisionSlug =
        normalizeString(evaluatorRevision.slug) ?? normalizeString(evaluatorRevision.key) ?? null

    return {
        slug,
        name,
        id,
        variantId,
        variantSlug,
        revisionId,
        revisionSlug,
    }
}

export const resolveEvaluatorReferenceCandidate = (
    refs: Record<string, unknown> | undefined | null,
): EvaluatorReferenceCandidate | null => {
    const evaluator = refs?.evaluator
    if (evaluator && typeof evaluator === "object") {
        return evaluator as EvaluatorReferenceCandidate
    }
    return null
}

export const mergeEvaluatorHandles = (
    base: EvaluatorHandles | null | undefined,
    incoming: EvaluatorHandles | null | undefined,
): EvaluatorHandles | null => {
    if (!incoming) return base ?? null
    if (!base) return {...incoming}
    return {
        slug: base.slug ?? incoming.slug,
        name: base.name ?? incoming.name,
        id: base.id ?? incoming.id,
        variantId: base.variantId ?? incoming.variantId,
        variantSlug: base.variantSlug ?? incoming.variantSlug,
        revisionId: base.revisionId ?? incoming.revisionId,
        revisionSlug: base.revisionSlug ?? incoming.revisionSlug,
        projectId: base.projectId ?? incoming.projectId,
    }
}

export const withColumnVisibilityHeader = (columnKey: string, content: ReactNode) => (
    <ColumnVisibilityHeader columnKey={columnKey}>{content}</ColumnVisibilityHeader>
)

export const sanitizeGroupLabel = (value?: string | null): string | null => {
    if (!value) return null
    const trimmed = value.trim()
    if (!trimmed.length) return null
    const match = trimmed.match(/^(.*?)(?:\s+([0-9a-f]{8,}))$/i)
    return match?.[1]?.trim() ?? trimmed
}

export const getReferenceVisibilityLabel = (descriptor: ReferenceColumnDescriptor) =>
    descriptor.label?.trim().length
        ? descriptor.label
        : (REFERENCE_ROLE_LABELS[descriptor.role] ?? descriptor.role)

export const stripPrefixIgnoreCase = (value: string, prefix?: string | null) => {
    if (!value) return null
    if (!prefix) return value.trim()
    const trimmedValue = value.trim()
    const trimmedPrefix = prefix.trim()
    if (!trimmedValue.length || !trimmedPrefix.length) return trimmedValue
    if (!trimmedValue.toLowerCase().startsWith(trimmedPrefix.toLowerCase())) return trimmedValue
    const remainder = trimmedValue.slice(trimmedPrefix.length).trim()
    return remainder.replace(/^[\s:.•-]+/, "").trim()
}

export const normalizeDescriptorLabelForGroup = (
    label?: string | null,
    groupLabel?: string | null,
    evaluatorSlug?: string | null,
) => {
    if (!label) return null
    const strippedByGroup = stripPrefixIgnoreCase(label, groupLabel)
    if (strippedByGroup && strippedByGroup !== label) {
        return strippedByGroup
    }
    const strippedBySlug = stripPrefixIgnoreCase(label, evaluatorSlug)
    if (strippedBySlug && strippedBySlug !== label) {
        return strippedBySlug
    }
    return label.trim()
}

export const normalizeExportText = (value: unknown): string | null => {
    if (value === null || value === undefined) return null
    if (typeof value === "string") {
        const trimmed = value.trim()
        return trimmed.length ? trimmed : null
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value)
    }
    return null
}

export const resolveRunNameForExport = (record: EvaluationRunTableRow): string => {
    const candidates: unknown[] = [
        (record as any)?.name,
        (record.legacy as any)?.name,
        record.runId,
        record.preview?.id,
        record.key,
    ]
    for (const candidate of candidates) {
        const normalized = normalizeExportText(candidate)
        if (normalized) return normalized
    }
    return ""
}

export const resolveStatusForExport = (record: EvaluationRunTableRow): string =>
    normalizeExportText(record.status) ?? ""

export const resolveCreatedAtForExport = (record: EvaluationRunTableRow): string => {
    if (!record.createdAt) return ""
    const date = new Date(record.createdAt)
    if (Number.isNaN(date.getTime())) {
        return record.createdAt
    }
    return date.toISOString()
}

const resolveKindForRecord = (
    record: EvaluationRunTableRow,
): keyof typeof EVALUATION_KIND_LABELS | null => {
    const explicitKind = record.evaluationKind
    if (explicitKind && EVALUATION_KIND_LABELS[explicitKind]) {
        return explicitKind
    }
    const metaKind = (record.previewMeta as any)?.evaluation_kind as string | undefined
    if (metaKind && EVALUATION_KIND_LABELS[metaKind as keyof typeof EVALUATION_KIND_LABELS]) {
        return metaKind as keyof typeof EVALUATION_KIND_LABELS
    }
    const sourceKind = (record as any)?.source_kind as string | undefined
    if (sourceKind && EVALUATION_KIND_LABELS[sourceKind as keyof typeof EVALUATION_KIND_LABELS]) {
        return sourceKind as keyof typeof EVALUATION_KIND_LABELS
    }
    return null
}

export const resolveEvaluationKindForExport = (record: EvaluationRunTableRow): string => {
    const kind = resolveKindForRecord(record)
    if (!kind) return ""
    return EVALUATION_KIND_LABELS[kind] ?? kind
}

const getReferenceSequenceForRecord = (record: EvaluationRunTableRow) => {
    const cached = referenceSequenceCache.get(record)
    if (cached) return cached
    const sequence = buildReferenceSequence(record.previewMeta ?? null)
    referenceSequenceCache.set(record, sequence)
    return sequence
}

const formatReferenceEntry = (value: ReferenceSlot["values"][number]): string | null => {
    return (
        normalizeExportText(value.label) ??
        normalizeExportText(value.slug) ??
        normalizeExportText(value.name) ??
        normalizeExportText(value.id) ??
        null
    )
}

const findVariantSlotForApplication = (
    sequence: ReturnType<typeof buildReferenceSequence>,
    applicationSlot: ReferenceSlot | undefined,
    ordinal: number,
) => {
    if (!sequence?.length) {
        return undefined
    }
    if (applicationSlot) {
        const matchByStep = sequence.find(
            (slot) =>
                slot.role === "variant" &&
                slot.stepIndex === applicationSlot.stepIndex &&
                slot.stepKey === applicationSlot.stepKey,
        )
        if (matchByStep) {
            return matchByStep
        }
    }
    return getSlotByRoleOrdinal(sequence, "variant", ordinal)
}

const formatVariantSlotLabel = (slot: ReferenceSlot | undefined): string | null => {
    if (!slot?.values?.length) {
        return null
    }
    for (const value of slot.values) {
        const formatted = formatReferenceEntry(value)
        if (formatted) {
            return formatted
        }
    }
    return null
}

export const resolveReferenceExportValue = (
    record: EvaluationRunTableRow,
    descriptor: ReferenceColumnDescriptor,
): string => {
    if (!descriptor) return ""
    const sequence = getReferenceSequenceForRecord(record)
    const slot = getSlotByRoleOrdinal(sequence, descriptor.role, descriptor.roleOrdinal)
    if (!slot?.values?.length) {
        if (descriptor.role === "application") {
            return normalizeExportText(record.appId) ?? ""
        }
        return ""
    }
    const entry =
        slot.values
            .map((value) => formatReferenceEntry(value))
            .find((label): label is string => Boolean(label)) ?? null
    if (entry) {
        if (descriptor.role === "application") {
            const variantSlot = findVariantSlotForApplication(
                sequence,
                slot,
                descriptor.roleOrdinal,
            )
            const variantEntry = formatVariantSlotLabel(variantSlot)
            if (variantEntry) {
                return `${entry} • ${variantEntry}`
            }
        }
        return entry
    }
    if (descriptor.role === "application") {
        return normalizeExportText(record.appId) ?? ""
    }
    return ""
}

const resolveMetricLabel = (descriptor: RunMetricDescriptor): string => {
    return (
        descriptor.label ??
        humanizeMetricPath(descriptor.metricPath) ??
        descriptor.metricKey ??
        descriptor.id
    )
}

export const deriveDescriptorLabel = (
    descriptor: RunMetricDescriptor,
    groupLabel?: string | null,
): string => {
    const base = resolveMetricLabel(descriptor)
    if (!groupLabel) return base
    return `${groupLabel} • ${base}`
}

export const formatMetricExportLabel = (
    descriptor: RunMetricDescriptor,
    groupLabel?: string | null,
): string => {
    const metricLabel = resolveMetricLabel(descriptor)
    if (!groupLabel) return metricLabel
    return `${groupLabel} • ${metricLabel}`
}

export const areMetricGroupsEqual = (
    a: {id: string; projectId?: string | null; columns: RunMetricDescriptor[]}[],
    b: {id: string; projectId?: string | null; columns: RunMetricDescriptor[]}[],
) => {
    if (a === b) return true
    if (!a || !b) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
        if (a[i].id !== b[i].id) return false
        if ((a[i].projectId ?? null) !== (b[i].projectId ?? null)) return false
        const colsA = a[i].columns ?? []
        const colsB = b[i].columns ?? []
        if (colsA.length !== colsB.length) return false
        for (let j = 0; j < colsA.length; j += 1) {
            if (colsA[j].id !== colsB[j].id) return false
        }
    }
    return true
}
