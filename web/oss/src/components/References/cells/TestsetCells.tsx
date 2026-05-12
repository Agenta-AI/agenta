import {useMemo} from "react"

import {testsetMolecule} from "@agenta/entities/testset"
import {Tag} from "antd"
import {getDefaultStore} from "jotai"
import {useAtomValue} from "jotai"

import {
    useRunRowReferences,
    useRunRowSummary,
} from "@/oss/components/EvaluationRunsTablePOC/context/RunRowDataContext"
import type {EvaluationRunTableRow} from "@/oss/components/EvaluationRunsTablePOC/types"
import type {ReferenceColumnDescriptor} from "@/oss/components/EvaluationRunsTablePOC/utils/referenceSchema"
import {getSlotByRoleOrdinal} from "@/oss/components/EvaluationRunsTablePOC/utils/referenceSchema"
import SkeletonLine from "@/oss/components/InfiniteVirtualTable/components/common/SkeletonLine"
import {revision} from "@/oss/state/entities/testset"

// Entity molecule atoms must be read from the default store because they depend on
// sessionAtom/projectIdAtom which are only reliably set there. Components inside
// scoped Jotai stores (e.g. EvaluationRunsTableStoreProvider) would otherwise
// read stale defaults from the scoped store's isolated atom graph.
const defaultStore = getDefaultStore()
const useDefaultAtomValue: typeof useAtomValue = (atom) => useAtomValue(atom, {store: defaultStore})

const CELL_CLASS = "flex h-full w-full min-w-0 flex-col justify-center gap-1 px-2"

export const PreviewTestsetCellSkeleton = () => <SkeletonLine width="65%" />

const normalize = (value: string | null | undefined) =>
    typeof value === "string" && value.trim().length ? value.trim() : null

const extractTestsetRevisionId = (
    stepReferences: Record<string, unknown> | null | undefined,
    testsetId: string | null | undefined,
): string | null => {
    if (!stepReferences || !testsetId) return null
    for (const stepKey of Object.keys(stepReferences)) {
        const refs = (stepReferences as Record<string, any>)[stepKey]
        if (!refs || typeof refs !== "object") continue
        const directMatch = refs.testset ?? refs.test_set ?? refs.testsetVariant
        if (directMatch && directMatch.id === testsetId) {
            const revisionRef = refs.testsetRevision ?? refs.testset_revision
            return revisionRef && typeof revisionRef.id === "string" ? revisionRef.id : null
        }
        const arrayRefs = refs.testsets
        if (Array.isArray(arrayRefs)) {
            for (const entry of arrayRefs) {
                if (entry && entry.id === testsetId) {
                    const revisionRef = refs.testsetRevision ?? refs.testset_revision
                    return revisionRef && typeof revisionRef.id === "string" ? revisionRef.id : null
                }
            }
        }
    }
    return null
}

const PreviewTestsetCellContent = ({
    record,
    isVisible,
    descriptor,
}: {
    record: EvaluationRunTableRow
    isVisible: boolean
    descriptor?: ReferenceColumnDescriptor
}) => {
    const {summary, stepReferences, isLoading: summaryLoading} = useRunRowSummary(record, isVisible)
    const referenceSequence = useRunRowReferences(record)
    const slot =
        descriptor && descriptor.role === "testset"
            ? getSlotByRoleOrdinal(referenceSequence, descriptor.role, descriptor.roleOrdinal)
            : null
    const slotTestsetValue = slot?.values.find((value) => value.id) ?? null
    const slotTestsetId = slotTestsetValue?.id ?? null
    // Look for revision value in the testset slot (e.g. source: "testsetRevision")
    const slotRevisionValue =
        slot?.values.find((value) => value.source?.toLowerCase().includes("revision")) ?? null

    const firstTestsetId = slotTestsetId ?? summary?.testsetIds?.[0] ?? null

    // Use testset molecule directly — accessing triggers fetch automatically
    const testsetDataAtom = useMemo(
        () => testsetMolecule.dataOptional(firstTestsetId),
        [firstTestsetId],
    )
    const testsetQueryAtom = useMemo(
        () => testsetMolecule.queryOptional(firstTestsetId),
        [firstTestsetId],
    )
    const testsetData = useDefaultAtomValue(testsetDataAtom)
    const testsetQuery = useDefaultAtomValue(testsetQueryAtom)

    // Extract revision ID from step references (legacy path)
    const embeddedRevisionId = useMemo(
        () => extractTestsetRevisionId(stepReferences ?? null, firstTestsetId ?? null),
        [stepReferences, firstTestsetId],
    )

    // Prefer slot revision value, then embedded revision from step references
    const revisionId = slotRevisionValue?.id ?? embeddedRevisionId
    const revisionDataAtom = useMemo(() => revision.selectors.data(revisionId ?? ""), [revisionId])
    const revisionEntity = useDefaultAtomValue(revisionDataAtom)
    const revisionVersion = revisionId ? revisionEntity?.version : null

    const primaryName = normalize(testsetData?.name)
    const label = primaryName ?? "—"
    const isTestsetLoading = Boolean(firstTestsetId && !testsetData && testsetQuery?.isPending)

    if (summaryLoading || isTestsetLoading) {
        return <PreviewTestsetCellSkeleton />
    }

    const hasResolvedValue = label !== "—"
    const isReferenceMissing = Boolean(descriptor && (!slot || !(slot.values?.length ?? 0)))
    if (isReferenceMissing && !hasResolvedValue) {
        return <div className="not-available-table-cell" />
    }

    // Format version display
    const versionDisplay =
        revisionVersion !== null && revisionVersion !== undefined ? `v${revisionVersion}` : null

    return (
        <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
            <span className="text-ellipsis overflow-hidden">{label}</span>
            {versionDisplay && (
                <Tag className="bg-[rgba(5,23,41,0.06)]" variant="filled">
                    {versionDisplay}
                </Tag>
            )}
        </div>
    )
}

export const PreviewTestsetCell = ({
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
                <PreviewTestsetCellSkeleton />
            </div>
        )
    }

    return (
        <div className={CELL_CLASS}>
            <PreviewTestsetCellContent
                record={record}
                isVisible={isVisible}
                descriptor={descriptor}
            />
        </div>
    )
}
