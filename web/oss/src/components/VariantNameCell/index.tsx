import {memo, useCallback} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {legacyAppRevisionMolecule} from "@agenta/entities/legacyAppRevision"
import {runnableBridge} from "@agenta/entities/runnable"
import {message} from "@agenta/ui/app-message"
import {Tag} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import type {VariantStatusInfo} from "@/oss/components/VariantDetailsWithStatus/types"

type Rev = {
    id: string
    variantId: string
    revision?: number
    revisionNumber?: number
} | null

interface VariantNameCellProps {
    revisionId?: string
    showBadges?: boolean
    showStable?: boolean
    revision?: Rev
    revisionName?: string | null
}

const VariantNameCell = memo(
    ({
        revisionId,
        revision,
        revisionName,
        showBadges = false,
        showStable = false,
    }: VariantNameCellProps) => {
        const currentRevisionId = revisionId || (revision?.id ?? "")
        const resolvedRevision = useAtomValue(
            legacyAppRevisionMolecule.atoms.data(currentRevisionId),
        ) as Rev

        const rev = resolvedRevision ?? revision

        const isLatestRevision = useAtomValue(runnableBridge.isLatestRevision(currentRevisionId))
        const deployedInFromStore = useAtomValue(
            environmentMolecule.atoms.revisionDeployment((rev && rev.id) || ""),
        )

        const _isDirty = useAtomValue(runnableBridge.isDirty(currentRevisionId))
        const isDirty = showStable ? false : _isDirty
        const discard = useSetAtom(runnableBridge.discard)

        const handleDiscardDraft = useCallback(() => {
            if (!currentRevisionId) return
            try {
                discard(currentRevisionId)
                message.success("Draft changes discarded")
            } catch (e) {
                message.error("Failed to discard draft changes")
                console.error(e)
            }
        }, [currentRevisionId, discard])

        if (!rev) {
            return (
                <Tag color="default" bordered={false} className="-ml-1">
                    No deployment
                </Tag>
            )
        }

        const resolvedName = revisionName || (rev as any)?.variantName || "-"

        const deployedIn =
            deployedInFromStore && deployedInFromStore.length > 0
                ? deployedInFromStore
                : ((rev as any)?.deployedIn as {name: string}[]) || []

        const variantMin: VariantStatusInfo = {
            id: rev.id,
            deployedIn,
            isLatestRevision,
        }

        return (
            <VariantDetailsWithStatus
                variant={variantMin}
                variantName={resolvedName}
                revision={rev.revision ?? rev.revisionNumber}
                showBadges={showBadges}
                showRevisionAsTag
                hasChanges={isDirty}
                isLatest={isLatestRevision}
                onDiscardDraft={handleDiscardDraft}
            />
        )
    },
)

export default VariantNameCell
