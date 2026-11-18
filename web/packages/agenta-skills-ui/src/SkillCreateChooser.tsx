import {useRef, useState, type ReactNode} from "react"

import {
    scanSkillFromDataTransfer,
    scanSkillFromFileList,
    type SkillUploadScan,
} from "@agenta/entity-ui/drill-in"
import {cn} from "@agenta/ui/styles"
import {CaretRight, GithubLogo, PencilSimple, UploadSimple} from "@phosphor-icons/react"

export interface SkillCreateChooserProps {
    onWrite: () => void
    /** The picked or dropped upload, still being read. */
    onUpload: (scan: Promise<SkillUploadScan>) => void
    onImport: () => void
}

const OPTION =
    "relative box-border flex h-[76px] w-full cursor-pointer items-center gap-3.5 rounded-xl " +
    "border border-solid border-border bg-card p-4 text-left font-[inherit] text-foreground " +
    "transition-colors hover:border-input hover:bg-accent/50 focus-visible:outline-none " +
    "focus-visible:ring-[3px] focus-visible:ring-ring/30"
const TILE =
    "box-border flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-solid"

function Option({
    tile,
    title,
    help,
    onClick,
    className,
    ...drop
}: {
    tile: ReactNode
    title: string
    help: string
    onClick: () => void
    className?: string
} & Pick<React.HTMLAttributes<HTMLButtonElement>, "onDragOver" | "onDragLeave" | "onDrop">) {
    return (
        <button type="button" onClick={onClick} className={cn(OPTION, "group", className)} {...drop}>
            {tile}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{title}</span>
                <span className="text-[13px] leading-[18px] text-muted-foreground">{help}</span>
            </span>
            <CaretRight
                size={16}
                className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
            />
        </button>
    )
}

/** The three ways to add a skill; the list's empty state, the create page and the drawer use it. */
export function SkillCreateChooser({onWrite, onUpload, onImport}: SkillCreateChooserProps) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [dragging, setDragging] = useState(false)

    return (
        <div className="flex flex-col gap-2">
            <Option
                onClick={onWrite}
                title="Write a skill"
                help="Start from a blank page. Name it, describe it and write the steps."
                tile={
                    <span className={cn(TILE, "border-colorInfo/20 bg-colorInfoBg text-colorInfo")}>
                        <PencilSimple size={18} />
                    </span>
                }
            />
            <Option
                onClick={() => inputRef.current?.click()}
                title="Upload"
                help="Choose a SKILL.md file or a .zip, or drop a skill folder here."
                className={cn(dragging && "border-dashed border-foreground")}
                onDragOver={(event) => {
                    event.preventDefault()
                    setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                    event.preventDefault()
                    setDragging(false)
                    onUpload(scanSkillFromDataTransfer(event.dataTransfer))
                }}
                tile={
                    <span
                        className={cn(TILE, "border-tag-green/20 bg-tag-green-bg text-tag-green")}
                    >
                        <UploadSimple size={18} />
                    </span>
                }
            />
            <Option
                onClick={onImport}
                title="Import from GitHub"
                help="Copy one or more skills from a public repository."
                tile={
                    <span className={cn(TILE, "border-foreground bg-foreground text-background")}>
                        <GithubLogo size={18} weight="fill" />
                    </span>
                }
            />
            <input
                ref={inputRef}
                type="file"
                hidden
                accept=".md,.zip,.skill"
                onChange={(event) => {
                    const files = event.target.files
                    if (files?.length) onUpload(scanSkillFromFileList(files))
                    event.target.value = ""
                }}
            />
        </div>
    )
}
