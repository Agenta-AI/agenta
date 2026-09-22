// The `+ New skill ▾` menu, shared by every creation entry point; no default-click action.
// Its rows read like the New agent menu's: a tinted tile, a name, a one-line description.
import {useRef, type ReactNode} from "react"

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

/** One row: a tinted tile, a name, a one-line hint. */
function MenuRow({
    color,
    icon,
    title,
    hint,
    onSelect,
    disabled,
}: {
    color: string
    icon: ReactNode
    title: string
    hint: string
    onSelect: () => void
    disabled?: boolean
}) {
    return (
        <DropdownMenuItem onSelect={onSelect} disabled={disabled}>
            <span
                aria-hidden
                className={cn(TILE, AGENT_ICON_CHIP_CLASS)}
                style={agentIconChipStyle(color)}
            >
                {icon}
            </span>
            <span className="flex min-w-0 flex-col py-0.5">
                <span className="truncate text-sm text-colorText">{title}</span>
                <span className="truncate text-xs text-colorTextTertiary">{hint}</span>
            </span>
        </DropdownMenuItem>
    )
}

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
                <MenuRow
                    color={WRITE_COLOR}
                    icon={<PencilSimple size={15} />}
                    title="Write from scratch"
                    hint="Start with an empty SKILL.md and write it here"
                    onSelect={onWrite}
                    disabled={availability?.write === false}
                />
                {/* Writing is one thing; bringing a skill in from elsewhere is another. */}
                <DropdownMenuSeparator />
                {onUpload ? (
                    <MenuRow
                        color={UPLOAD_COLOR}
                        icon={<UploadSimple size={15} />}
                        title="Upload"
                        hint="A .zip, .skill or SKILL.md, opened in the editor"
                        // The picker has to open inside the click that chose the row; a menu
                        // that closes first would leave no gesture for the browser to honour.
                        onSelect={() => fileInput.current?.click()}
                        disabled={availability?.upload === false}
                    />
                ) : null}
                <MenuRow
                    color={IMPORT_COLOR}
                    icon={<GitBranch size={15} />}
                    title="Import from a repo"
                    hint="Scan a public GitHub repository for SKILL.md folders"
                    onSelect={onImport}
                    disabled={availability?.import === false}
                />
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
