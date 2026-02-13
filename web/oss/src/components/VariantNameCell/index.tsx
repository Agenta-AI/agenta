import {memo, useCallback} from "react"

import {message} from "@agenta/ui/app-message"
import {Tag} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {parametersOverrideAtomFamily} from "@/oss/components/Playground/state/atoms"
import {
    playgroundLatestAppRevisionIdAtom,
    playgroundRevisionDeploymentAtomFamily,
} from "@/oss/components/Playground/state/atoms/playgroundAppAtoms"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import type {VariantStatusInfo} from "@/oss/components/VariantDetailsWithStatus/types"
import {
    moleculeBackedVariantAtomFamily,
    revisionIsDirtyAtomFamily,
    discardRevisionDraftAtom,
} from "@/oss/state/newPlayground/legacyEntityBridge"

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
            moleculeBackedVariantAtomFamily(revisionId || (revision?.id ?? "")),
        ) as Rev

        const rev = resolvedRevision ?? revision

        const latestIdForVariant = useAtomValue(playgroundLatestAppRevisionIdAtom)
        const deployedInFromStore = useAtomValue(
            playgroundRevisionDeploymentAtomFamily((rev && rev.id) || ""),
        )

        const _isDirty = useAtomValue(revisionIsDirtyAtomFamily(rev?.id || ""))
        const isDirty = showStable ? false : _isDirty

        const isLatestRevision =
            typeof (rev as any)?.isLatestRevision === "boolean"
                ? (rev as any).isLatestRevision
                : rev?.id === latestIdForVariant

        const discardDraft = useSetAtom(discardRevisionDraftAtom)
        const setParamsOverride = useSetAtom(parametersOverrideAtomFamily(rev?.id || "") as any)

        const handleDiscardDraft = useCallback(() => {
            if (!rev?.id) return
            try {
                discardDraft(rev.id)
                setParamsOverride(null)
                message.success("Draft changes discarded")
            } catch (e) {
                message.error("Failed to discard draft changes")
                console.error(e)
            }
        }, [rev?.id, discardDraft, setParamsOverride])

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
