import clsx from "clsx"

import EnvironmentStatus from "./components/EnvironmentStatus"
import VariantDetails from "./components/VariantDetails"
import type {VariantStatusInfo} from "./types"

const VariantDetailsWithStatus = ({
    variant,
    showBadges = false,
    variantName,
    revision,
    hideName = false,
    className,
    showRevisionAsTag,
    hasChanges = false,
    showStable = false,
    showLatestTag = true,
    isLatest = false,
    onDiscardDraft,
}: {
    variant?: VariantStatusInfo
    hideName?: boolean
    showBadges?: boolean
    variantName?: string
    revision: number | string | undefined | null
    showRevisionAsTag?: boolean
    hasChanges?: boolean
    /** When true, renders server/committed data — suppresses draft indicators */
    showStable?: boolean
    showLatestTag?: boolean
    className?: string
    isLatest?: boolean
    onDiscardDraft?: () => void
}) => {
    const effectiveHasChanges = showStable ? false : hasChanges

    return (
        <div className={clsx(["flex items-center justify-between", className])}>
            <VariantDetails
                variantName={hideName ? "" : variantName}
                revision={revision}
                showRevisionAsTag={showRevisionAsTag}
                hasChanges={effectiveHasChanges}
                showLatestTag={showLatestTag}
                isLatest={isLatest}
                onDiscardDraft={effectiveHasChanges ? onDiscardDraft : undefined}
            />
            {showBadges && variant && <EnvironmentStatus variant={variant} />}
        </div>
    )
}

export default VariantDetailsWithStatus
