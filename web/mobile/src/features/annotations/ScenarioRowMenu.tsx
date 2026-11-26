import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {DotsThreeVertical, NotePencil, Target} from "@phosphor-icons/react"

/** An item's actions: annotate it here, or open it in the focus view. */
export const ScenarioRowMenu = ({
    onAnnotate,
    onOpenInFocus,
}: {
    onAnnotate: () => void
    onOpenInFocus: () => void
}) => (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Item actions"
                className="hover:bg-foreground/10 dark:hover:bg-foreground/15"
            >
                <DotsThreeVertical aria-hidden className="size-3.5" weight="bold" />
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[180px]">
            <DropdownMenuItem onSelect={onAnnotate}>
                <NotePencil aria-hidden size={14} />
                Annotate
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenInFocus}>
                <Target aria-hidden size={14} />
                Open in Focus View
            </DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
)
