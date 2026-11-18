import {useMemo, useRef, useState, type DragEvent, type ReactNode} from "react"

import {MarkdownEditor} from "@agenta/entity-ui/drill-in"
import type {SkillFile} from "@agenta/skills"
import {cn} from "@agenta/ui/styles"
import {
    Button,
    Switch,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {
    File as FileIcon,
    FilePlus,
    FileText,
    Folder,
    Plus,
    Question,
    Trash,
} from "@phosphor-icons/react"

import {descriptionTooLong, type SkillDraft} from "./skillDraft"

export interface SkillEditorProps {
    draft: SkillDraft
    onChange: (next: SkillDraft) => void
    readOnly?: boolean
    /** Paints empty required fields red once a save was tried. */
    showMissing?: boolean
    autoFocusTitle?: boolean
    /** From the lg breakpoint, fill the page height; the fields scroll inside. */
    fill?: boolean
    /** Right of the title. */
    actions?: ReactNode
    /** Under the title. */
    meta?: ReactNode
    /** Above the body. */
    notices?: ReactNode
}

const FIELD =
    "box-border w-full rounded-[10px] border border-solid border-input bg-background " +
    "font-[inherit] text-foreground outline-none transition-[border-color,box-shadow] " +
    "placeholder:text-placeholder focus:border-ring focus:ring-[3px] focus:ring-ring/30"
const MISSING =
    "border-destructive! ring-[3px] ring-destructive/15 focus:border-destructive! focus:ring-destructive/25"
const MISSING_TEXT = "m-0 text-[13px] leading-[18px] text-destructive"
const ROW_ICON =
    "flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
const ROW_BUTTON =
    "cursor-pointer truncate border-0 bg-transparent p-0 text-left font-[inherit] text-sm " +
    "font-medium text-foreground after:absolute after:inset-0 after:content-['']"

const KIND: Record<string, string> = {
    py: "Python script",
    js: "JavaScript",
    ts: "TypeScript",
    sh: "Shell script",
    csv: "CSV data",
    json: "JSON",
    md: "Markdown",
    txt: "Text",
    yaml: "YAML",
    yml: "YAML",
}
const extOf = (path: string) => path.split(".").pop()?.toLowerCase() ?? ""
const kindOf = (path: string) => KIND[extOf(path)] ?? "File"
const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "")
const baseOf = (path: string) => path.split("/").pop() ?? path

function Hint({label, children}: {label: string; children: ReactNode}) {
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        aria-label={label}
                        className="inline-flex size-5 cursor-help items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted-foreground"
                    >
                        <Question size={15} />
                    </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px]">
                    {children}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

async function readTextFiles(list: FileList | File[]): Promise<SkillFile[]> {
    const read = await Promise.all(
        Array.from(list).map(async (file) => {
            const content = await file.text()
            if (content.includes("\u0000")) return null
            return {path: file.webkitRelativePath || file.name, content}
        }),
    )
    return read.filter((file): file is SkillFile => file !== null)
}

/** The skill editor the skill page, the create page and the playground drawer share. */
export function SkillEditor({
    draft,
    onChange,
    readOnly = false,
    showMissing = false,
    autoFocusTitle = false,
    fill = false,
    actions,
    meta,
    notices,
}: SkillEditorProps) {
    const [openPath, setOpenPath] = useState<string | null>(null)
    const [dragging, setDragging] = useState(false)
    const [bodyToolbar, setBodyToolbar] = useState<HTMLDivElement | null>(null)
    const [fileToolbar, setFileToolbar] = useState<HTMLDivElement | null>(null)
    const pickerRef = useRef<HTMLInputElement>(null)

    const latest = useRef(draft)
    latest.current = draft
    const set = (patch: Partial<SkillDraft>) => onChange({...latest.current, ...patch})
    const tooLong = descriptionTooLong(draft)
    const current = draft.files.find((file) => file.path === openPath) ?? null
    const hasFiles = draft.files.length > 0
    const fileIsMd = current ? extOf(current.path) === "md" : false

    const groups = useMemo(() => {
        const byDir = new Map<string, SkillFile[]>()
        for (const file of draft.files) {
            const dir = dirOf(file.path)
            byDir.set(dir, [...(byDir.get(dir) ?? []), file])
        }
        return [...byDir.entries()].sort(([a], [b]) =>
            a === "" ? -1 : b === "" ? 1 : a.localeCompare(b),
        )
    }, [draft.files])

    const addFiles = async (list: FileList | File[]) => {
        const added = await readTextFiles(list)
        if (!added.length) return
        const files = latest.current.files
        const byPath = new Map(files.map((file) => [file.path, file]))
        const merged = added.map((file) => ({...byPath.get(file.path), ...file}))
        const paths = new Set(added.map((file) => file.path))
        set({files: [...files.filter((file) => !paths.has(file.path)), ...merged]})
    }
    const removeFile = (path: string) => {
        set({files: draft.files.filter((file) => file.path !== path)})
        if (openPath === path) setOpenPath(null)
    }
    const setFileContent = (content: string) =>
        set({
            files: draft.files.map((file) => (file.path === openPath ? {...file, content} : file)),
        })
    const browse = () => pickerRef.current?.click()

    const onDrop = (event: DragEvent) => {
        event.preventDefault()
        setDragging(false)
        if (!readOnly && event.dataTransfer.files.length) void addFiles(event.dataTransfer.files)
    }

    const fileRow = (file: SkillFile) => {
        const on = openPath === file.path
        const exec = Boolean(file.executable)
        return (
            <div
                key={file.path}
                title={file.path}
                className={cn(
                    "group relative flex items-center gap-3 rounded-lg py-2 pl-2 pr-1.5",
                    on ? "bg-accent" : "hover:bg-accent/60",
                )}
            >
                <span aria-hidden className={ROW_ICON}>
                    <FileIcon size={16} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <button
                        type="button"
                        aria-current={on ? "true" : undefined}
                        onClick={() => setOpenPath(file.path)}
                        className={ROW_BUTTON}
                    >
                        {baseOf(file.path)}
                    </button>
                    <span
                        className={cn(
                            "truncate text-xs",
                            exec && !draft.allowExecutable
                                ? "text-tag-orange"
                                : "text-muted-foreground",
                        )}
                    >
                        {kindOf(file.path)}
                        {exec
                            ? draft.allowExecutable
                                ? " · Runs as a program"
                                : " · Program, turned off"
                            : ""}
                    </span>
                </span>
                {readOnly ? null : (
                    <button
                        type="button"
                        aria-label={`Remove ${baseOf(file.path)}`}
                        onClick={() => removeFile(file.path)}
                        className="relative z-[1] inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
                    >
                        <Trash size={15} />
                    </button>
                )}
            </div>
        )
    }

    const richEditor = (
        value: string,
        onValue: (next: string) => void,
        toolbar: HTMLDivElement | null,
        missing = false,
    ) => (
        <div
            className={cn(
                "flex min-h-[360px] flex-1 flex-col rounded-[10px]",
                fill ? "lg:min-h-0" : "sm:min-h-[600px]",
                missing &&
                    "[&_div:has(>.md-prose)]:border-destructive [&_div:has(>.md-prose)]:ring-[3px] [&_div:has(>.md-prose)]:ring-destructive/15",
            )}
        >
            <MarkdownEditor
                value={value}
                onChange={onValue}
                placeholder="Write the steps the agent should follow, in plain words."
                editable={!readOnly}
                showToolbar={!readOnly}
                toolbarContainer={toolbar}
                toolbarLayout="inline"
                defaultView="rendered"
                hideHeader
                grow
            />
        </div>
    )

    const instructions = (
        <div className={cn("flex flex-1 flex-col gap-1.5", fill && "lg:min-h-0")}>
            <div className="flex min-h-6 flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium">Instructions</span>
                <Hint label="About the instructions">
                    The steps the agent follows when it uses this skill.
                </Hint>
                <div ref={setBodyToolbar} className="flex min-w-0 flex-1 justify-end max-sm:hidden [&_button]:size-6" />
            </div>
            {richEditor(
                draft.body,
                (body) => set({body}),
                bodyToolbar,
                showMissing && !draft.body.trim(),
            )}
            {showMissing && !draft.body.trim() ? (
                <p role="alert" className={MISSING_TEXT}>
                    Write the steps the agent should follow.
                </p>
            ) : null}
        </div>
    )

    const fileView = current ? (
        <div
            key={current.path}
            className="absolute inset-0 flex animate-skill-enter flex-col gap-1.5"
        >
            <div className="flex min-h-6 flex-wrap items-center gap-2">
                <FileText size={16} className="text-muted-foreground" />
                <span className="flex min-w-0 items-baseline gap-0.5 truncate text-sm">
                    {dirOf(current.path) ? (
                        <span className="truncate text-muted-foreground">
                            {dirOf(current.path)}/
                        </span>
                    ) : null}
                    <label htmlFor="skill-file" className="font-medium">
                        {baseOf(current.path)}
                    </label>
                </span>
                {fileIsMd ? (
                    <div ref={setFileToolbar} className="flex min-w-0 flex-1 justify-end max-sm:hidden [&_button]:size-6" />
                ) : null}
            </div>
            {fileIsMd ? (
                <div className="flex min-h-0 flex-1 flex-col">
                    {richEditor(current.content, setFileContent, fileToolbar)}
                </div>
            ) : (
                <textarea
                    id="skill-file"
                    value={current.content}
                    readOnly={readOnly}
                    spellCheck={false}
                    onChange={(event) => setFileContent(event.target.value)}
                    className={cn(
                        FIELD,
                        "min-h-0 flex-1 resize-none px-4 py-3.5 font-mono text-[13px] leading-[21px]",
                    )}
                />
            )}
        </div>
    ) : null

    return (
        <div className={cn("flex min-w-0 flex-col gap-4", fill && "flex-1 lg:min-h-0")}>
            <div className="flex flex-wrap items-start gap-3">
                <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
                    <label htmlFor="skill-title" className="sr-only">
                        Skill name
                    </label>
                    <input
                        id="skill-title"
                        value={draft.title}
                        readOnly={readOnly}
                        autoFocus={autoFocusTitle}
                        onChange={(event) => set({title: event.target.value})}
                        placeholder="Name your skill, e.g. Weekly report"
                        className={cn(
                            "-ml-1 box-border w-full rounded-md border-0 bg-transparent px-1 font-[inherit] text-[19px] font-semibold leading-7 text-foreground outline-none placeholder:text-placeholder hover:bg-accent/60 focus:bg-transparent focus-visible:shadow-none sm:text-[26px] sm:leading-9",
                            readOnly && "hover:bg-transparent",
                            showMissing && !draft.title.trim() && "ring-[3px] ring-destructive/30",
                        )}
                    />
                    {showMissing && !draft.title.trim() ? (
                        <p role="alert" className={MISSING_TEXT}>
                            Name the skill.
                        </p>
                    ) : null}
                    {meta}
                </div>
                {actions ? <div className="flex items-center gap-2 pt-0.5">{actions}</div> : null}
            </div>

            {notices}

            <div
                className={cn(
                    "mt-1 flex flex-wrap items-stretch gap-6",
                    fill && "flex-1 lg:min-h-0 lg:flex-nowrap",
                )}
            >
                <section
                    className={cn(
                        "relative flex min-w-0 flex-[999_1_480px] flex-col",
                        fill && "lg:min-h-0",
                    )}
                >
                    <div
                        key={current ? "file" : "skill"}
                        className={cn(
                            "flex flex-1 flex-col gap-5",
                            fill && "lg:min-h-0",
                            current ? "invisible" : "animate-skill-enter",
                        )}
                        aria-hidden={current ? true : undefined}
                    >
                        <div className="flex flex-col gap-1.5">
                            <div className="flex min-h-6 items-center gap-1.5">
                                <label htmlFor="skill-description" className="text-sm font-medium">
                                    Description
                                </label>
                                <Hint label="About the description">
                                    Agents read this to decide when the skill fits a task.
                                </Hint>
                            </div>
                            <textarea
                                id="skill-description"
                                rows={2}
                                value={draft.description}
                                readOnly={readOnly}
                                onChange={(event) => set({description: event.target.value})}
                                placeholder="e.g. Use when someone asks for a weekly summary of the team's work."
                                className={cn(
                                    FIELD,
                                    "max-h-[84px] min-h-[66px] resize-y overflow-y-auto px-3 py-2.5 text-sm leading-5 [field-sizing:content]",
                                    (tooLong || (showMissing && !draft.description.trim())) &&
                                        MISSING,
                                )}
                            />
                            {tooLong ? (
                                <span className="text-[13px] leading-[18px] text-destructive">
                                    Shorten it to 1,024 characters or fewer. Agents cannot read a
                                    longer description.
                                </span>
                            ) : showMissing && !draft.description.trim() ? (
                                <p role="alert" className={MISSING_TEXT}>
                                    Add a description so agents know when to use this skill.
                                </p>
                            ) : null}
                        </div>
                        {instructions}
                    </div>
                    {fileView}
                </section>

                <aside
                    aria-label="Files"
                    className={cn(
                        "flex min-h-[280px] min-w-0 flex-[1_1_280px] flex-col gap-1.5 sm:max-w-[360px]",
                        fill && "lg:min-h-0",
                    )}
                >
                    <div className="flex min-h-6 items-center gap-1.5">
                        <span className="text-sm font-medium">Files</span>
                        <Hint label="About files">
                            Scripts, templates and examples the agent can open while it follows the
                            instructions.
                        </Hint>
                        <span className="flex-1" />
                        {hasFiles && !readOnly ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground"
                                onClick={browse}
                            >
                                <Plus size={14} />
                                Add
                            </Button>
                        ) : null}
                    </div>
                    <div
                        onDragOver={(event) => {
                            if (readOnly) return
                            event.preventDefault()
                            setDragging(true)
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={onDrop}
                        className={cn(
                            "box-border flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto rounded-[10px] border border-solid border-input bg-background p-1.5",
                            dragging && "border-dashed border-foreground",
                        )}
                    >
                        {hasFiles ? (
                            <>
                                <div
                                    className={cn(
                                        "relative flex items-center gap-3 rounded-lg py-2 pl-2 pr-1.5",
                                        current ? "hover:bg-accent/60" : "bg-accent",
                                    )}
                                >
                                    <span aria-hidden className={ROW_ICON}>
                                        <FileText size={16} />
                                    </span>
                                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                                        <button
                                            type="button"
                                            aria-current={current ? undefined : "true"}
                                            onClick={() => setOpenPath(null)}
                                            className={ROW_BUTTON}
                                        >
                                            SKILL.md
                                        </button>
                                        <span className="text-xs text-muted-foreground">
                                            Description and instructions
                                        </span>
                                    </span>
                                </div>
                                {groups.map(([dir, files]) => (
                                    <div key={dir || "root"} className="flex flex-col gap-0.5">
                                        {dir ? (
                                            <div className="flex items-center gap-1.5 px-2 pb-1 pt-2.5 text-xs font-medium text-muted-foreground">
                                                <Folder size={14} />
                                                <span className="truncate">{dir}</span>
                                            </div>
                                        ) : null}
                                        {files.map(fileRow)}
                                    </div>
                                ))}
                            </>
                        ) : (
                            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center">
                                <span
                                    aria-hidden
                                    className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground"
                                >
                                    <FilePlus size={20} />
                                </span>
                                <span className="flex flex-col gap-1">
                                    <span className="text-sm font-medium">No files yet</span>
                                    <span className="max-w-[240px] text-[13px] leading-[18px] text-muted-foreground">
                                        {readOnly
                                            ? "This skill has only its instructions."
                                            : "Add scripts, templates or examples the agent can use."}
                                    </span>
                                </span>
                                {readOnly ? null : (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={browse}
                                    >
                                        <Plus size={14} />
                                        Add files
                                    </Button>
                                )}
                            </div>
                        )}
                        <div className="-mx-1.5 -mb-1.5 mt-auto flex items-center gap-2.5 rounded-b-[9px] bg-[color:color-mix(in_srgb,var(--ag-colorFillTertiary)_50%,transparent)] px-3.5 py-2.5">
                            <span id="skill-exec-label" className="flex-1 text-[13px] font-medium">
                                Let files run as programs
                            </span>
                            <Switch
                                size="sm"
                                aria-labelledby="skill-exec-label"
                                checked={draft.allowExecutable}
                                disabled={readOnly}
                                onCheckedChange={(allowExecutable) => set({allowExecutable})}
                            />
                        </div>
                    </div>
                    <input
                        ref={pickerRef}
                        type="file"
                        multiple
                        hidden
                        onChange={(event) => {
                            if (event.target.files) void addFiles(event.target.files)
                            event.target.value = ""
                        }}
                    />
                </aside>
            </div>
        </div>
    )
}
