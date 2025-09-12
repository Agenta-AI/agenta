import {memo} from "react"

import {Tag} from "antd"
import {useAtomValue} from "jotai"

import {variantByRevisionIdAtomFamily} from "@/oss/components/Playground/state/atoms/propertySelectors"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import type {Variant} from "@/oss/lib/Types"
import {revisionDeploymentAtomFamily} from "@/oss/state/variant/atoms/fetcher"
import {
    variantDisplayNameByIdAtomFamily,
    latestAppRevisionIdAtom,
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
}

const VariantNameCell = memo(
    ({revisionId, showBadges = false, showStable = false}: VariantNameCellProps) => {
        // Resolve revision and derive stable keys; keep hooks unconditional
        const rev = useAtomValue(variantByRevisionIdAtomFamily(revisionId || "")) as Rev

        const variantId = (rev && rev.variantId) || ""
        const name = useAtomValue(variantDisplayNameByIdAtomFamily(variantId))
        const latestIdForVariant = useAtomValue(latestAppRevisionIdAtom)
        const deployedIn = useAtomValue(revisionDeploymentAtomFamily((rev && rev.id) || ""))

        if (!rev) {
            return (
                <Tag color="default" bordered={false} className="-ml-1">
                    No deployment
                </Tag>
            )
        }

        const isLatestRevision = rev.id === latestIdForVariant
        const variantMin: Pick<Variant, "deployedIn" | "isLatestRevision" | "id"> = {
            id: rev.id,
            deployedIn: deployedIn || [],
            isLatestRevision,
        }

        return (
            <VariantDetailsWithStatus
                variant={variantMin}
                variantName={name}
                revision={rev.revision ?? rev.revisionNumber}
                showBadges={showBadges}
                showRevisionAsTag
                showStable={showStable}
            />
        )
    },
)

export default VariantNameCell
