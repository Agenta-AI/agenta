import {useMemo} from "react"

import {Typography} from "antd"

import {
    useRunRowDetails,
    useRunRowReferences,
} from "@/oss/components/EvaluationRunsTablePOC/context/RunRowDataContext"
import type {EvaluationRunTableRow} from "@/oss/components/EvaluationRunsTablePOC/types"
import type {ReferenceColumnDescriptor} from "@/oss/components/EvaluationRunsTablePOC/utils/referenceSchema"
import {getSlotByRoleOrdinal} from "@/oss/components/EvaluationRunsTablePOC/utils/referenceSchema"
import SkeletonLine from "@/oss/components/InfiniteVirtualTable/components/common/SkeletonLine"
import {extractPrimaryInvocation} from "@/oss/components/pages/evaluations/utils"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {getUniquePartOfId, isUuid} from "@/oss/lib/helpers/utils"

import usePreviewVariantConfig from "../hooks/usePreviewVariantConfig"

const CELL_CLASS = "flex h-full w-full min-w-0 flex-col justify-center gap-1 px-2"

export const PreviewVariantCellSkeleton = () => <SkeletonLine width="60%" />

const sanitizeVariantName = (value: string | null | undefined) => {
    if (typeof value !== "string") {
        return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

const stripVariantSuffix = (name: string | null, suffix: string | null) => {
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

const formatRevisionLabel = (revision: string | number | null | undefined) => {
    if (revision === null || revision === undefined) return null
    if (typeof revision === "number") return revision
    const trimmed = revision.trim()
    if (!trimmed) return null
    if (/^v\d+$/i.test(trimmed)) {
        return trimmed.slice(1)
    }
    if (isUuid(trimmed)) {
        return getUniquePartOfId(trimmed)
    }
    return trimmed
}

const PreviewVariantCellContent = ({
    record,
    isVisible,
    descriptor,
}: {
    record: EvaluationRunTableRow
    isVisible: boolean
    descriptor?: ReferenceColumnDescriptor
}) => {
    const runId = record.preview?.id ?? record.runId
    const projectId = record.projectId
    const canFetch = Boolean(runId && projectId)
    const {camelRun, isLoading: runLoading} = useRunRowDetails(record, isVisible)
    const invocation = useMemo(
        () => (camelRun ? extractPrimaryInvocation(camelRun as any) : null),
        [camelRun],
    )
    const referenceSequence = useRunRowReferences(record)

    const slot =
        descriptor && descriptor.role === "variant"
            ? getSlotByRoleOrdinal(referenceSequence, descriptor.role, descriptor.roleOrdinal)
            : null
    const slotVariantValue =
        slot?.values.find((value) => value.source?.toLowerCase().includes("variant")) ?? null
    const slotRevisionValue =
        slot?.values.find((value) => value.source?.toLowerCase().includes("revision")) ?? null
    const revisionId = slotRevisionValue?.id ?? invocation?.revisionId ?? null
    const invocationVariantName = sanitizeVariantName(invocation?.variantName) ?? null
    const shouldFetchConfig = Boolean(canFetch && revisionId && isVisible)
    const {config, isLoading: configLoading} = usePreviewVariantConfig(
        {
            projectId,
            revisionId,
        },
        {enabled: shouldFetchConfig},
    )

    const isLoading = runLoading || configLoading

    const resolvedRevision = formatRevisionLabel(
        config?.revision ?? invocation?.revisionLabel ?? invocation?.revisionId ?? null,
    )

    const rawVariantName =
        config?.variantName ??
        slotVariantValue?.label ??
        invocationVariantName ??
        invocation?.appName ??
        slotVariantValue?.slug ??
        null
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
            : null
    const displayName = normalizedVariantName ?? (uniqueSuffix ? `Variant ${uniqueSuffix}` : null)
    const exportText =
        displayName && resolvedRevision
            ? `${displayName} (rev ${resolvedRevision})`
            : (displayName ?? resolvedRevision ?? "—")
    if (isLoading) {
        return <PreviewVariantCellSkeleton />
    }

    const hasResolvedValue = Boolean(displayName || resolvedRevision)
    const isReferenceMissing = Boolean(descriptor && (!slot || !(slot.values?.length ?? 0)))
    if (isReferenceMissing && !hasResolvedValue) {
        return <div className="not-available-table-cell" />
    }

    if (!camelRun) {
        return <Typography.Text>—</Typography.Text>
    }

    if (!hasResolvedValue) {
        return <Typography.Text>—</Typography.Text>
    }

    return (
        <VariantDetailsWithStatus
            variantName={displayName ?? undefined}
            revision={resolvedRevision ?? null}
            showStable
            className="w-full min-w-0"
        />
    )
}

export const PreviewVariantCell = ({
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
                <PreviewVariantCellSkeleton />
            </div>
        )
    }

    return (
        <div className={CELL_CLASS}>
            <PreviewVariantCellContent
                record={record}
                isVisible={isVisible}
                descriptor={descriptor}
            />
        </div>
    )
}
