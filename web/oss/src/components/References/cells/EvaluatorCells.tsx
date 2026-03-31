import {useMemo} from "react"

import {
    useRunRowReferences,
    useRunRowSummary,
} from "@/oss/components/EvaluationRunsTablePOC/context/RunRowDataContext"
import type {EvaluationRunTableRow} from "@/oss/components/EvaluationRunsTablePOC/types"
import type {ReferenceColumnDescriptor} from "@/oss/components/EvaluationRunsTablePOC/utils/referenceSchema"
import {getSlotByRoleOrdinal} from "@/oss/components/EvaluationRunsTablePOC/utils/referenceSchema"
import SkeletonLine from "@/oss/components/InfiniteVirtualTable/components/common/SkeletonLine"
import {humanizeEvaluatorName} from "@/oss/lib/evaluations/utils/metrics"

import useEvaluatorReference from "../hooks/useEvaluatorReference"

const CELL_CLASS =
    "flex h-full w-full min-w-0 flex-col justify-center gap-1 px-2 whitespace-nowrap overflow-hidden"

export const PreviewEvaluatorCellSkeleton = () => <SkeletonLine width="60%" />

const normalizeLookupKey = (value: unknown) => {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed.length ? trimmed.toLowerCase() : null
}

const registerEvaluatorCandidate = (directory: Map<string, string>, candidate: any) => {
    if (!candidate || typeof candidate !== "object") return
    const preferred =
        (typeof candidate.name === "string" && candidate.name.trim()) ||
        (typeof candidate.label === "string" && candidate.label.trim()) ||
        (typeof candidate.displayName === "string" && candidate.displayName.trim()) ||
        null
    if (!preferred) return

    const idKey =
        normalizeLookupKey(candidate.id) ??
        normalizeLookupKey(candidate.evaluatorId) ??
        normalizeLookupKey(candidate.referenceId)
    if (idKey && !directory.has(idKey)) {
        directory.set(idKey, preferred)
    }
    const slugKey =
        normalizeLookupKey(candidate.slug) ??
        normalizeLookupKey(candidate.key) ??
        normalizeLookupKey(candidate.slugRef)
    if (slugKey && !directory.has(slugKey)) {
        directory.set(slugKey, preferred)
    }
}

const resolveEvaluatorLabel = (candidate: any): string | null => {
    if (!candidate || typeof candidate !== "object") return null
    const label =
        candidate.name ??
        candidate.label ??
        candidate.slug ??
        candidate.key ??
        candidate.id ??
        candidate.displayName ??
        null
    if (typeof label === "string" && label.trim().length > 0) {
        return label.trim()
    }
    return null
}

const getEvaluatorLabelFromStepReferences = (
    stepReferences: Record<string, unknown> | undefined,
    directory: Map<string, string>,
) => {
    if (!stepReferences || typeof stepReferences !== "object") {
        return null
    }
    for (const value of Object.values(stepReferences)) {
        if (!value || typeof value !== "object") continue
        const references = value as Record<string, unknown>
        const label =
            resolveCandidateLabel(references.evaluator, directory) ??
            resolveCandidateLabel(references.evaluator_ref, directory) ??
            resolveCandidateLabel(references.evaluatorRef, directory) ??
            resolveCandidateLabel(references.evaluator_revision, directory) ??
            resolveCandidateLabel(references.evaluatorRevision, directory)
        if (label) {
            return label
        }
    }
    return null
}

const collectEvaluatorDirectory = (
    record: EvaluationRunTableRow,
    extraCandidates: {id?: string | null; slug?: string | null; name?: string | null}[] = [],
) => {
    const directory = new Map<string, string>()

    const list = Array.isArray(record.previewMeta?.evaluators) ? record.previewMeta!.evaluators : []
    list.forEach((candidate) => registerEvaluatorCandidate(directory, candidate))

    const steps = Array.isArray(record.previewMeta?.steps) ? record.previewMeta!.steps : []
    steps.forEach((step) => {
        registerEvaluatorCandidate(directory, step?.references?.evaluator)
    })

    extraCandidates.forEach((candidate) => {
        if (!candidate) return
        registerEvaluatorCandidate(directory, candidate)
    })

    return directory
}

const resolveCandidateLabel = (candidate: any, directory: Map<string, string>): string | null => {
    if (!candidate || typeof candidate !== "object") return null
    const idKey =
        normalizeLookupKey(candidate.id) ??
        normalizeLookupKey(candidate.evaluatorId) ??
        normalizeLookupKey(candidate.referenceId)
    if (idKey && directory.has(idKey)) {
        return directory.get(idKey) ?? null
    }
    const slugKey =
        normalizeLookupKey(candidate.slug) ??
        normalizeLookupKey(candidate.key) ??
        normalizeLookupKey(candidate.slugRef)
    if (slugKey && directory.has(slugKey)) {
        return directory.get(slugKey) ?? null
    }
    return resolveEvaluatorLabel(candidate)
}

const getEvaluatorLabelFromMeta = (
    record: EvaluationRunTableRow,
    directory: Map<string, string>,
) => {
    const meta = record.previewMeta
    if (meta?.evaluators?.length) {
        for (const evaluator of meta.evaluators) {
            const label = resolveCandidateLabel(evaluator, directory)
            if (label) {
                return label
            }
        }
    }
    const metaSteps = Array.isArray(meta?.steps) ? meta.steps : []
    for (const step of metaSteps) {
        const refs = step?.references as Record<string, unknown> | undefined
        if (!refs) continue
        const label =
            resolveCandidateLabel(refs.evaluator, directory) ??
            resolveCandidateLabel(refs.evaluator_ref, directory) ??
            resolveCandidateLabel(refs.evaluatorRef, directory) ??
            resolveCandidateLabel(refs.evaluator_revision, directory) ??
            resolveCandidateLabel(refs.evaluatorRevision, directory)
        if (label) {
            return label
        }
    }
    return null
}

const getEvaluatorLabelFromMetaStep = (
    record: EvaluationRunTableRow,
    stepKey: string | null,
    directory: Map<string, string>,
) => {
    if (!stepKey) return null
    const metaSteps = Array.isArray(record.previewMeta?.steps) ? record.previewMeta!.steps : []
    const target = metaSteps.find((step) => step?.key === stepKey)
    if (!target) return null
    const refs = target.references as Record<string, unknown> | undefined
    if (!refs) return null
    return (
        resolveCandidateLabel(refs.evaluator, directory) ??
        resolveCandidateLabel(refs.evaluator_ref, directory) ??
        resolveCandidateLabel(refs.evaluatorRef, directory) ??
        resolveCandidateLabel(refs.evaluator_revision, directory) ??
        resolveCandidateLabel(refs.evaluatorRevision, directory) ??
        null
    )
}

const PreviewEvaluatorCellContent = ({
    record,
    isVisible,
    descriptor,
}: {
    record: EvaluationRunTableRow
    isVisible: boolean
    descriptor?: ReferenceColumnDescriptor
}) => {
    const {summary, isLoading: summaryLoading} = useRunRowSummary(record, isVisible)
    const referenceSequence = useRunRowReferences(record)

    const slot =
        descriptor && descriptor.role === "evaluator"
            ? getSlotByRoleOrdinal(referenceSequence, descriptor.role, descriptor.roleOrdinal)
            : null

    const slotValues = slot?.values ?? []
    const primarySlotValue =
        slotValues.find((value) => value?.source === "evaluator") ?? slotValues[0] ?? null

    const {reference: fetchedEvaluatorReference, isLoading: evaluatorReferenceLoading} =
        useEvaluatorReference(
            {
                projectId: record.projectId ?? null,
                evaluatorSlug: primarySlotValue?.slug ?? null,
                evaluatorId: primarySlotValue?.id ?? null,
            },
            {
                enabled:
                    Boolean(record.projectId) &&
                    Boolean(primarySlotValue) &&
                    Boolean((primarySlotValue?.slug ?? null) || (primarySlotValue?.id ?? null)),
            },
        )

    const evaluatorDirectory = useMemo(
        () =>
            collectEvaluatorDirectory(
                record,
                fetchedEvaluatorReference ? [fetchedEvaluatorReference] : [],
            ),
        [record, fetchedEvaluatorReference],
    )

    const resolveCandidate = (candidate: any) =>
        resolveCandidateLabel(candidate, evaluatorDirectory)

    const slotCandidate = primarySlotValue?.raw ?? primarySlotValue ?? null
    const slotLabel =
        resolveCandidate(slotCandidate) ?? primarySlotValue?.label ?? primarySlotValue?.slug ?? null
    const slotStepKey = slot?.stepKey ?? null

    const slotMetaLabel = useMemo(
        () => getEvaluatorLabelFromMetaStep(record, slotStepKey, evaluatorDirectory),
        [record, slotStepKey, evaluatorDirectory],
    )

    const slotSummaryLabel = useMemo(() => {
        if (!slotStepKey) return null
        const stepReferences = (summary?.stepReferences as Record<string, unknown> | undefined)?.[
            slotStepKey
        ]
        if (!stepReferences) return null
        return getEvaluatorLabelFromStepReferences(
            {[slotStepKey]: stepReferences},
            evaluatorDirectory,
        )
    }, [slotStepKey, summary?.stepReferences, evaluatorDirectory])

    const summaryLabel = useMemo(
        () =>
            slot
                ? getEvaluatorLabelFromStepReferences(summary?.stepReferences, evaluatorDirectory)
                : null,
        [slot, summary?.stepReferences, evaluatorDirectory],
    )
    const fallbackLabel = useMemo(
        () => (slot ? getEvaluatorLabelFromMeta(record, evaluatorDirectory) : null),
        [slot, record, evaluatorDirectory],
    )
    const rawLabel =
        fetchedEvaluatorReference?.name ??
        slotMetaLabel ??
        slotSummaryLabel ??
        slotLabel ??
        summaryLabel ??
        fallbackLabel ??
        (slot ? resolveCandidate(slotCandidate) : null) ??
        null
    const label = rawLabel ? humanizeEvaluatorName(rawLabel) : null

    const displayLabel = slot ? (label ?? "—") : "—"

    if (summaryLoading || evaluatorReferenceLoading) {
        return <PreviewEvaluatorCellSkeleton />
    }

    if (!slot) {
        return <div className="not-available-table-cell" />
    }

    return <span className="whitespace-nowrap overflow-hidden text-ellipsis">{displayLabel}</span>
}

export const PreviewEvaluatorCell = ({
    record,
    isVisible = true,
    descriptor,
}: {
    record: EvaluationRunTableRow
    isVisible?: boolean
    descriptor?: ReferenceColumnDescriptor
}) => {
    if (record.__isSkeleton) {
        return (
            <div className={CELL_CLASS}>
                <PreviewEvaluatorCellSkeleton />
            </div>
        )
    }

    return (
        <div className={CELL_CLASS}>
            <PreviewEvaluatorCellContent
                record={record}
                isVisible={isVisible}
                descriptor={descriptor}
            />
        </div>
    )
}

export default PreviewEvaluatorCell
