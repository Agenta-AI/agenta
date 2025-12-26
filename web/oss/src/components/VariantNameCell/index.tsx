import {memo} from "react"

import {Tag} from "antd"
import {useAtomValue} from "jotai"

import {variantByRevisionIdAtomFamily} from "@/oss/components/Playground/state/atoms/propertySelectors"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import type {Variant} from "@/oss/lib/Types"
import {revisionDeploymentAtomFamily} from "@/oss/state/variant/atoms/fetcher"
import {
    latestAppRevisionIdAtom,
    variantDisplayNameByIdAtomFamily,
} from "@/oss/state/variant/selectors/variant"

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
            variantByRevisionIdAtomFamily(revisionId || (revision?.id ?? "")),
        ) as Rev

        const rev = resolvedRevision ?? revision
        const variantId = (rev && rev.variantId) || ""

        const nameFromStore = useAtomValue(variantDisplayNameByIdAtomFamily(variantId))
        const latestIdForVariant = useAtomValue(latestAppRevisionIdAtom)
        const deployedInFromStore = useAtomValue(
            revisionDeploymentAtomFamily((rev && rev.id) || ""),
        )

        if (!rev) {
            return (
                <Tag color="default" variant="filled" className="-ml-1">
                    No deployment
                </Tag>
            )
        }

        const resolvedName =
            (nameFromStore && nameFromStore !== "-" ? nameFromStore : null) ||
            revisionName ||
            (rev as any)?.variantName ||
            "-"

        const deployedIn =
            deployedInFromStore && deployedInFromStore.length > 0
                ? deployedInFromStore
                : ((rev as any)?.deployedIn as Variant["deployedIn"]) || []

        const isLatestRevision =
            typeof (rev as any)?.isLatestRevision === "boolean"
                ? (rev as any).isLatestRevision
                : rev.id === latestIdForVariant

        const variantMin: Pick<Variant, "deployedIn" | "isLatestRevision" | "id"> = {
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
                showStable={showStable}
            />
        )
    },
)

export default VariantNameCell
