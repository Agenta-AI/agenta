import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {DraftTag} from "@agenta/ui/components"
import {Space, Tag} from "antd"

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
        <Space size={4}>
            {variantName ? <span>{variantName}</span> : null}
            {revision !== undefined &&
                revision !== null &&
                revision !== "" &&
                (showRevisionAsTag ? (
                    <Tag className={`bg-[var(--ag-colorFillSecondary)]`} variant="filled">
                        v{revision}
                    </Tag>
                ) : (
                    <span>v{revision}</span>
                ))}

            {hasChanges ? (
                hideDiscard ? (
                    <DraftTag />
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger className="bg-transparent border-none p-0 cursor-pointer inline-flex items-center text-inherit">
                            <DraftTag className="cursor-pointer" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" side="bottom" sideOffset={4}>
                            <DropdownMenuItem
                                variant="destructive"
                                disabled={!onDiscardDraft}
                                onClick={() => onDiscardDraft?.()}
                            >
                                Discard draft changes
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )
            ) : (
                isLatest &&
                showLatestTag && (
                    <Tag
                        className={`bg-[var(--ag-c-E6F4FF)] text-[var(--ag-c-1677FF)]`}
                        variant="filled"
                    >
                        Last modified
                    </Tag>
                )
            )}
        </Space>
    )
}

export default VariantDetails
