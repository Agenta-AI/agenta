import {injectedEvaluatorReferenceFamilyAtom} from "@agenta/evaluations/state"
import {previewRunMetricStatsSelectorFamily} from "@agenta/evaluations/state/evalRun"
import type {EvaluationRunTableRow} from "@agenta/evaluations/state/runsTable"
import type {RunMetricDescriptor} from "@agenta/evaluations/state/runsTable"
import type {BasicStats} from "@agenta/shared/metrics"
import {useStore} from "jotai"

import {
    formatEvaluatorMetricValue,
    formatInvocationMetricValue,
} from "../../../assets/runMetricFormatters"
import {formatMetricExportLabel} from "../../../hooks/useEvaluationRunsColumns"

import {logExportAction, normalizeString} from "./helpers"

export const resolveMetricExportValue = (
    store: ReturnType<typeof useStore>,
    record: EvaluationRunTableRow,
    descriptor: RunMetricDescriptor,
): string | undefined => {
    const runIdRaw = record.preview?.id ?? record.runId ?? null
    if (!runIdRaw) return undefined
    const runScopedMetricPath = descriptor.metricPathsByRunId?.[runIdRaw] ?? descriptor.metricPath
    const runScopedStepKey = descriptor.stepKeysByRunId?.[runIdRaw] ?? descriptor.stepKey
    const metricKeyForSelection =
        descriptor.kind === "evaluator" &&
        (descriptor.metricPathsByRunId || descriptor.stepKeysByRunId) &&
        !runScopedMetricPath &&
        !runScopedStepKey
            ? undefined
            : descriptor.metricKey

    const selector = previewRunMetricStatsSelectorFamily({
        runId: runIdRaw,
        metricKey: metricKeyForSelection,
        metricPath: runScopedMetricPath,
        stepKey: runScopedStepKey,
        includeTemporal: false,
    })
    const selection = store.get(selector)
    if (!selection || selection.state !== "hasData") {
        return undefined
    }
    const stats = selection.stats as BasicStats | undefined
    if (
        descriptor.kind === "evaluator" &&
        (descriptor.metricPathsByRunId || descriptor.stepKeysByRunId) &&
        !runScopedMetricPath &&
        !runScopedStepKey
    ) {
        return "—"
    }
    if (!runScopedMetricPath && descriptor.kind !== "invocation") {
        return formatEvaluatorMetricValue(stats, descriptor.metricPath)
    }
    if (descriptor.kind === "invocation") {
        return formatInvocationMetricValue(
            runScopedMetricPath ?? descriptor.metricPath ?? "",
            stats,
        )
    }
    return formatEvaluatorMetricValue(stats, runScopedMetricPath ?? descriptor.metricPath)
}

const resolveMetricGroupLabelForExport = (
    store: ReturnType<typeof useStore>,
    descriptor: RunMetricDescriptor,
    fallbackGroupLabel?: string | null,
) => {
    if (descriptor.kind !== "evaluator") {
        return fallbackGroupLabel ?? null
    }
    const evaluatorRef = descriptor.evaluatorRef ?? {}
    const slugCandidate =
        normalizeString(evaluatorRef.slug) ??
        normalizeString(evaluatorRef.variantSlug) ??
        normalizeString(evaluatorRef.revisionSlug) ??
        null
    const evaluatorId =
        normalizeString(evaluatorRef.id) ??
        normalizeString(evaluatorRef.revisionId) ??
        normalizeString(evaluatorRef.variantId) ??
        null
    const projectId = normalizeString(evaluatorRef.projectId)
    if (!projectId || (!slugCandidate && !evaluatorId)) {
        const fallback = fallbackGroupLabel ?? slugCandidate ?? evaluatorId ?? null
        logExportAction("metric header missing evaluator handles", {
            descriptorId: descriptor.id,
            projectId,
            slug: slugCandidate,
            evaluatorId,
        })
        return fallback
    }
    try {
        const evaluatorReferenceFamily = store.get(injectedEvaluatorReferenceFamilyAtom)
        if (!evaluatorReferenceFamily) {
            return fallbackGroupLabel ?? slugCandidate ?? evaluatorId ?? null
        }
        const atom = evaluatorReferenceFamily({
            projectId,
            slug: slugCandidate ?? undefined,
            id: evaluatorId ?? undefined,
        })
        const queryResult = store.get(atom)
        const reference = queryResult?.data ?? null
        const resolved =
            normalizeString(reference?.name) ??
            normalizeString(reference?.slug) ??
            normalizeString(reference?.id) ??
            fallbackGroupLabel ??
            slugCandidate ??
            evaluatorId ??
            null
        logExportAction("resolved evaluator header reference for export", {
            descriptorId: descriptor.id,
            projectId,
            slug: slugCandidate,
            evaluatorId,
            resolved,
        })
        return resolved
    } catch (error) {
        logExportAction("metric header evaluator atom error", {
            descriptorId: descriptor.id,
            projectId,
            slug: slugCandidate,
            evaluatorId,
            error,
        })
        return fallbackGroupLabel ?? slugCandidate ?? evaluatorId ?? null
    }
}

export const resolveMetricColumnExportLabel = (
    store: ReturnType<typeof useStore>,
    descriptor: RunMetricDescriptor,
    fallbackGroupLabel?: string | null,
) => {
    const groupLabel = resolveMetricGroupLabelForExport(store, descriptor, fallbackGroupLabel)
    const label = formatMetricExportLabel(descriptor, groupLabel ?? fallbackGroupLabel ?? null)
    logExportAction("resolved metric header label", {
        descriptorId: descriptor.id,
        groupLabel: groupLabel ?? fallbackGroupLabel ?? null,
        label,
    })
    return label
}
