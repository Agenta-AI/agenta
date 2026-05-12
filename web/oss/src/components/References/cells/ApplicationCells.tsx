import {useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {getDefaultStore, useAtomValue} from "jotai"

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

import usePreviewVariantConfig from "../hooks/usePreviewVariantConfig"

import {
    formatRevisionLabel,
    PreviewVariantCellSkeleton,
    sanitizeVariantName,
    stripVariantSuffix,
} from "./VariantCells"

export const PreviewAppCellSkeleton = () => <SkeletonLine width="55%" />

// Entity molecule atoms must be read from the default store because they depend on
// sessionAtom/projectIdAtom which are only reliably set there. Components inside
// scoped Jotai stores (e.g. EvaluationRunsTableStoreProvider) would otherwise
// read stale defaults from the scoped store's isolated atom graph.
const defaultStore = getDefaultStore()
const useDefaultAtomValue: typeof useAtomValue = (atom) => useAtomValue(atom, {store: defaultStore})

const CELL_CLASS =
    "flex h-full w-full min-w-0 flex-col justify-center gap-1 px-2 whitespace-nowrap overflow-hidden text-ellipsis"

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
    const slotAppId = slot?.values?.[0]?.id ?? null
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
    // Look for revision in both application slot (application_revision) and variant slot
    const slotRevisionValue =
        slot?.values.find((value) => value.source?.toLowerCase().includes("revision")) ??
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
    const rawVariantName =
        config?.variantName ??
        slotVariantValue?.slug ??
        invocation?.variantName ??
        slotVariantValue?.label ??
        null
    const sanitizedVariantName = sanitizeVariantName(rawVariantName)
    const fallbackVariantId =
        (typeof invocation?.variantId === "string" && invocation.variantId.trim().length > 0
            ? invocation.variantId
            : null) ??
        slotVariantValue?.id ??
        revisionId
    const uniqueSuffix = fallbackVariantId ? getUniquePartOfId(fallbackVariantId) : null
    // Strip UUID-like variant names (e.g. raw slugs like "29fc63c722d8")
    // and strip the variant ID suffix from human-readable names
    const normalizedVariantName =
        sanitizedVariantName && !isUuid(sanitizedVariantName)
            ? stripVariantSuffix(sanitizedVariantName, uniqueSuffix)
            : null
    const displayVariantName = normalizedVariantName ?? null
    const resolvedRevision = formatRevisionLabel(
        config?.revision ?? invocation?.revisionLabel ?? null,
    )
    const hasVariantDetails = Boolean(displayVariantName)

    // Use workflow list data directly — subscribing here triggers the fetch
    // Read from default store to bypass scoped store isolation
    const workflowsList = useDefaultAtomValue(workflowMolecule.atoms.listData)
    const workflowsListQuery = useDefaultAtomValue(workflowMolecule.atoms.listQuery)
    const resolvedName = useMemo(() => {
        if (!appId) return null
        const match = workflowsList.find((w) => w.id === appId)
        return match?.name ?? null
    }, [appId, workflowsList])
    const isAppLoading = Boolean(appId && !resolvedName && workflowsListQuery.isPending)

    const contentLabel = resolvedName ?? "—"
    if (record.__isSkeleton) {
        return (
            <div className={CELL_CLASS}>
                <PreviewAppCellSkeleton />
            </div>
        )
    }

    if (summaryLoading || isAppLoading) {
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
            <span className="whitespace-nowrap overflow-hidden text-ellipsis">{contentLabel}</span>
            {variantIsLoading && shouldFetchVariant ? (
                <PreviewVariantCellSkeleton />
            ) : hasVariantDetails ? (
                <div className="application-variant-row whitespace-nowrap overflow-hidden text-ellipsis">
                    <span className="application-variant-label whitespace-nowrap overflow-hidden text-ellipsis">
                        {displayVariantName}{" "}
                        {resolvedRevision ? (
                            <span className="application-variant-chip">{`v${resolvedRevision}`}</span>
                        ) : null}
                    </span>
                </div>
            ) : null}
        </div>
    )
}
