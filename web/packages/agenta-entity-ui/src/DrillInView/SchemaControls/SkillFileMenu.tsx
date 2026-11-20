/**
 * The file menu of the skill view (F07 f2, f3, f5; K01): SKILL.md first, then the files grouped in
 * folders from their paths, a search, row actions on hover, a dot on each file with unsaved edits,
 * and the foot actions. The host owns the files; this menu only reports what the person picked.
 */
import {useMemo, useState, type KeyboardEvent, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import skillFormCatalog from "@agenta/i18n/catalogs/entityUi.skillForm"
import skillViewCatalog from "@agenta/i18n/catalogs/entityUi.skillView"
import {cn} from "@agenta/ui/styles"
import {InputAffix} from "@agenta/ui/ui"
import {
    CaretDown,
    DownloadSimple,
    File as FileIcon,
    FilePlus,
    MagnifyingGlass,
    PencilSimple,
    Trash,
    UploadSimple,
} from "@phosphor-icons/react"

import {fileFolder, fileName, groupFilesByFolder, searchFiles} from "./skillFiles"
import type {SkillFileEntry} from "./skillUpload"

/** The open entry of the skill view: SKILL.md or a bundled file by index. */
export type SkillFileSelection = "skill" | number

export interface SkillFileMenuProps {
    files: SkillFileEntry[]
    selected: SkillFileSelection
    /** Which entries have unsaved edits. */
    edited: (entry: SkillFileSelection) => boolean
    /** Folders the person folded; kept by the host while the skill stays open. */
    folded: ReadonlySet<string>
    onToggleFolder: (folder: string) => void
    onOpen: (entry: SkillFileSelection) => void
    onRename: (index: number) => void
    onDelete: (index: number) => void
    onAddFile: () => void
    onUpload: () => void
    /** The download row, or nothing when the skill cannot be downloaded here. */
    download?: {label: string; onDownload: () => void}
    /** The bar under the foot: file count and edited count. */
    countLine: ReactNode
    disabled?: boolean
}

const ROW =
    "box-border flex w-full min-w-0 cursor-pointer appearance-none items-center gap-1.5 rounded-control-sm border-0 bg-transparent px-2 py-1 text-left font-[inherit] text-[13px] text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent"

const FOOT_ROW =
    "box-border flex w-full cursor-pointer appearance-none items-center gap-2 rounded-control-sm border-0 bg-transparent px-2 py-1.5 text-left font-[inherit] text-[13px] text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent disabled:cursor-default disabled:opacity-50"

const EditedDot = ({show}: {show: boolean}) =>
    show ? (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--ag-colorPrimary)]" />
    ) : null

export function SkillFileMenu({
    files,
    selected,
    edited,
    folded,
    onToggleFolder,
    onOpen,
    onRename,
    onDelete,
    onAddFile,
    onUpload,
    download,
    countLine,
    disabled,
}: SkillFileMenuProps) {
    const t = useT(skillViewCatalog, skillFormCatalog)
    const [query, setQuery] = useState("")
    const groups = useMemo(() => groupFilesByFolder(files), [files])
    const results = useMemo(() => searchFiles(files, query), [files, query])
    const searching = query.trim() !== ""

    const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== "Enter" || results[0] === undefined) return
        event.preventDefault()
        onOpen(results[0])
    }

    const fileRow = (index: number, {withFolder = false} = {}) => {
        const file = files[index]
        if (!file) return null
        const name = fileName(file.path) || t("entityUi.skillForm.untitled")
        return (
            <div key={index} className="group/row relative">
                <button
                    type="button"
                    title={file.path}
                    onClick={() => onOpen(index)}
                    className={cn(ROW, selected === index && "bg-accent", !withFolder && "pl-6")}
                >
                    <FileIcon size={13} className="shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-mono text-xs">{name}</span>
                        {withFolder && fileFolder(file.path) ? (
                            <span className="truncate text-[11px] text-muted-foreground">
                                {fileFolder(file.path)}
                            </span>
                        ) : null}
                    </span>
                    <EditedDot show={edited(index)} />
                    {/* Room for the row actions, so a long name never runs under them. */}
                    {!disabled ? (
                        <span className="hidden w-11 shrink-0 group-hover/row:block" />
                    ) : null}
                </button>
                {!disabled ? (
                    <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover/row:flex">
                        <button
                            type="button"
                            aria-label={t("entityUi.skillView.rename")}
                            title={t("entityUi.skillView.rename")}
                            onClick={() => onRename(index)}
                            className="flex size-5 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
                        >
                            <PencilSimple size={13} />
                        </button>
                        <button
                            type="button"
                            aria-label={t("entityUi.skillView.delete")}
                            title={t("entityUi.skillView.delete")}
                            onClick={() => onDelete(index)}
                            className="flex size-5 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-muted-foreground hover:text-[var(--ag-colorError)]"
                        >
                            <Trash size={13} />
                        </button>
                    </span>
                ) : null}
            </div>
        )
    }

    return (
        <div className="flex max-h-[min(520px,70vh)] flex-col">
            <div className="shrink-0 p-1.5 pb-1">
                <InputAffix
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={onSearchKey}
                    placeholder={t("entityUi.skillView.findFile")}
                    aria-label={t("entityUi.skillView.findFile")}
                    prefix={<MagnifyingGlass size={13} className="text-muted-foreground" />}
                />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1 pb-1">
                {searching ? (
                    results.length ? (
                        results.map((index) => fileRow(index, {withFolder: true}))
                    ) : (
                        <span className="px-2 py-2 text-xs text-muted-foreground">
                            {t("entityUi.skillView.noFileMatches")}
                        </span>
                    )
                ) : (
                    <>
                        <button
                            type="button"
                            onClick={() => onOpen("skill")}
                            className={cn(ROW, selected === "skill" && "bg-accent")}
                        >
                            <FileIcon size={13} className="shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate font-mono text-xs">
                                SKILL.md
                            </span>
                            <EditedDot show={edited("skill")} />
                        </button>
                        {groups.map((group) =>
                            group.folder === "" ? (
                                group.files.map((index) => fileRow(index, {withFolder: true}))
                            ) : (
                                <div key={group.folder} className="flex flex-col gap-px">
                                    <button
                                        type="button"
                                        aria-expanded={!folded.has(group.folder)}
                                        onClick={() => onToggleFolder(group.folder)}
                                        title={group.folder}
                                        className={ROW}
                                    >
                                        <CaretDown
                                            size={12}
                                            className={cn(
                                                "shrink-0 text-muted-foreground transition-transform",
                                                folded.has(group.folder) && "-rotate-90",
                                            )}
                                        />
                                        <span className="min-w-0 truncate text-xs font-medium">
                                            {group.folder}
                                        </span>
                                        <span className="shrink-0 text-[11px] text-muted-foreground">
                                            {group.files.length}
                                        </span>
                                    </button>
                                    {folded.has(group.folder)
                                        ? null
                                        : group.files.map((index) => fileRow(index))}
                                </div>
                            ),
                        )}
                    </>
                )}
            </div>
            {searching && results.length ? (
                <span className="shrink-0 px-3 pb-1 text-[11px] text-muted-foreground">
                    {t("entityUi.skillView.searchCount", {
                        count: results.length,
                        total: files.length + 1,
                    })}
                </span>
            ) : null}
            <div className="flex shrink-0 flex-col border-0 border-t border-solid border-border p-1">
                {!disabled ? (
                    <button type="button" onClick={onAddFile} className={FOOT_ROW}>
                        <FilePlus size={14} className="text-muted-foreground" />
                        {t("entityUi.skillForm.addAFile")}
                    </button>
                ) : null}
                {!disabled && !searching ? (
                    <button type="button" onClick={onUpload} className={FOOT_ROW}>
                        <UploadSimple size={14} className="text-muted-foreground" />
                        {t("entityUi.skillView.uploadFolderOrZip")}
                    </button>
                ) : null}
                {download && !searching ? (
                    <button type="button" onClick={download.onDownload} className={FOOT_ROW}>
                        <DownloadSimple size={14} className="text-muted-foreground" />
                        <span className="flex-1">{download.label}</span>
                        <span className="text-[11px] text-muted-foreground">{countLine}</span>
                    </button>
                ) : null}
            </div>
        </div>
    )
}
