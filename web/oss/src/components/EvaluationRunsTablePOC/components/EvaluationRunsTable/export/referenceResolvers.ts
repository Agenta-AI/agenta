import {useStore} from "jotai"

import {evaluationQueryRevisionAtomFamily} from "@/oss/components/EvalRunDetails2/atoms/query"
import type {EvaluationRunTableRow} from "@/oss/components/EvaluationRunsTablePOC/types"
import type {ReferenceColumnDescriptor} from "@/oss/components/EvaluationRunsTablePOC/utils/referenceSchema"
import {extractPrimaryInvocation} from "@/oss/components/pages/evaluations/utils"
import {
    appReferenceAtomFamily,
    evaluatorReferenceAtomFamily,
    previewTestsetReferenceAtomFamily,
    variantConfigAtomFamily,
} from "@/oss/components/References/atoms/entityReferences"
import {getUniquePartOfId} from "@/oss/lib/helpers/utils"

import {
    formatVariantRevisionLabel,
    getRecordIdentifiers,
    getReferenceLabelFromSlot,
    getReferenceSlot,
    logExportAction,
    normalizeString,
    sanitizeVariantName,
    stripVariantSuffix,
} from "./helpers"
import {getCamelRunFromStore, getPreviewRunSummaryFromStore} from "./store"

const resolveTestsetReferenceValue = (
    store: ReturnType<typeof useStore>,
    record: EvaluationRunTableRow,
    descriptor: ReferenceColumnDescriptor,
    defaultProjectId: string | null,
): string | undefined => {
    if (descriptor.role !== "testset") return undefined
    const slot = getReferenceSlot(record, descriptor)
    const testsetId = slot?.values?.[0]?.id ?? null
    const fallbackLabel = getReferenceLabelFromSlot(slot)
    const {projectId, runId} = getRecordIdentifiers(record, defaultProjectId)
    if (!testsetId) {
        logExportAction("testset reference missing id", {
            rowKey: record.key,
            projectId,
            runId,
        })
        return fallbackLabel ?? undefined
    }
    const summary = getPreviewRunSummaryFromStore(store, projectId, runId)
    const summaryName = summary?.testsetNames?.[testsetId] ?? null
    if (summaryName && summaryName.trim().length > 0) {
        logExportAction("resolved testset reference from summary", {
            rowKey: record.key,
            projectId,
            runId,
            testsetId,
            summaryName,
        })
        return summaryName
    }
    if (!projectId) {
        logExportAction("testset reference missing project id", {
            rowKey: record.key,
            runId,
            testsetId,
        })
        return fallbackLabel ?? undefined
    }
    try {
        const atom = previewTestsetReferenceAtomFamily({projectId, testsetId})
        const result = store.get(atom) as any
        const reference = result?.data ?? result ?? null
        const resolved = normalizeString(reference?.name)
        if (resolved) {
            logExportAction("resolved testset reference via atom", {
                rowKey: record.key,
                projectId,
                testsetId,
                resolved,
            })
        } else {
            logExportAction("testset reference atom missing name, using fallback", {
                rowKey: record.key,
                projectId,
                testsetId,
            })
        }
        return resolved ?? fallbackLabel ?? undefined
    } catch (error) {
        logExportAction("testset reference atom error", {projectId, testsetId, error})
        return fallbackLabel ?? undefined
    }
}

const resolveApplicationReferenceValue = (
    store: ReturnType<typeof useStore>,
    record: EvaluationRunTableRow,
    descriptor: ReferenceColumnDescriptor,
    defaultProjectId: string | null,
): string | undefined => {
    if (descriptor.role !== "application") return undefined
    const slot = getReferenceSlot(record, descriptor)
    const slotLabel = getReferenceLabelFromSlot(slot)
    const slotAppId = slot?.values?.[0]?.id ?? null
    const {projectId, runId} = getRecordIdentifiers(record, defaultProjectId)
    const summary = getPreviewRunSummaryFromStore(store, projectId, runId)
    const recordAppId =
        typeof record.appId === "string" && record.appId.trim().length > 0 ? record.appId : null
    const appId = slotAppId ?? summary?.appId ?? recordAppId
    if (!projectId || !appId) {
        logExportAction("application reference missing identifiers", {
            rowKey: record.key,
            projectId,
            appId,
        })
        return slotLabel ?? appId ?? undefined
    }
    try {
        const atom = appReferenceAtomFamily({projectId, appId})
        const queryResult = store.get(atom) as any
        const reference = queryResult?.data ?? queryResult ?? null
        const resolved =
            normalizeString(reference?.name) ??
            normalizeString(reference?.slug) ??
            normalizeString(reference?.id) ??
            slotLabel ??
            appId ??
            undefined
        logExportAction("resolved application reference for export", {
            rowKey: record.key,
            projectId,
            appId,
            resolved,
        })
        return resolved
    } catch (error) {
        logExportAction("application reference atom error", {projectId, appId, error})
        return slotLabel ?? appId ?? undefined
    }
}

const resolveVariantReferenceValue = (
    store: ReturnType<typeof useStore>,
    record: EvaluationRunTableRow,
    descriptor: ReferenceColumnDescriptor,
    defaultProjectId: string | null,
): string | undefined => {
    if (descriptor.role !== "variant") return undefined
    const slot = getReferenceSlot(record, descriptor)
    const fallbackLabel = getReferenceLabelFromSlot(slot)
    const variantEntry =
        slot?.values?.find((value) => value.source?.toLowerCase().includes("variant")) ??
        slot?.values?.[0]
    const revisionEntry = slot?.values?.find((value) =>
        value.source?.toLowerCase().includes("revision"),
    )
    const {projectId, runId} = getRecordIdentifiers(record, defaultProjectId)
    const camelRun = getCamelRunFromStore(store, runId)
    const invocation = camelRun ? extractPrimaryInvocation(camelRun as any) : null
    const revisionId = revisionEntry?.id ?? invocation?.revisionId ?? variantEntry?.id ?? null
    const fallbackVariantId =
        (typeof invocation?.variantId === "string" && invocation.variantId.trim().length > 0
            ? invocation.variantId
            : null) ??
        variantEntry?.id ??
        revisionId
    const uniqueSuffix = fallbackVariantId ? getUniquePartOfId(fallbackVariantId) : null
    const invocationVariantName = sanitizeVariantName(
        invocation?.variantName ?? invocation?.appName,
    )

    if (!projectId || !revisionId) {
        logExportAction("variant reference missing identifiers", {
            rowKey: record.key,
            projectId,
            revisionId,
        })
        const normalized =
            invocationVariantName ??
            fallbackLabel ??
            (uniqueSuffix ? `Variant ${uniqueSuffix}` : fallbackVariantId) ??
            undefined
        return normalized
    }
    let config: any = null
    try {
        const atom = variantConfigAtomFamily({projectId, revisionId})
        const queryResult = store.get(atom) as any
        config = queryResult?.data ?? queryResult ?? null
    } catch (error) {
        logExportAction("variant reference atom error", {projectId, revisionId, error})
        config = null
    }

    const configVariantName = sanitizeVariantName(config?.variantName)
    const slotLabel =
        sanitizeVariantName(variantEntry?.label) ?? sanitizeVariantName(variantEntry?.slug)
    const sanitizedVariantName =
        configVariantName ?? slotLabel ?? invocationVariantName ?? fallbackLabel ?? null
    const normalizedVariantName =
        sanitizedVariantName && !isUuid(sanitizedVariantName)
            ? stripVariantSuffix(sanitizedVariantName, uniqueSuffix)
            : sanitizedVariantName
    const displayName = normalizedVariantName ?? (uniqueSuffix ? `Variant ${uniqueSuffix}` : null)
    const resolvedRevision = formatVariantRevisionLabel(
        (config?.revision as string | number | null | undefined) ??
            invocation?.revisionLabel ??
            invocation?.revisionId ??
            null,
    )
    const resolved =
        displayName && resolvedRevision
            ? `${displayName} ${resolvedRevision}`
            : (displayName ?? resolvedRevision ?? fallbackLabel ?? fallbackVariantId ?? undefined)
    logExportAction("resolved variant reference for export", {
        rowKey: record.key,
        projectId,
        revisionId,
        resolved,
    })
    return resolved
}

const resolveQueryReferenceValue = (
    store: ReturnType<typeof useStore>,
    record: EvaluationRunTableRow,
    descriptor: ReferenceColumnDescriptor,
    defaultProjectId: string | null,
): string | undefined => {
    if (descriptor.role !== "query") return undefined
    const slot = getReferenceSlot(record, descriptor)
    const fallbackLabel = getReferenceLabelFromSlot(slot)
    const {runId} = getRecordIdentifiers(record, defaultProjectId)
    if (!runId) {
        logExportAction("query reference missing run id", {rowKey: record.key})
        return fallbackLabel ?? undefined
    }
    try {
        const atom = evaluationQueryRevisionAtomFamily(runId)
        const queryResult = store.get(atom) as any
        const data = queryResult?.data ?? queryResult ?? null
        const reference = data?.reference ?? {}
        const revision = data?.revision ?? {}
        const resolved =
            normalizeString(reference?.querySlug ?? reference?.slug) ??
            normalizeString(reference?.queryId ?? reference?.id) ??
            normalizeString(revision?.slug ?? revision?.id) ??
            fallbackLabel ??
            undefined
        logExportAction("resolved query reference for export", {
            rowKey: record.key,
            runId,
            resolved,
        })
        return resolved
    } catch (error) {
        logExportAction("query reference atom error", {runId, error})
        return fallbackLabel ?? undefined
    }
}

const resolveEvaluatorReferenceValue = (
    store: ReturnType<typeof useStore>,
    record: EvaluationRunTableRow,
    descriptor: ReferenceColumnDescriptor,
    defaultProjectId: string | null,
): string | undefined => {
    if (descriptor.role !== "evaluator") return undefined
    const slot = getReferenceSlot(record, descriptor)
    const fallbackLabel = getReferenceLabelFromSlot(slot)
    const slotValue = slot?.values?.[0]
    const slugCandidate =
        slotValue?.slug ??
        slotValue?.label ??
        slotValue?.name ??
        descriptor.sampleOrigin ??
        descriptor.sampleStepType ??
        null
    const evaluatorId = slotValue?.id ?? null
    const {projectId} = getRecordIdentifiers(record, defaultProjectId)
    if (!projectId || (!slugCandidate && !evaluatorId)) {
        logExportAction("evaluator reference missing identifiers", {
            rowKey: record.key,
            projectId,
            slug: slugCandidate,
            evaluatorId,
        })
        return fallbackLabel ?? evaluatorId ?? undefined
    }
    try {
        const atom = evaluatorReferenceAtomFamily({
            projectId,
            slug: slugCandidate ?? undefined,
            id: evaluatorId ?? undefined,
        })
        const queryResult = store.get(atom) as any
        const reference = queryResult?.data ?? queryResult ?? null
        const resolved =
            normalizeString(reference?.name) ??
            normalizeString(reference?.slug) ??
            normalizeString(reference?.id) ??
            fallbackLabel ??
            evaluatorId ??
            undefined
        logExportAction("resolved evaluator reference for export", {
            rowKey: record.key,
            projectId,
            slug: slugCandidate,
            evaluatorId,
            resolved,
        })
        return resolved
    } catch (error) {
        logExportAction("evaluator reference atom error", {
            projectId,
            slug: slugCandidate,
            evaluatorId,
            error,
        })
        return fallbackLabel ?? evaluatorId ?? undefined
    }
}

export const resolveReferenceValueFromAtoms = (
    store: ReturnType<typeof useStore>,
    record: EvaluationRunTableRow,
    descriptor: ReferenceColumnDescriptor,
    defaultProjectId: string | null,
) => {
    if (!descriptor) return undefined
    switch (descriptor.role) {
        case "testset":
            return resolveTestsetReferenceValue(store, record, descriptor, defaultProjectId)
        case "application":
            return resolveApplicationReferenceValue(store, record, descriptor, defaultProjectId)
        case "variant":
            return resolveVariantReferenceValue(store, record, descriptor, defaultProjectId)
        case "query":
            return resolveQueryReferenceValue(store, record, descriptor, defaultProjectId)
        case "evaluator":
            return resolveEvaluatorReferenceValue(store, record, descriptor, defaultProjectId)
        default:
            return undefined
    }
}

export {
    resolveTestsetReferenceValue,
    resolveApplicationReferenceValue,
    resolveVariantReferenceValue,
    resolveQueryReferenceValue,
    resolveEvaluatorReferenceValue,
}
