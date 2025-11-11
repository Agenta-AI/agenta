import clsx from "clsx"

import {Variant} from "@/oss/lib/Types"

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
}: {
    variant?: Pick<Variant, "deployedIn" | "isLatestRevision"> & {isDraft?: boolean}
    hideName?: boolean
    showBadges?: boolean
    variantName?: string
    revision: number | string | undefined | null
    showRevisionAsTag?: boolean
    className?: string
}) => {
    return (
        <div className={clsx(["flex items-center justify-between", className])}>
            <VariantDetails
                variantName={hideName ? "" : variantName}
                revision={revision}
                variant={variant}
                showRevisionAsTag={showRevisionAsTag}
            />
            {showBadges && variant && <EnvironmentStatus variant={variant} />}
        </div>
    )
}

export default VariantDetailsWithStatus
