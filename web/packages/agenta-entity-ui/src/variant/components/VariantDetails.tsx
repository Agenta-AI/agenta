import {Tag as AgentaTag} from "@agenta/ui/components"
import {
    Badge,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"

interface VariantDetailsProps {
    variantName?: string
    revision?: number | string | null
    showRevisionAsTag?: boolean
    hasChanges?: boolean
    showLatestTag?: boolean
    isLatest?: boolean
    onDiscardDraft?: () => void
    hideDiscard?: boolean
}

const VariantDetails = ({
    variantName,
    revision,
    showRevisionAsTag = true,
    hasChanges = false,
    showLatestTag = true,
    isLatest = false,
    onDiscardDraft,
    hideDiscard = false,
}: VariantDetailsProps) => {
    return (
        <div className="flex items-center gap-1">
            {variantName ? <span>{variantName}</span> : null}
            {revision !== undefined &&
                revision !== null &&
                revision !== "" &&
                (showRevisionAsTag ? (
                    <Badge className={`bg-[var(--ag-colorFillSecondary)]`}>v{revision}</Badge>
                ) : (
                    <span>v{revision}</span>
                ))}

            {hasChanges ? (
                hideDiscard ? (
                    <AgentaTag draft />
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            {/* role=button makes the Radix aria-haspopup/expanded attrs valid on the span. */}
                            <AgentaTag draft role="button" className="cursor-pointer" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="bottom" align="start">
                            <DropdownMenuItem
                                variant="destructive"
                                disabled={!onDiscardDraft}
                                onSelect={() => onDiscardDraft?.()}
                            >
                                Discard draft changes
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )
            ) : (
                isLatest &&
                showLatestTag && (
                    <Badge className={`bg-[var(--ag-c-E6F4FF)] text-[var(--ag-c-1677FF)]`}>
                        Last modified
                    </Badge>
                )
            )}
        </div>
    )
}

export default VariantDetails
