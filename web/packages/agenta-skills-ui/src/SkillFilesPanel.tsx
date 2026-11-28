import {memo, useId, useMemo, useRef, useState, type DragEvent} from "react"

import {formatList, useT} from "@agenta/i18n"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import type {SkillFile} from "@agenta/skills"
import {message} from "@agenta/ui/app-message"
import {IconTile, SimpleTooltip} from "@agenta/ui/composed"
import {
    COARSE_POINTER_QUERY,
    COMPACT_WINDOW_QUERY,
    useScrollFadeEdges,
    useWindowMatch,
} from "@agenta/ui/hooks"
import {cn} from "@agenta/ui/styles"
import {
    Badge,
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    Switch,
} from "@agenta/ui/ui"
import {
    FilePlus,
    FileText,
    Folder,
    PencilSimple,
    Plus,
    Trash,
    UploadSimple,
    Warning,
} from "@phosphor-icons/react"
import {createPortal} from "react-dom"

import {baseOf, dirOf} from "./skillDraft"
import {filePathProblem, SkillFileNameRow} from "./SkillFileNameRow"

// The row draws its button's focus ring inset, so the list scroller cannot clip it.
const ROW =
    "group relative flex min-h-row-single items-center gap-2 rounded-md px-2 text-label transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none has-[>button:focus-visible]:outline-solid has-[>button:focus-visible]:outline-2 has-[>button:focus-visible]:outline-offset-[-2px] has-[>button:focus-visible]:outline-ring"
const ROW_BUTTON =
    "min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-[inherit] text-label text-foreground outline-none after:absolute after:inset-0 after:content-['']"
const ROW_ACTIONS =
    "relative z-sticky flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-[var(--duration-fast)] focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none"

/** Reads uploads as text; binary, unreadable and unusable paths (SKILL.md, taken) are skipped. */
async function readUploads(list: FileList | File[], existing: ReadonlySet<string>) {
    const taken = new Set(existing)
    const added: SkillFile[] = []
    const skipped: string[] = []
    for (const file of Array.from(list)) {
        const path = file.webkitRelativePath || file.name
        const content = await file.text().catch(() => null)
        if (content === null || content.includes("\u0000") || filePathProblem(path, taken)) {
            skipped.push(baseOf(path))
            continue
        }
        taken.add(path)
        added.push({path, content})
    }
    return {added, skipped}
}

export interface SkillFilesPanelProps {
    files: SkillFile[]
    allowExecutable: boolean
    readOnly: boolean
    /** The open file; null is SKILL.md. */
    openPath: string | null
    onOpen: (path: string | null) => void
    /** A file moved or went away: `to` is its new path, or null. */
    onMoved: (from: string, to: string | null) => void
    /** Applies a change to the latest files, so a stale list never overwrites a newer one. */
    onFiles: (update: (files: SkillFile[]) => SkillFile[]) => void
    onAllowExecutable: (allow: boolean) => void
    /** Where the Add menu goes (the pane header); unset, it sits on top of the list. */
    addSlot?: HTMLElement | null
    /** In the right pane: the programs switch stays pinned to the pane's bottom edge. */
    docked?: boolean
}

/** The files navigator of a skill. Memoized with stable callbacks, so typing elsewhere skips it. */
export const SkillFilesPanel = memo(function SkillFilesPanel({
    files,
    allowExecutable,
    readOnly,
    openPath,
    onOpen,
    onMoved,
    onFiles,
    onAllowExecutable,
    docked = false,
    addSlot,
}: SkillFilesPanelProps) {
    const t = useT(skillsEditorCatalog)
    const [dragging, setDragging] = useState(false)
    /** The inline name row: a new file in `dir`, or a rename of `path`. */
    const [naming, setNaming] = useState<{path: string | null; dir: string} | null>(null)
    /** A file dragged to another folder, and the folder under the pointer. */
    const [dragPath, setDragPath] = useState<string | null>(null)
    const [dropDir, setDropDir] = useState<string | null>(null)
    const switchId = useId()
    const hintId = useId()
    const pickerRef = useRef<HTMLInputElement>(null)
    // Phones and touch screens cannot drop files, so the empty copy leaves dropping out.
    const noDrop = useWindowMatch(`${COARSE_POINTER_QUERY}, ${COMPACT_WINDOW_QUERY}`)
    const listRef = useRef<HTMLDivElement>(null)
    useScrollFadeEdges(listRef, {enabled: docked})

    const groups = useMemo(() => {
        const byDir = new Map<string, SkillFile[]>()
        for (const file of files) {
            const dir = dirOf(file.path)
            byDir.set(dir, [...(byDir.get(dir) ?? []), file])
        }
        return [...byDir.entries()].sort(([a], [b]) =>
            a === "" ? -1 : b === "" ? 1 : a.localeCompare(b),
        )
    }, [files])
    const fileOpen = openPath !== null && files.some((file) => file.path === openPath)

    const addFiles = async (list: FileList | File[]) => {
        const {added, skipped} = await readUploads(list, taken(null))
        if (added.length) {
            onFiles((current) => [
                ...current,
                ...added.filter((file) => !current.some((each) => each.path === file.path)),
            ])
        }
        if (skipped.length) {
            message.warning(
                t("skills.editor.filesSkipped", {
                    count: skipped.length,
                    names: formatList(skipped),
                }),
            )
        }
    }
    const removeFile = (path: string) => {
        const index = files.findIndex((file) => file.path === path)
        if (index < 0) return
        // A copy of the whole file, so Undo restores its content and program flag as they were.
        const removed = {...files[index]}
        onFiles((current) => current.filter((file) => file.path !== path))
        onMoved(path, null)
        message.open({
            type: "success",
            content: t("skills.editor.removed", {name: baseOf(path)}),
            duration: 6,
            action: {
                label: t("skills.editor.undo"),
                onClick: () =>
                    onFiles((current) =>
                        current.some((file) => file.path === path)
                            ? current
                            : [...current.slice(0, index), removed, ...current.slice(index)],
                    ),
            },
        })
    }
    const taken = (except: string | null) =>
        new Set(files.map((file) => file.path).filter((each) => each !== except))
    const createFile = (path: string) => {
        onFiles((current) => [...current, {path, content: ""}])
        setNaming(null)
        onOpen(path)
    }
    const renameFile = (from: string, to: string) => {
        onFiles((current) =>
            current.map((file) => (file.path === from ? {...file, path: to} : file)),
        )
        setNaming(null)
        onMoved(from, to)
    }
    const endDrag = () => {
        setDragPath(null)
        setDropDir(null)
    }
    const moveInto = (dir: string) => {
        const from = dragPath
        endDrag()
        if (!from || dirOf(from) === dir) return
        const name = baseOf(from)
        const to = dir ? `${dir}/${name}` : name
        if (files.some((file) => file.path === to)) {
            message.warning(
                dir
                    ? t("skills.editor.folderHasFile", {dir, name})
                    : t("skills.editor.topLevelHasFile", {name}),
            )
            return
        }
        renameFile(from, to)
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
            "flex flex-col gap-1 rounded-md transition-colors duration-[var(--duration-fast)] ease-out motion-reduce:transition-none",
            dragPath && dropDir === dir && dirOf(dragPath) !== dir && "bg-accent",
        ),
    })
    const nameRow = (path: string | null, dir: string) => (
        <SkillFileNameRow
            key={path ?? `new:${dir}`}
            isNew={path === null}
            initialPath={path ?? (dir ? `${dir}/` : "")}
            taken={taken(path)}
            onSubmit={(next) => (path ? renameFile(path, next) : createFile(next))}
            onCancel={() => setNaming(null)}
        />
    )
    const browse = () => pickerRef.current?.click()
    const addMenu = (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                    <Plus />
                    {t("skills.editor.add")}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
                <DropdownMenuItem onSelect={() => setNaming({path: null, dir: ""})}>
                    <FilePlus />
                    {t("skills.editor.newFile")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={browse}>
                    <UploadSimple />
                    {t("skills.editor.uploadFiles")}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )

    const fileRow = (file: SkillFile) => {
        if (naming?.path === file.path) return nameRow(file.path, dirOf(file.path))
        const on = openPath === file.path
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
                    ROW,
                    on ? "bg-selected" : "hover:bg-accent",
                    dragPath === file.path && "opacity-60",
                )}
            >
                <IconTile size={24} aria-hidden>
                    <FileText />
                </IconTile>
                <button
                    type="button"
                    aria-current={on ? "true" : undefined}
                    onClick={() => onOpen(file.path)}
                    // A double click renames in place, as in a file manager.
                    onDoubleClick={
                        readOnly
                            ? undefined
                            : () => setNaming({path: file.path, dir: dirOf(file.path)})
                    }
                    className={ROW_BUTTON}
                >
                    {baseOf(file.path)}
                </button>
                {!file.executable ? null : allowExecutable ? (
                    <span className="shrink-0 text-meta text-muted-foreground group-hover:hidden">
                        {t("skills.editor.program")}
                    </span>
                ) : (
                    <SimpleTooltip title={t("skills.editor.turnOnPrograms")}>
                        <span className="relative z-sticky inline-flex shrink-0">
                            <Badge variant="warning" icon={<Warning />}>
                                {t("skills.editor.program")}
                            </Badge>
                        </span>
                    </SimpleTooltip>
                )}
                {readOnly ? null : (
                    <span className={ROW_ACTIONS}>
                        <SimpleTooltip
                            title={t("skills.editor.renameNamed", {name: baseOf(file.path)})}
                        >
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t("skills.editor.renameNamed", {
                                    name: baseOf(file.path),
                                })}
                                onClick={() => setNaming({path: file.path, dir: dirOf(file.path)})}
                            >
                                <PencilSimple />
                            </Button>
                        </SimpleTooltip>
                        <SimpleTooltip
                            title={t("skills.editor.removeNamed", {name: baseOf(file.path)})}
                        >
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t("skills.editor.removeNamed", {
                                    name: baseOf(file.path),
                                })}
                                onClick={() => removeFile(file.path)}
                            >
                                <Trash />
                            </Button>
                        </SimpleTooltip>
                    </span>
                )}
            </div>
        )
    }

    const onDrop = (event: DragEvent) => {
        event.preventDefault()
        setDragging(false)
        if (!readOnly && event.dataTransfer.files.length) void addFiles(event.dataTransfer.files)
    }

    return (
        <div
            onDragOver={(event) => {
                if (readOnly || !event.dataTransfer.types.includes("Files")) return
                event.preventDefault()
                setDragging(true)
            }}
            onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setDragging(false)
            }}
            onDrop={onDrop}
            className={cn(
                "relative flex min-h-0 flex-1 flex-col gap-3 rounded-lg",
                // The right pane's body has no padding of its own; the panel sets the pane's.
                docked && "px-4 pt-2 sm:px-6",
            )}
        >
            {dragging ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border border-dashed border-border-strong bg-accent">
                    <span className="rounded-md bg-popover px-3 py-1.5 text-label text-muted-foreground shadow-overlay">
                        {t("skills.editor.dropFiles")}
                    </span>
                </div>
            ) : null}
            {readOnly || addSlot ? null : <div className="flex justify-end">{addMenu}</div>}
            {!readOnly && addSlot ? createPortal(addMenu, addSlot) : null}

            {/* Rows hang their fill 8px outside the pane's text edge. */}
            <div
                ref={listRef}
                className={cn(
                    "-mx-2 flex flex-col gap-1",
                    // Docked, the list scrolls on its own so the programs card stays put below it.
                    docked && "ag-scroll-fade min-h-0 flex-1 overflow-y-auto",
                )}
            >
                <div {...dropZone("")}>
                    <div className={cn(ROW, fileOpen ? "hover:bg-accent" : "bg-selected")}>
                        <IconTile size={24} aria-hidden>
                            <FileText />
                        </IconTile>
                        <button
                            type="button"
                            aria-current={fileOpen ? undefined : "true"}
                            onClick={() => onOpen(null)}
                            className={ROW_BUTTON}
                        >
                            SKILL.md
                        </button>
                    </div>
                    {naming?.path === null && !groups.some(([dir]) => dir && dir === naming.dir)
                        ? nameRow(null, naming.dir)
                        : null}
                    {(groups.find(([dir]) => dir === "")?.[1] ?? []).map(fileRow)}
                </div>
                {groups
                    .filter(([dir]) => dir)
                    .map(([dir, dirFiles]) => (
                        <div key={dir} {...dropZone(dir)}>
                            <div className="group/folder flex h-row-single items-center gap-2 px-2 pt-2 text-meta text-muted-foreground">
                                <span className="flex size-6 shrink-0 items-center justify-center">
                                    <Folder aria-hidden size={14} />
                                </span>
                                <span className="min-w-0 flex-1 truncate">{dir}</span>
                                {readOnly ? null : (
                                    <SimpleTooltip title={t("skills.editor.newFileIn", {dir})}>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label={t("skills.editor.newFileIn", {dir})}
                                            onClick={() => setNaming({path: null, dir})}
                                            className="opacity-0 transition-opacity duration-[var(--duration-fast)] focus-visible:opacity-100 group-hover/folder:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none"
                                        >
                                            <Plus />
                                        </Button>
                                    </SimpleTooltip>
                                )}
                            </div>
                            {naming?.path === null && naming.dir === dir
                                ? nameRow(null, dir)
                                : null}
                            {dirFiles.map(fileRow)}
                        </div>
                    ))}
                {files.length === 0 && !naming ? (
                    <p className="m-0 px-2 py-3 text-meta text-muted-foreground">
                        {readOnly
                            ? t("skills.editor.noFilesReadOnly")
                            : noDrop
                              ? t("skills.editor.noFilesNoDrop")
                              : t("skills.editor.noFiles")}
                    </p>
                ) : null}
            </div>

            <div className={cn("mt-auto shrink-0 pt-3", docked && "pb-4")}>
                {/* The docked pane is muted except on a compact window's full-screen sheet. */}
                <div
                    className={cn(
                        "flex items-center gap-3 rounded-lg px-4 py-3",
                        docked ? "bg-muted sm:bg-background" : "bg-muted",
                    )}
                >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <label
                            htmlFor={switchId}
                            className="cursor-pointer text-label font-medium text-foreground"
                        >
                            {t("skills.editor.allowPrograms")}
                        </label>
                        <span id={hintId} className="text-meta text-muted-foreground">
                            {t("skills.editor.allowProgramsHint")}
                        </span>
                    </span>
                    <Switch
                        id={switchId}
                        size="sm"
                        aria-describedby={hintId}
                        checked={allowExecutable}
                        disabled={readOnly}
                        onCheckedChange={onAllowExecutable}
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
        </div>
    )
})
