import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {
    ArrowCounterClockwise,
    Code,
    Copy,
    DotsThreeVertical,
    Eye,
    Play,
} from "@phosphor-icons/react"
import Link from "next/link"

/** The /w row actions beta developer mode adds. Revert then shows disabled, with its reason. */
export interface DeploymentRowExtras {
    onUseApi?: () => void
    playgroundHref?: string | null
    onCopyId?: () => void
    /** Why Revert is off for this row, or null when it is on. */
    revertReason: string | null
}

/** A history row's actions. Revert shows only when the reader may deploy and the row is not live. */
export const DeploymentRowMenu = ({
    canRevert,
    onOpen,
    onRevert,
    extras,
}: {
    canRevert: boolean
    onOpen: () => void
    onRevert: () => void
    extras?: DeploymentRowExtras
}) => (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Deployment actions"
                className="hover:bg-foreground/10 dark:hover:bg-foreground/15"
            >
                <DotsThreeVertical aria-hidden className="size-3.5" weight="bold" />
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[220px]">
            <DropdownMenuItem onSelect={onOpen}>
                <Eye aria-hidden size={14} />
                Open details
            </DropdownMenuItem>
            {extras?.onUseApi ? (
                <DropdownMenuItem onSelect={extras.onUseApi}>
                    <Code aria-hidden size={14} />
                    Use API
                </DropdownMenuItem>
            ) : null}
            {extras?.playgroundHref ? (
                <DropdownMenuItem asChild>
                    <Link href={extras.playgroundHref} prefetch={false}>
                        <Play aria-hidden size={14} />
                        Open in Playground
                    </Link>
                </DropdownMenuItem>
            ) : null}
            {extras?.onCopyId ? (
                <DropdownMenuItem onSelect={extras.onCopyId}>
                    <Copy aria-hidden size={14} />
                    Copy ID
                </DropdownMenuItem>
            ) : null}
            {extras ? (
                <DropdownMenuItem disabled={!canRevert} onSelect={onRevert}>
                    <ArrowCounterClockwise aria-hidden size={14} />
                    <span className="flex min-w-0 flex-col">
                        Revert
                        {extras.revertReason ? (
                            <span className="text-xs text-muted-foreground">
                                {extras.revertReason}
                            </span>
                        ) : null}
                    </span>
                </DropdownMenuItem>
            ) : canRevert ? (
                <DropdownMenuItem onSelect={onRevert}>
                    <ArrowCounterClockwise aria-hidden size={14} />
                    Revert
                </DropdownMenuItem>
            ) : null}
        </DropdownMenuContent>
    </DropdownMenu>
)
