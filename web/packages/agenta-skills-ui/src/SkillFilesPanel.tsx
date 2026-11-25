import {memo, useMemo, useRef, useState, type DragEvent} from "react"
import {createPortal} from "react-dom"

import {useT} from "@agenta/i18n"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import type {SkillFile} from "@agenta/skills"
import {message} from "@agenta/ui/app-message"
import {useScrollFadeEdges} from "@agenta/ui/hooks"
import {cn} from "@agenta/ui/styles"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    IconTile,
    Switch,
} from "@agenta/ui/ui"
import {
    File as FileIcon,
    FilePlus,
    FileText,
    Folder,
    PencilSimple,
    Plus,
    Trash,
    UploadSimple,
} from "@phosphor-icons/react"

import {baseOf, dirOf} from "./skillDraft"
import {SkillFileNameRow} from "./SkillFileNameRow"

const ROW =
    "group relative flex h-row-single items-center gap-2 rounded-md px-2 text-label transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none"
const ROW_BUTTON =
    "min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-[inherit] text-label text-foreground outline-none after:absolute after:inset-0 after:content-['']"
const ROW_ACTIONS =
    "relative z-[1] flex shrink-0 items-center opacity-0 transition-opacity duration-[var(--duration-fast)] focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none"

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
    const pickerRef = useRef<HTMLInputElement>(null)
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
        const added = await readTextFiles(list)
        if (!added.length) return
        const paths = new Set(added.map((file) => file.path))
        onFiles((current) => {
            const byPath = new Map(current.map((file) => [file.path, file]))
            const merged = added.map((file) => ({...byPath.get(file.path), ...file}))
            return [...current.filter((file) => !paths.has(file.path)), ...merged]
        })
    }
    const removeFile = (path: string) => {
        onFiles((current) => current.filter((file) => file.path !== path))
        onMoved(path, null)
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
                        <DropdownMenuContent
                            align="end"
                            onCloseAutoFocus={(event) => event.preventDefault()}
                        >
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
                    <FileIcon />
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
                {file.executable ? (
                    <span
                        className={cn(
                            "shrink-0 text-meta group-hover:hidden",
                            allowExecutable ? "text-muted-foreground" : "text-warning",
                        )}
                    >
                        {t("skills.editor.program")}
                    </span>
                ) : null}
                {readOnly ? null : (
                    <span className={ROW_ACTIONS}>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t("skills.editor.renameNamed", {name: baseOf(file.path)})}
                            onClick={() => setNaming({path: file.path, dir: dirOf(file.path)})}
                        >
                            <PencilSimple />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t("skills.editor.removeNamed", {name: baseOf(file.path)})}
                            onClick={() => removeFile(file.path)}
                        >
                            <Trash />
                        </Button>
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
                "flex min-h-0 flex-1 flex-col gap-3 rounded-lg",
                // The right pane's body has no padding of its own; the panel sets the pane's.
                docked && "px-4 pt-2 sm:px-6",
                dragging && "outline-dashed outline-1 outline-border-strong",
            )}
        >
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
                                <Folder aria-hidden size={14} />
                                <span className="min-w-0 flex-1 truncate">{dir}</span>
                                {readOnly ? null : (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label={t("skills.editor.newFileIn", {dir})}
                                        onClick={() => setNaming({path: null, dir})}
                                        className="opacity-0 transition-opacity duration-[var(--duration-fast)] focus-visible:opacity-100 group-hover/folder:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none"
                                    >
                                        <Plus />
                                    </Button>
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
                        {readOnly ? t("skills.editor.noFilesReadOnly") : t("skills.editor.noFiles")}
                    </p>
                ) : null}
            </div>

            <div
                className={cn(
                    "mt-auto shrink-0 pt-3",
                    docked && "pb-4",
                )}
            >
                <div className="flex items-center gap-3 rounded-lg bg-background px-4 py-3">
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <label
                            htmlFor="skill-exec-switch"
                            className="cursor-pointer text-label font-medium text-foreground"
                        >
                            {t("skills.editor.allowPrograms")}
                        </label>
                        <span id="skill-exec-hint" className="text-meta text-muted-foreground">
                            {t("skills.editor.allowProgramsHint")}
                        </span>
                    </span>
                    <Switch
                        id="skill-exec-switch"
                        size="sm"
                        aria-describedby="skill-exec-hint"
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
