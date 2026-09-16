// The `+ New skill ▾` menu, shared by every creation entry point; no default-click action.
// Its rows read like the New agent menu's: a tinted tile, a name, a one-line description.
import {AGENT_ICON_CHIP_CLASS, agentIconChipStyle} from "@agenta/ui/agent-icon"
import {cn} from "@agenta/ui/styles"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {GitBranch, PencilSimple, Plus} from "@phosphor-icons/react"

/** The tiles' colours: the project skill's olive for writing, the palette's blue for a repo. */
const WRITE_COLOR = "#6b7d3f"
const IMPORT_COLOR = "#1668DC"

export interface NewSkillMenuButtonProps {
    onWrite: () => void
    onImport: () => void
    disabled?: boolean
    /** "outline" for in-drawer placements; "default" for the page header. */
    variant?: "default" | "outline"
    /** Per-entry gating while flows ship incrementally; every entry defaults available. */
    availability?: {write?: boolean; import?: boolean}
    /** Layout classes from the placement — e.g. the toolbar pinning it to the right edge. */
    className?: string
}

export function NewSkillMenuButton({
    onWrite,
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
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-[320px]">
                <DropdownMenuItem onSelect={onWrite} disabled={availability?.write === false}>
                    <span
                        aria-hidden
                        className={cn(
                            "flex size-7 shrink-0 items-center justify-center rounded-md",
                            AGENT_ICON_CHIP_CLASS,
                        )}
                        style={agentIconChipStyle(WRITE_COLOR)}
                    >
                        <PencilSimple size={15} />
                    </span>
                    <span className="flex min-w-0 flex-col py-0.5">
                        <span className="truncate text-sm text-colorText">Write from scratch</span>
                        <span className="truncate text-xs text-colorTextTertiary">
                            Start with an empty SKILL.md and write it here
                        </span>
                    </span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onImport} disabled={availability?.import === false}>
                    <span
                        aria-hidden
                        className={cn(
                            "flex size-7 shrink-0 items-center justify-center rounded-md",
                            AGENT_ICON_CHIP_CLASS,
                        )}
                        style={agentIconChipStyle(IMPORT_COLOR)}
                    >
                        <GitBranch size={15} />
                    </span>
                    <span className="flex min-w-0 flex-col py-0.5">
                        <span className="truncate text-sm text-colorText">Import from a repo</span>
                        <span className="truncate text-xs text-colorTextTertiary">
                            Scan a public GitHub repository for SKILL.md folders
                        </span>
                    </span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
