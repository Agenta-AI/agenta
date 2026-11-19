import {useRef, useState, type ReactNode} from "react"

import {
    scanSkillFromDataTransfer,
    scanSkillFromFileList,
    type SkillUploadScan,
} from "@agenta/entity-ui/drill-in"
import {cn} from "@agenta/ui/styles"
import {CaretRight, GithubLogo, PencilSimple, UploadSimple} from "@phosphor-icons/react"

/** What a skill upload accepts, wherever it is offered. */
export const SKILL_UPLOAD_ACCEPT = ".zip,.skill,.md,text/markdown,text/plain"

export interface SkillCreateChooserProps {
    onWrite: () => void
    /** The picked or dropped upload, still being read. */
    onUpload: (scan: Promise<SkillUploadScan>) => void
    onImport: () => void
}

const OPTION =
    "relative box-border flex min-h-[60px] py-2.5 w-full cursor-pointer items-center gap-3 rounded-[10px] " +
    "border border-solid border-[color:var(--ag-colorBorderSecondary)] bg-card px-3 text-left font-[inherit] text-foreground " +
    "transition-colors hover:border-border hover:bg-accent/50 focus-visible:outline-none " +
    "focus-visible:ring-[3px] focus-visible:ring-ring/30"
const TILE = "box-border flex size-8 shrink-0 items-center justify-center rounded-lg"

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
        <button
            type="button"
            onClick={onClick}
            className={cn(OPTION, "group", className)}
            {...drop}
        >
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

/** The three ways to add a skill, on the create page and in the playground drawer. */
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
                    <span className={cn(TILE, "bg-colorInfoBg text-colorInfo")}>
                        <PencilSimple size={15} />
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
                    <span className={cn(TILE, "bg-tag-green-bg text-tag-green")}>
                        <UploadSimple size={15} />
                    </span>
                }
            />
            <Option
                onClick={onImport}
                title="Import from GitHub"
                help="Copy one or more skills from a public repository."
                tile={
                    <span className={cn(TILE, "bg-foreground text-background")}>
                        <GithubLogo size={15} weight="fill" />
                    </span>
                }
            />
            <input
                ref={inputRef}
                type="file"
                hidden
                multiple
                accept={SKILL_UPLOAD_ACCEPT}
                onChange={(event) => {
                    const files = event.target.files
                    if (files?.length) onUpload(scanSkillFromFileList(files))
                    event.target.value = ""
                }}
            />
        </div>
    )
}
