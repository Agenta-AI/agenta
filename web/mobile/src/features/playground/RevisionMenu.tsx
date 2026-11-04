import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {ArrowCounterClockwise, Copy, DotsThreeVertical, Rocket, Trash} from "@phosphor-icons/react"

/** A menu item's name, with the reason under it when the reader may not use it. */
const MenuLabel = ({hint, children}: {hint: string | null; children: string}) => (
    <span className="flex flex-col">
        {children}
        {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </span>
)

/**
 * The menu behind the three dots. Deploy sits here on a phone, where the bar has no room for it.
 * A verb the reader may not use stays in the list, disabled.
 */
export const RevisionMenu = ({
    dirty,
    canDeploy,
    canDelete,
    deployHint,
    deleteHint,
    onCopyConfig,
    onRevert,
    onDeploy,
    onDelete,
}: {
    dirty: boolean
    canDeploy: boolean
    canDelete: boolean
    /** Why Deploy or Delete is disabled, when the role is the reason. */
    deployHint: string | null
    deleteHint: string | null
    onCopyConfig: () => void
    onRevert: () => void
    onDeploy: () => void
    onDelete: () => void
}) => (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Revision actions">
                <DotsThreeVertical aria-hidden weight="bold" />
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[200px]">
            <DropdownMenuItem className="sm:hidden" disabled={!canDeploy} onSelect={onDeploy}>
                <Rocket aria-hidden size={14} />
                <MenuLabel hint={deployHint}>Deploy</MenuLabel>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onCopyConfig}>
                <Copy aria-hidden size={14} />
                Copy raw config
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!dirty} onSelect={onRevert}>
                <ArrowCounterClockwise aria-hidden size={14} />
                Revert Changes
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" disabled={!canDelete} onSelect={onDelete}>
                <Trash aria-hidden size={14} />
                <MenuLabel hint={deleteHint}>Delete</MenuLabel>
            </DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
)
