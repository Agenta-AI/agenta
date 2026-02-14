import {memo, useCallback} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {legacyAppRevisionMolecule} from "@agenta/entities/legacyAppRevision"
import {message} from "@agenta/ui/app-message"
import {Tag} from "antd"
import {useAtomValue} from "jotai"

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
        const resolvedRevision = useAtomValue(
            legacyAppRevisionMolecule.atoms.data(revisionId || (revision?.id ?? "")),
        ) as Rev

        const rev = resolvedRevision ?? revision

        const latestIdForVariant = useAtomValue(legacyAppRevisionMolecule.atoms.latestRevisionId)
        const deployedInFromStore = useAtomValue(
            environmentMolecule.atoms.revisionDeployment((rev && rev.id) || ""),
        )

        const _isDirty = useAtomValue(legacyAppRevisionMolecule.atoms.isDirty(rev?.id || ""))
        const isDirty = showStable ? false : _isDirty

        const isLatestRevision =
            typeof (rev as any)?.isLatestRevision === "boolean"
                ? (rev as any).isLatestRevision
                : rev?.id === latestIdForVariant

        const handleDiscardDraft = useCallback(() => {
            if (!rev?.id) return
            try {
                legacyAppRevisionMolecule.set.discard(rev.id)
                message.success("Draft changes discarded")
            } catch (e) {
                message.error("Failed to discard draft changes")
                console.error(e)
            }
        }, [rev?.id])

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
