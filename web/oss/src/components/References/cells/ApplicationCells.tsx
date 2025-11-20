import {useMemo} from "react"

import {Typography} from "antd"

import {
    useRunRowDetails,
    useRunRowReferences,
    useRunRowSummary,
} from "@/oss/components/EvaluationRunsTablePOC/context/RunRowDataContext"
import type {EvaluationRunTableRow} from "@/oss/components/EvaluationRunsTablePOC/types"
import type {ReferenceColumnDescriptor} from "@/oss/components/EvaluationRunsTablePOC/utils/referenceSchema"
import {getSlotByRoleOrdinal} from "@/oss/components/EvaluationRunsTablePOC/utils/referenceSchema"
import SkeletonLine from "@/oss/components/InfiniteVirtualTable/components/common/SkeletonLine"
import {extractPrimaryInvocation} from "@/oss/components/pages/evaluations/utils"
import {getUniquePartOfId, isUuid} from "@/oss/lib/helpers/utils"

import useAppReference from "../hooks/useAppReference"
import usePreviewVariantConfig from "../hooks/usePreviewVariantConfig"

import {
    formatRevisionLabel,
    PreviewVariantCellSkeleton,
    sanitizeVariantName,
    stripVariantSuffix,
} from "./VariantCells"

export const PreviewAppCellSkeleton = () => <SkeletonLine width="55%" />

const CELL_CLASS = "flex h-full w-full min-w-0 flex-col justify-center gap-1 px-2"

export const PreviewAppCell = ({
    record,
    isVisible = true,
    descriptor,
}: {
    record: EvaluationRunTableRow
    isVisible?: boolean
    descriptor?: ReferenceColumnDescriptor
}) => {
    const projectId = record.projectId ?? null
    const canFetch = Boolean(!record.__isSkeleton)
    const {summary, isLoading: summaryLoading} = useRunRowSummary(record, isVisible)
    const {camelRun, isLoading: runLoading} = useRunRowDetails(record, isVisible)
    const invocation = useMemo(
        () => (camelRun ? extractPrimaryInvocation(camelRun as any) : null),
        [camelRun],
    )
    const referenceSequence = useRunRowReferences(record)
    const slot =
        descriptor && descriptor.role === "application"
            ? getSlotByRoleOrdinal(referenceSequence, descriptor.role, descriptor.roleOrdinal)
            : null
    const slotValue = slot?.values?.[0]
    const slotAppId = slotValue?.id ?? null
    const slotLabel = slotValue?.label ?? slotValue?.slug ?? slotValue?.name ?? null
    const appId = slotAppId ?? summary?.appId ?? record.appId ?? null
    const variantSlot =
        (slot &&
            referenceSequence?.find(
                (candidate) =>
                    candidate.role === "variant" &&
                    candidate.stepIndex === slot.stepIndex &&
                    candidate.stepKey === slot.stepKey,
            )) ||
        getSlotByRoleOrdinal(referenceSequence, "variant", descriptor?.roleOrdinal ?? 1)
    const slotVariantValue =
        variantSlot?.values.find((value) => value.source?.toLowerCase().includes("variant")) ??
        variantSlot?.values?.[0] ??
        null
    const slotRevisionValue =
        variantSlot?.values.find((value) => value.source?.toLowerCase().includes("revision")) ??
        null
    const revisionId =
        slotRevisionValue?.id ?? invocation?.revisionId ?? slotVariantValue?.id ?? null
    const shouldFetchVariant = Boolean(canFetch && projectId && revisionId)
    const {config, isLoading: configLoading} = usePreviewVariantConfig(
        {
            projectId,
            revisionId,
        },
        {enabled: shouldFetchVariant},
    )
    const variantIsLoading = runLoading || configLoading
    // const invocationVariantName = sanitizeVariantName(invocation?.variantName) ?? null
    const rawVariantName = config?.variantName ?? null
    const sanitizedVariantName = sanitizeVariantName(rawVariantName)
    const fallbackVariantId =
        (typeof invocation?.variantId === "string" && invocation.variantId.trim().length > 0
            ? invocation.variantId
            : null) ??
        slotVariantValue?.id ??
        revisionId
    const uniqueSuffix = fallbackVariantId ? getUniquePartOfId(fallbackVariantId) : null
    const normalizedVariantName =
        sanitizedVariantName && !isUuid(sanitizedVariantName)
            ? stripVariantSuffix(sanitizedVariantName, uniqueSuffix)
            : sanitizedVariantName
    const displayVariantName = normalizedVariantName ?? null
    const resolvedRevision = formatRevisionLabel(
        config?.revision ?? invocation?.revisionLabel ?? null,
    )
    const hasVariantDetails = Boolean(displayVariantName)

    const {reference, isLoading: referenceLoading} = useAppReference(
        {
            projectId: record.projectId,
            appId,
        },
        {enabled: canFetch && Boolean(appId)},
    )
    // const additionalCount = Math.max((slot?.values?.length ?? 0) - 1, 0)

    const resolvedName = reference?.name ?? null
    const contentLabel = resolvedName ?? "—"
    if (record.__isSkeleton) {
        return (
            <div className={CELL_CLASS}>
                <PreviewAppCellSkeleton />
            </div>
        )
    }

    if (summaryLoading || referenceLoading) {
        return (
            <div className={CELL_CLASS}>
                <PreviewAppCellSkeleton />
            </div>
        )
    }

    const isReferenceMissing = Boolean(descriptor && (!slot || !(slot.values?.length ?? 0)))
    const hasResolvedValue = contentLabel !== "—"
    if (isReferenceMissing && !hasResolvedValue && !hasVariantDetails) {
        return <div className="not-available-table-cell" />
    }

    return (
        <div className={CELL_CLASS}>
            <Typography.Text>
                {contentLabel}
                {/* {additionalCount > 0 ? ` (+${additionalCount})` : ""} */}
            </Typography.Text>
            {variantIsLoading && shouldFetchVariant ? (
                <PreviewVariantCellSkeleton />
            ) : hasVariantDetails ? (
                <div className="application-variant-row">
                    <span className="application-variant-label">{displayVariantName}</span>
                    {resolvedRevision ? (
                        <span className="application-variant-chip">{`v${resolvedRevision}`}</span>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}
