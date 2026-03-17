import {memo, useCallback, useMemo} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {
    workflowLatestRevisionIdAtomFamily,
    workflowMolecule,
    workflowVariantsListDataAtomFamily,
} from "@agenta/entities/workflow"
import {message} from "@agenta/ui/app-message"
import {Tag} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import type {VariantStatusInfo} from "@/oss/components/VariantDetailsWithStatus/types"

interface VariantNameCellProps {
    revisionId?: string
    showBadges?: boolean
    showStable?: boolean
    revisionName?: string | null
    hideDiscard?: boolean
}

const VariantNameCell = memo(
    ({
        revisionId,
        revisionName,
        showBadges = false,
        showStable = false,
        hideDiscard = false,
    }: VariantNameCellProps) => {
        const currentRevisionId = revisionId || ""
        const workflowData = useAtomValue(
            useMemo(() => workflowMolecule.selectors.data(currentRevisionId), [currentRevisionId]),
        )

        const workflowId = workflowData?.workflow_id || ""
        const variants = useAtomValue(workflowVariantsListDataAtomFamily(workflowId))
        const latestRevisionId = useAtomValue(workflowLatestRevisionIdAtomFamily(workflowId))
        const isLatestRevision = !!latestRevisionId && currentRevisionId === latestRevisionId

        const deployedIn = useAtomValue(
            environmentMolecule.atoms.revisionDeployment(currentRevisionId),
        )

        const _isDirty = useAtomValue(workflowMolecule.selectors.isDirty(currentRevisionId))
        const isDirty = showStable ? false : _isDirty
        const discard = useSetAtom(workflowMolecule.actions.discard)

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

        if (!workflowData) {
            return (
                <Tag color="default" variant="filled" className="-ml-1">
                    No deployment
                </Tag>
            )
        }

        const variantEntity = variants.find((v) => v.id === workflowData.workflow_variant_id)
        const resolvedName = variantEntity?.name || revisionName || workflowData.name || "-"

        const variantMin: VariantStatusInfo = {
            id: currentRevisionId,
            deployedIn: deployedIn?.length ? deployedIn : [],
            isLatestRevision,
        }

        return (
            <VariantDetailsWithStatus
                variant={variantMin}
                variantName={resolvedName}
                revision={workflowData.version}
                showBadges={showBadges}
                showRevisionAsTag
                hasChanges={isDirty}
                isLatest={isLatestRevision}
                onDiscardDraft={handleDiscardDraft}
                hideDiscard={hideDiscard}
            />
        )
    },
)

export default VariantNameCell
