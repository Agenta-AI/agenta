import {useMemo, useRef, useState, type DragEvent, type ReactNode} from "react"
import {createPortal} from "react-dom"

import {MarkdownEditor} from "@agenta/entity-ui/drill-in"
import type {SkillFile} from "@agenta/skills"
import {message} from "@agenta/ui/app-message"
import {useMediaQuery, useScrollFadeEdges} from "@agenta/ui/hooks"
import {cn} from "@agenta/ui/styles"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
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
    FolderOpen,
    PencilSimple,
    Plus,
    Question,
    Trash,
    UploadSimple,
} from "@phosphor-icons/react"

import {SkillFileNameRow} from "./SkillFileNameRow"
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
    /** Below lg, the actions render here instead (a screen's top bar), so they never scroll away. */
    actionsTarget?: HTMLElement | null
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
    "flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-muted text-muted-foreground"
const ROW_ACTION =
    "inline-flex size-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-background hover:text-foreground"
const ROW_BUTTON =
    "cursor-pointer truncate border-0 bg-transparent p-0 text-left font-[inherit] text-sm " +
    "font-medium text-foreground after:absolute after:inset-0 after:content-['']"

const extOf = (path: string) => path.split(".").pop()?.toLowerCase() ?? ""
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
    actionsTarget,
    meta,
    notices,
}: SkillEditorProps) {
    const wide = useMediaQuery("(min-width: 1024px)")
    const inBar = Boolean(actionsTarget) && !wide
    const [openPath, setOpenPath] = useState<string | null>(null)
    const [dragging, setDragging] = useState(false)
    /** The inline name row: a new file in `dir`, or a rename of `path`. */
    const [naming, setNaming] = useState<{path: string | null; dir: string} | null>(null)
    /** A file being dragged to another folder, the folder under the pointer, and the last move. */
    const [dragPath, setDragPath] = useState<string | null>(null)
    const [dropDir, setDropDir] = useState<string | null>(null)
    const [movedPath, setMovedPath] = useState<string | null>(null)
    const [bodyToolbar, setBodyToolbar] = useState<HTMLDivElement | null>(null)
    const [fileToolbar, setFileToolbar] = useState<HTMLDivElement | null>(null)
    const filesListRef = useRef<HTMLDivElement>(null)
    useScrollFadeEdges(filesListRef)
    const pickerRef = useRef<HTMLInputElement>(null)
    const sectionRef = useRef<HTMLElement>(null)

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
    const folders = groups.map(([dir]) => dir).filter(Boolean)
    const takenExcept = (path: string | null) =>
        new Set(draft.files.map((file) => file.path).filter((each) => each !== path))
    const createFile = (path: string) => {
        set({files: [...latest.current.files, {path, content: ""}]})
        setNaming(null)
        openFile(path)
    }
    const renameFile = (from: string, to: string) => {
        set({
            files: latest.current.files.map((file) =>
                file.path === from ? {...file, path: to} : file,
            ),
        })
        setNaming(null)
        if (openPath === from) setOpenPath(to)
    }
    const endDrag = () => {
        setDragPath(null)
        setDropDir(null)
    }
    const moveInto = (dir: string) => {
        const from = dragPath
        endDrag()
        if (!from || dirOf(from) === dir) return
        const to = dir ? `${dir}/${baseOf(from)}` : baseOf(from)
        if (latest.current.files.some((file) => file.path === to)) {
            message.warning(`${dir || "The top level"} already has a file named ${baseOf(from)}.`)
            return
        }
        renameFile(from, to)
        setMovedPath(to)
        window.setTimeout(() => setMovedPath((moved) => (moved === to ? null : moved)), 2800)
    }
    /** Where a dragged file can land: the top level or one folder. */
    const dropZone = (dir: string) => ({
        onDragOver: (event: DragEvent) => {
            if (!dragPath) return
            event.preventDefault()
            event.stopPropagation()
            event.dataTransfer.dropEffect = dirOf(dragPath) === dir ? "none" : "move"
            if (dropDir !== dir) setDropDir(dir)
        },
        onDragLeave: (event: DragEvent) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            setDropDir((current) => (current === dir ? null : current))
        },
        onDrop: (event: DragEvent) => {
            if (!dragPath) return
            event.preventDefault()
            event.stopPropagation()
            moveInto(dir)
        },
        className: cn(
            "flex flex-col gap-0.5 rounded-[10px] transition-[background-color,box-shadow] duration-150 motion-reduce:transition-none",
            dragPath &&
                dropDir === dir &&
                dirOf(dragPath) !== dir &&
                "bg-accent/70 shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--foreground)_22%,transparent)]",
        ),
    })
    const nameRow = (path: string | null, dir: string) => (
        <SkillFileNameRow
            key={path ?? `new:${dir}`}
            isNew={path === null}
            initialPath={path ?? (dir ? `${dir}/` : "")}
            taken={takenExcept(path)}
            onSubmit={(next) => (path ? renameFile(path, next) : createFile(next))}
            onCancel={() => setNaming(null)}
        />
    )
    const setFileContent = (content: string) =>
        set({
            files: draft.files.map((file) => (file.path === openPath ? {...file, content} : file)),
        })
    const setFileExecutable = (executable: boolean) =>
        set({
            files: latest.current.files.map((file) =>
                file.path === openPath ? {...file, executable: executable || undefined} : file,
            ),
        })
    const browse = () => pickerRef.current?.click()
    /** Below lg the editor sits above the list, so bring it into view. */
    const openFile = (path: string | null) => {
        setOpenPath(path)
        requestAnimationFrame(() => {
            const section = sectionRef.current
            if (!section || window.matchMedia("(min-width: 1024px)").matches) return
            if (section.getBoundingClientRect().top < 80)
                section.scrollIntoView({behavior: "smooth", block: "start"})
        })
    }

    const onDrop = (event: DragEvent) => {
        event.preventDefault()
        setDragging(false)
        if (!readOnly && event.dataTransfer.files.length) void addFiles(event.dataTransfer.files)
    }

    const fileRow = (file: SkillFile) => {
        if (naming?.path === file.path) return nameRow(file.path, dirOf(file.path))
        const on = openPath === file.path
        const exec = Boolean(file.executable)
        return (
            <div
                key={file.path}
                title={file.path}
                draggable={!readOnly}
                onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", file.path)
                    event.dataTransfer.effectAllowed = "move"
                    setDragPath(file.path)
                }}
                onDragEnd={endDrag}
                className={cn(
                    "group relative flex items-center gap-2.5 rounded-lg py-1.5 pl-2 pr-1.5 transition-opacity duration-150",
                    on ? "bg-accent" : "hover:bg-accent/60",
                    dragPath === file.path && "opacity-40",
                    movedPath === file.path && "animate-skill-fresh",
                )}
            >
                <span aria-hidden className={ROW_ICON}>
                    <FileIcon size={14} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <button
                        type="button"
                        aria-current={on ? "true" : undefined}
                        onClick={() => openFile(file.path)}
                        onDoubleClick={() =>
                            readOnly ? undefined : setNaming({path: file.path, dir: dirOf(file.path)})
                        }
                        className={ROW_BUTTON}
                    >
                        {baseOf(file.path)}
                    </button>
                    {exec ? (
                        <span
                            className={cn(
                                "truncate text-xs",
                                draft.allowExecutable ? "text-muted-foreground" : "text-tag-orange",
                            )}
                        >
                            {draft.allowExecutable ? "Runs as a program" : "Program, turned off"}
                        </span>
                    ) : null}
                </span>
                {readOnly ? null : (
                    <span className="relative z-[1] flex shrink-0 items-center opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
                        <button
                            type="button"
                            aria-label={`Rename ${baseOf(file.path)}`}
                            title="Rename or move"
                            onClick={() => setNaming({path: file.path, dir: dirOf(file.path)})}
                            className={ROW_ACTION}
                        >
                            <PencilSimple size={13} />
                        </button>
                        <button
                            type="button"
                            aria-label={`Remove ${baseOf(file.path)}`}
                            title="Remove"
                            onClick={() => removeFile(file.path)}
                            className={ROW_ACTION}
                        >
                            <Trash size={13} />
                        </button>
                    </span>
                )}
            </div>
        )
    }

    const richEditor = (
        value: string,
        onValue: (next: string) => void,
        toolbar: HTMLDivElement | null,
        missing = false,
        placeholder = "Write the steps the agent should follow, in plain words.",
    ) => (
        <div
            className={cn(
                "md-doc flex h-[min(560px,65dvh)] min-h-[320px] flex-col rounded-[10px]",
                fill && "lg:h-auto lg:min-h-0 lg:flex-1",
                missing &&
                    "[&_div:has(>.md-prose)]:border-destructive [&_div:has(>.md-prose)]:ring-[3px] [&_div:has(>.md-prose)]:ring-destructive/15",
            )}
        >
            <MarkdownEditor
                value={value}
                onChange={onValue}
                placeholder={placeholder}
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
            <div className="flex min-h-6 items-center gap-2">
                <FileText size={16} className="shrink-0 text-muted-foreground" />
                <span title={current.path} className="flex min-w-0 flex-1 items-baseline text-sm">
                    {dirOf(current.path) ? (
                        <span className="min-w-0 shrink-[3] truncate text-muted-foreground">
                            {dirOf(current.path)}/
                        </span>
                    ) : null}
                    <label htmlFor="skill-file" className="min-w-0 truncate font-medium">
                        {baseOf(current.path)}
                    </label>
                </span>
                {fileIsMd ? (
                    <div ref={setFileToolbar} className="flex min-w-0 justify-end max-sm:hidden [&_button]:size-6" />
                ) : readOnly ? null : (
                    <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-2 text-[13px] text-muted-foreground">
                        Run as a program
                        <Switch
                            size="sm"
                            checked={Boolean(current.executable)}
                            onCheckedChange={setFileExecutable}
                        />
                    </label>
                )}
            </div>
            {current.executable && !draft.allowExecutable ? (
                <p className="m-0 text-[13px] leading-[18px] text-tag-orange">
                    Turn on “Let files run as programs” so this file can run.
                </p>
            ) : null}
            {fileIsMd ? (
                <div className="flex min-h-0 flex-1 flex-col">
                    {richEditor(
                        current.content,
                        setFileContent,
                        fileToolbar,
                        false,
                        "Write this file in plain words.",
                    )}
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
                            "-ml-1 box-border w-full text-ellipsis rounded-md border-0 bg-transparent px-1 font-[inherit] text-[19px] font-semibold leading-7 text-foreground outline-none placeholder:text-placeholder hover:bg-accent/60 focus:bg-transparent focus-visible:shadow-none sm:text-[26px] sm:leading-9",
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
                {actions && !inBar ? (
                    <div className="flex items-center gap-1 pt-0.5">{actions}</div>
                ) : null}
                {actions && inBar && actionsTarget ? createPortal(actions, actionsTarget) : null}
            </div>

            {notices}

            <div
                className={cn(
                    "mt-1 flex flex-col gap-6 lg:flex-row lg:items-stretch",
                    fill && "flex-1 lg:min-h-0",
                )}
            >
                <section
                    ref={sectionRef}
                    className={cn(
                        "relative flex min-w-0 scroll-mt-4 flex-col lg:flex-[999_1_480px]",
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
                        "flex min-h-[280px] min-w-0 flex-col gap-1.5 lg:max-w-[360px] lg:flex-[1_1_280px]",
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
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="text-muted-foreground"
                                    >
                                        <Plus size={14} />
                                        Add
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align="end"
                                    className="min-w-[160px]"
                                    onCloseAutoFocus={(event) => event.preventDefault()}
                                >
                                    <DropdownMenuItem
                                        onSelect={() => setNaming({path: null, dir: ""})}
                                        className="gap-2 text-[13px]"
                                    >
                                        <FilePlus size={15} className="text-muted-foreground" />
                                        New file
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={browse} className="gap-2 text-[13px]">
                                        <UploadSimple size={15} className="text-muted-foreground" />
                                        Upload files
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : null}
                    </div>
                    <div
                        onDragOver={(event) => {
                            if (readOnly || !event.dataTransfer.types.includes("Files")) return
                            event.preventDefault()
                            setDragging(true)
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={onDrop}
                        className={cn(
                            "box-border flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border bg-background transition-colors duration-150",
                            dragging ? "border-dashed border-foreground" : "border-solid border-input",
                        )}
                    >
                        <div
                            ref={filesListRef}
                            className="ag-scroll-fade flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5"
                        >
                        {hasFiles || naming ? (
                            <>
                                <div {...dropZone("")}>
                                <div
                                    className={cn(
                                        "relative flex items-center gap-2.5 rounded-lg py-1.5 pl-2 pr-1.5",
                                        current ? "hover:bg-accent/60" : "bg-accent",
                                    )}
                                >
                                    <span aria-hidden className={ROW_ICON}>
                                        <FileText size={14} />
                                    </span>
                                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                                        <button
                                            type="button"
                                            aria-current={current ? undefined : "true"}
                                            onClick={() => openFile(null)}
                                            className={ROW_BUTTON}
                                        >
                                            SKILL.md
                                        </button>
                                    </span>
                                </div>
                                    {naming?.path === null && !folders.includes(naming.dir)
                                        ? nameRow(null, naming.dir)
                                        : null}
                                    {(groups.find(([dir]) => dir === "")?.[1] ?? []).map(fileRow)}
                                </div>
                                {groups
                                    .filter(([dir]) => dir)
                                    .map(([dir, files]) => {
                                        const target =
                                            dragPath !== null && dropDir === dir && dirOf(dragPath) !== dir
                                        return (
                                            <div key={dir} {...dropZone(dir)}>
                                                <div className="group/folder flex items-center gap-1.5 px-2 pb-1 pt-2.5 text-xs font-medium text-muted-foreground">
                                                    {target ? (
                                                        <FolderOpen size={14} className="text-foreground" />
                                                    ) : (
                                                        <Folder size={14} />
                                                    )}
                                                    <span
                                                        className={cn(
                                                            "flex-1 truncate transition-colors duration-150",
                                                            target && "text-foreground",
                                                        )}
                                                    >
                                                        {dir}
                                                    </span>
                                                    {readOnly ? null : (
                                                        <button
                                                            type="button"
                                                            aria-label={`New file in ${dir}`}
                                                            title="New file here"
                                                            onClick={() => setNaming({path: null, dir})}
                                                            className="-my-1 inline-flex size-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/folder:opacity-100 max-sm:opacity-100"
                                                        >
                                                            <Plus size={13} />
                                                        </button>
                                                    )}
                                                </div>
                                                {naming?.path === null && naming.dir === dir
                                                    ? nameRow(null, dir)
                                                    : null}
                                                {files.map(fileRow)}
                                            </div>
                                        )
                                    })}
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
                                    <span className="flex items-center gap-1">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setNaming({path: null, dir: ""})}
                                        >
                                            <FilePlus size={14} />
                                            New file
                                        </Button>
                                        <Button type="button" variant="ghost" size="sm" onClick={browse}>
                                            <UploadSimple size={14} />
                                            Upload
                                        </Button>
                                    </span>
                                )}
                            </div>
                        )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2.5 bg-[color:color-mix(in_srgb,var(--ag-colorFillTertiary)_50%,transparent)] px-3.5 py-2.5">
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
