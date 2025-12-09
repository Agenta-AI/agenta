import type {Key} from "react"

import type {EvaluationRunTableRow} from "@/oss/components/EvaluationRunsTablePOC/types"
import {
    buildReferenceSequence,
    getSlotByRoleOrdinal,
} from "@/oss/components/EvaluationRunsTablePOC/utils/referenceSchema"
import type {ReferenceColumnDescriptor} from "@/oss/components/EvaluationRunsTablePOC/utils/referenceSchema"
import {getUniquePartOfId, isUuid} from "@/oss/lib/helpers/utils"

export const normalizeString = (value: string | null | undefined) =>
    typeof value === "string" && value.trim().length ? value.trim() : null

export const logExportAction = (message: string, payload?: Record<string, unknown>) => {
    try {
        console.log(`[export_action] ${message}`, payload)
    } catch {
        // no-op
    }
}

export const toKeyString = (key: Key | null | undefined): string | null => {
    if (key === null || key === undefined) return null
    try {
        return String(key)
    } catch {
        return null
    }
}

export const getRecordIdentifiers = (
    record: EvaluationRunTableRow,
    defaultProjectId?: string | null,
) => {
    const runId =
        typeof record.preview?.id === "string" && record.preview.id.trim().length
            ? record.preview.id
            : typeof record.runId === "string" && record.runId.trim().length
              ? record.runId
              : null
    const projectId =
        typeof record.projectId === "string" && record.projectId.trim().length
            ? record.projectId
            : defaultProjectId && defaultProjectId.trim().length
              ? defaultProjectId
              : null
    return {runId, projectId}
}

export const sanitizeVariantName = (value: string | null | undefined) => {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

export const stripVariantSuffix = (name: string | null, suffix: string | null) => {
    if (!name) return null
    if (!suffix) return name
    const normalizedName = name.trim()
    const normalizedSuffix = suffix.trim().toLowerCase()
    if (!normalizedSuffix) return normalizedName
    const haystack = normalizedName.toLowerCase()
    const needle = `-${normalizedSuffix}`
    if (haystack.endsWith(needle)) {
        return normalizedName.slice(0, normalizedName.length - needle.length)
    }
    return normalizedName
}

export const formatVariantRevisionLabel = (revision: string | number | null | undefined) => {
    if (revision === null || revision === undefined) return null
    if (typeof revision === "number") return `v${revision}`
    const trimmed = revision.trim()
    if (!trimmed) return null
    if (/^v\d+$/i.test(trimmed)) {
        return trimmed.toLowerCase()
    }
    if (isUuid(trimmed)) {
        return getUniquePartOfId(trimmed)
    }
    return trimmed
}

export const getReferenceSlot = (
    record: EvaluationRunTableRow,
    descriptor: ReferenceColumnDescriptor,
) => {
    if (!descriptor) return null
    const sequence = buildReferenceSequence(record.previewMeta ?? null)
    return getSlotByRoleOrdinal(sequence, descriptor.role, descriptor.roleOrdinal)
}

export const getReferenceLabelFromSlot = (slot: ReturnType<typeof getReferenceSlot>) => {
    if (!slot?.values?.length) return null
    for (const value of slot.values) {
        const candidate =
            normalizeString(value.label) ??
            normalizeString(value.slug) ??
            normalizeString(value.name) ??
            normalizeString(value.id)
        if (candidate) return candidate
    }
    return null
}
