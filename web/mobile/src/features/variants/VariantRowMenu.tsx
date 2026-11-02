import {copyToClipboard} from "@agenta/ui/utils"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CloudArrowUp, Copy, DotsThreeVertical, Eye, Trash} from "@phosphor-icons/react"

import type {AppRevisionRow} from "./useAppRevisions"

/**
 * A revision's own actions. Deploy and Delete show only to a reader who may do them, so a menu
 * never offers a verb that the server then refuses.
 */
export const VariantRowMenu = ({
    row,
    canDeploy,
    canDelete,
    onOpen,
    onDeploy,
    onDelete,
}: {
    row: AppRevisionRow
    canDeploy: boolean
    canDelete: boolean
    onOpen: (row: AppRevisionRow) => void
    onDeploy: (row: AppRevisionRow) => void
    onDelete: (row: AppRevisionRow) => void
}) => (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Revision actions"
                className="hover:bg-foreground/10 dark:hover:bg-foreground/15"
            >
                <DotsThreeVertical aria-hidden className="size-3.5" weight="bold" />
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[200px]">
            <DropdownMenuItem onSelect={() => onOpen(row)}>
                <Eye aria-hidden size={14} />
                View details
            </DropdownMenuItem>
            {canDeploy ? (
                <DropdownMenuItem onSelect={() => onDeploy(row)}>
                    <CloudArrowUp aria-hidden size={14} />
                    Deploy
                </DropdownMenuItem>
            ) : null}
            {canDelete ? (
                <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => onDelete(row)}>
                        <Trash aria-hidden size={14} />
                        Delete
                    </DropdownMenuItem>
                </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void copyToClipboard(row.revisionId)}>
                <Copy aria-hidden size={14} />
                Copy ID
            </DropdownMenuItem>
            {row.variantSlug ? (
                <DropdownMenuItem onSelect={() => void copyToClipboard(row.variantSlug ?? "")}>
                    <Copy aria-hidden size={14} />
                    Copy Slug
                </DropdownMenuItem>
            ) : null}
        </DropdownMenuContent>
    </DropdownMenu>
)
