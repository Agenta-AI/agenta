import {VariantDetailsWithStatus} from "@agenta/entity-ui/variant"
import {Button} from "@agenta/primitive-ui/components/button"
import {CopySimple} from "@phosphor-icons/react"
import {Tooltip} from "antd"

interface RevisionChildTitleProps {
    revisionId: string
    variantName: string
    version: number
    variant: unknown
    isDisabled: boolean
    showLatestTag: boolean
    showAsCompare: boolean
    onCreateLocalCopy: (revisionId: string, e: React.MouseEvent) => void
    latestRevisionId?: string | null
}

const RevisionChildTitle = ({
    revisionId,
    variantName,
    version,
    variant,
    isDisabled,
    showLatestTag,
    showAsCompare,
    onCreateLocalCopy,
    latestRevisionId,
}: RevisionChildTitleProps) => {
    const isLatest = !!latestRevisionId && revisionId === latestRevisionId

    return (
        <div
            className={`flex items-center justify-between h-[32px] pl-1.5 pr-0 group/revision ${isDisabled ? "opacity-50" : ""}`}
        >
            <VariantDetailsWithStatus
                className="w-full [&_.environment-badges]:mr-2"
                variantName={variantName}
                revision={version}
                variant={variant as any}
                hideName
                showBadges
                showLatestTag={showLatestTag}
                isLatest={isLatest}
            />
            {showAsCompare && (
                <Tooltip title="Create local copy for comparison">
                    <Button
                        className="opacity-0 group-hover/revision:opacity-100 transition-opacity mr-1"
                        onClick={(e) => onCreateLocalCopy(revisionId, e)}
                        data-tour="compare-toggle"
                        variant="ghost"
                        size="icon-sm"
                    >
                        {<CopySimple size={14} />}
                    </Button>
                </Tooltip>
            )}
        </div>
    )
}

export default RevisionChildTitle
