import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {ArrowCounterClockwise, DotsThreeVertical, Eye} from "@phosphor-icons/react"

/** A history row's actions. Revert shows only when the reader may deploy and the row is not live. */
export const DeploymentRowMenu = ({
    canRevert,
    onOpen,
    onRevert,
}: {
    canRevert: boolean
    onOpen: () => void
    onRevert: () => void
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
        <DropdownMenuContent align="end" className="w-[200px]">
            <DropdownMenuItem onSelect={onOpen}>
                <Eye aria-hidden size={14} />
                Open details
            </DropdownMenuItem>
            {canRevert ? (
                <DropdownMenuItem onSelect={onRevert}>
                    <ArrowCounterClockwise aria-hidden size={14} />
                    Revert
                </DropdownMenuItem>
            ) : null}
        </DropdownMenuContent>
    </DropdownMenu>
)
