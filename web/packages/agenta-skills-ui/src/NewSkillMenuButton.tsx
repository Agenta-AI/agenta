// The `+ New skill ▾` menu, shared by every creation entry point; no default-click action.
import {cn} from "@agenta/ui/styles"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CaretDown, DownloadSimple, GitBranch, PencilSimple, Plus} from "@phosphor-icons/react"

export interface NewSkillMenuButtonProps {
    onWrite: () => void
    onUpload: () => void
    onImport: () => void
    disabled?: boolean
    /** "outline" for in-drawer placements; "default" for the page header. */
    variant?: "default" | "outline"
    /** Per-entry gating while flows ship incrementally; every entry defaults available. */
    availability?: {write?: boolean; upload?: boolean; import?: boolean}
    /** Layout classes from the placement — e.g. the toolbar pinning it to the right edge. */
    className?: string
}

export function NewSkillMenuButton({
    onWrite,
    onUpload,
    onImport,
    disabled,
    variant = "default",
    availability,
    className,
}: NewSkillMenuButtonProps) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant={variant} disabled={disabled} className={cn("gap-1.5", className)}>
                    <Plus size={14} />
                    New skill
                    <CaretDown size={12} className="opacity-70" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onWrite} disabled={availability?.write === false}>
                    <PencilSimple size={14} />
                    Write from scratch
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onUpload} disabled={availability?.upload === false}>
                    <DownloadSimple size={14} />
                    Upload a folder, .zip or .skill
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onImport} disabled={availability?.import === false}>
                    <GitBranch size={14} />
                    Import from a repo…
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
