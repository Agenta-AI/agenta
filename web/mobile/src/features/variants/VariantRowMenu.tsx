import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {CloudArrowUp, Copy, DotsThreeVertical, Eye, Play, Trash} from "@phosphor-icons/react"
import Link from "next/link"

import type {AppRevisionRow} from "./useAppRevisions"

/**
 * A revision's own actions. Deploy and Delete show only to a reader who may do them, so a menu
 * never offers a verb that the server then refuses. "Open in playground" shows only while the
 * playground view is on (`playgroundHref` is null otherwise).
 */
export const VariantRowMenu = ({
    row,
    canDeploy,
    canDelete,
    playgroundHref,
    onOpen,
    onDeploy,
    onDelete,
}: {
    row: AppRevisionRow
    canDeploy: boolean
    canDelete: boolean
    playgroundHref: ((row: AppRevisionRow) => string) | null
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
            {playgroundHref ? (
                <DropdownMenuItem asChild>
                    <Link
                        href={playgroundHref(row)}
                        prefetch={false}
                        className="text-foreground no-underline"
                    >
                        <Play aria-hidden size={14} />
                        Open in playground
                    </Link>
                </DropdownMenuItem>
            ) : null}
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
