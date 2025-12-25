import clsx from "clsx"
import {useAtomValue} from "jotai"

import {Variant} from "@/oss/lib/Types"

import {variantIsDirtyAtomFamily} from "../Playground/state/atoms"

import EnvironmentStatus from "./components/EnvironmentStatus"
import VariantDetails from "./components/VariantDetails"

const VariantDetailsWithStatus = ({
    variant,
    showBadges = false,
    variantName,
    revision,
    hideName = false,
    className,
    showRevisionAsTag,
    showStable = false,
    showLatestTag = true,
}: {
    variant?: Pick<Variant, "deployedIn" | "isLatestRevision" | "id">
    hideName?: boolean
    showBadges?: boolean
    variantName?: string
    revision: number | string | undefined | null
    showRevisionAsTag?: boolean
    showStable?: boolean
    showLatestTag?: boolean
    className?: string
}) => {
    const _isDirty = useAtomValue(variantIsDirtyAtomFamily(variant?.id || ""))
    const isDirty = showStable ? false : _isDirty

    return (
        <div className={clsx(["flex items-center justify-between", className])}>
            <VariantDetails
                variantName={hideName ? "" : variantName}
                revision={revision}
                variant={variant}
                showRevisionAsTag={showRevisionAsTag}
                hasChanges={isDirty}
                showLatestTag={showLatestTag}
            />
            {showBadges && variant && <EnvironmentStatus variant={variant} />}
        </div>
    )
}

export default VariantDetailsWithStatus
