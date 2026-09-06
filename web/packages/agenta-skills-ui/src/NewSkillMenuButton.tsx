/**
 * The single `+ New skill ▾` action — identical everywhere a skill can be created
 * (registry header, picker footer, agent config). One dropdown, three entries; there is
 * deliberately no default-click primary action: every path is one explicit menu choice.
 */
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
}

export function NewSkillMenuButton({
    onWrite,
    onUpload,
    onImport,
    disabled,
    variant = "default",
    availability,
}: NewSkillMenuButtonProps) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant={variant} disabled={disabled} className="gap-1.5">
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
