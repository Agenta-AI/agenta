// The `+ New skill ▾` menu, shared by every creation entry point; no default-click action.
// Its rows read like the New agent menu's: a tinted tile, a name, a one-line description.
import {useRef} from "react"

import {scanSkillFromFileList, type SkillUploadScan} from "@agenta/entity-ui/drill-in"
import {AGENT_ICON_CHIP_CLASS, agentIconChipStyle} from "@agenta/ui/agent-icon"
import {cn} from "@agenta/ui/styles"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {GitBranch, PencilSimple, Plus, UploadSimple} from "@phosphor-icons/react"

/** The tiles' colours: the project skill's olive for writing, the palette's blue for a repo,
 * its teal for an upload. */
const WRITE_COLOR = "#6b7d3f"
const UPLOAD_COLOR = "#0F766E"
const IMPORT_COLOR = "#1668DC"

const TILE = "flex size-7 shrink-0 items-center justify-center rounded-md"

export interface NewSkillMenuButtonProps {
    onWrite: () => void
    /**
     * Upload opens the file picker straight away; the scan of what was picked arrives here, so
     * the host can open the editor on it. Absent ⇒ no Upload row.
     */
    onUpload?: (scan: Promise<SkillUploadScan>) => void
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
    const fileInput = useRef<HTMLInputElement>(null)
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
                        className={cn(TILE, AGENT_ICON_CHIP_CLASS)}
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
                {/* Writing is one thing; bringing a skill in from elsewhere is another. */}
                <DropdownMenuSeparator />
                {onUpload ? (
                    <DropdownMenuItem
                        // The picker has to open inside the click that chose the row; a menu
                        // that closes first would leave no gesture for the browser to honour.
                        onSelect={() => fileInput.current?.click()}
                        disabled={availability?.upload === false}
                    >
                        <span
                            aria-hidden
                            className={cn(TILE, AGENT_ICON_CHIP_CLASS)}
                            style={agentIconChipStyle(UPLOAD_COLOR)}
                        >
                            <UploadSimple size={15} />
                        </span>
                        <span className="flex min-w-0 flex-col py-0.5">
                            <span className="truncate text-sm text-colorText">Upload</span>
                            <span className="truncate text-xs text-colorTextTertiary">
                                A .zip, .skill or SKILL.md, opened in the editor
                            </span>
                        </span>
                    </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={onImport} disabled={availability?.import === false}>
                    <span
                        aria-hidden
                        className={cn(TILE, AGENT_ICON_CHIP_CLASS)}
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
            {onUpload ? (
                <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept=".zip,.skill,.md,text/markdown,text/plain"
                    className="hidden"
                    aria-hidden
                    tabIndex={-1}
                    onChange={(event) => {
                        const list = event.target.files
                        if (list && list.length) onUpload(scanSkillFromFileList(list))
                        event.target.value = ""
                    }}
                />
            ) : null}
        </DropdownMenu>
    )
}
