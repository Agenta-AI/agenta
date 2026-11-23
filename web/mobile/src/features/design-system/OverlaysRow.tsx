import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import {CopyIcon, DotsThreeIcon, PencilSimpleIcon, TrashIcon} from "@phosphor-icons/react"

export function OverlaysRow() {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                        <DotsThreeIcon /> Menu
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                    <DropdownMenuItem>
                        <PencilSimpleIcon /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                        <CopyIcon /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive">
                        <TrashIcon /> Delete agent
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <Select defaultValue="sonnet">
                <SelectTrigger className="w-48">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="sonnet">claude-sonnet-5-5</SelectItem>
                    <SelectItem value="opus">claude-opus-5-5</SelectItem>
                    <SelectItem value="haiku">claude-haiku-5-5</SelectItem>
                </SelectContent>
            </Select>
            <Dialog>
                <DialogTrigger asChild>
                    <Button variant="outline">Dialog</Button>
                </DialogTrigger>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete &ldquo;Weekly report&rdquo;?</DialogTitle>
                        <DialogDescription>The agent and its 14 runs are deleted.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost">Keep agent</Button>
                        <Button variant="destructive">Delete agent</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
