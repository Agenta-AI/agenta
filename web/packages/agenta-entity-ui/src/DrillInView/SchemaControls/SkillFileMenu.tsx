/**
 * The file menu of the skill view (F07 f2, f3, f5; K01): SKILL.md first, then the files grouped in
 * folders from their paths, a search, row actions on hover, a dot on each file with unsaved edits,
 * and the foot actions. The host owns the files; this menu only reports what the person picked.
 */
import {useMemo, useState, type KeyboardEvent} from "react"

import {useT} from "@agenta/i18n"
import skillFormCatalog from "@agenta/i18n/catalogs/entityUi.skillForm"
import skillViewCatalog from "@agenta/i18n/catalogs/entityUi.skillView"
import {cn} from "@agenta/ui/styles"
import {InputAffix} from "@agenta/ui/ui"
import {
    CaretDown,
    Check,
    DownloadSimple,
    File as FileIcon,
    Folder,
    MagnifyingGlass,
    PencilSimple,
    Plus,
    Trash,
    UploadSimple,
} from "@phosphor-icons/react"

import {fileFolder, fileName, groupFilesByFolder, pathOf, searchFiles} from "./skillFiles"
import type {SkillFileEntry} from "./skillUpload"
import {SKILL_ACTION_ROW} from "./SkillViewHeader"

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
    disabled?: boolean
}

const ROW =
    "box-border flex w-full min-w-0 cursor-pointer appearance-none items-center gap-1.5 rounded-[6px] border-0 bg-transparent px-2 py-1 text-left font-[inherit] text-[13px] text-colorText outline-none transition-colors hover:bg-colorFillTertiary focus-visible:bg-colorFillTertiary max-md:min-h-11"

/** The open file, or the result Enter opens: a gray row (F07 f2, f3). */
const CURRENT = "bg-colorFillTertiary"

/** The check at the end of the open file's row (F07 f2). */
const OpenCheck = ({show}: {show: boolean}) =>
    show ? <Check aria-hidden size={14} className="shrink-0 text-colorText" /> : null

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

    const fileRow = (index: number, {withFolder = false, highlight = false} = {}) => {
        const file = files[index]
        if (!file) return null
        const path = pathOf(file)
        const name = fileName(path) || t("entityUi.skillForm.untitled")
        return (
            <div key={index} className="group/row relative">
                <button
                    type="button"
                    title={path}
                    onClick={() => onOpen(index)}
                    aria-current={selected === index ? "true" : undefined}
                    className={cn(
                        ROW,
                        (selected === index || highlight) && CURRENT,
                        !withFolder && "pl-6",
                    )}
                >
                    <FileIcon size={14} className="shrink-0 text-colorTextSecondary" />
                    <span className="flex min-w-0 flex-1 flex-col">
                        <span
                            className={cn(
                                "truncate font-mono text-[12px] leading-5",
                                selected === index && "font-medium",
                            )}
                        >
                            {name}
                        </span>
                        {withFolder && fileFolder(path) ? (
                            <span className="truncate text-[11px] text-muted-foreground">
                                {fileFolder(path)}
                            </span>
                        ) : null}
                    </span>
                    <EditedDot show={edited(index)} />
                    <OpenCheck show={selected === index} />
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
        <div className="flex max-h-[min(560px,70vh)] flex-col">
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
                        results.map((index, i) =>
                            // Enter opens the first result, so it shows as picked.
                            fileRow(index, {withFolder: true, highlight: i === 0}),
                        )
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
                            aria-current={selected === "skill" ? "true" : undefined}
                            className={cn(ROW, selected === "skill" && CURRENT)}
                        >
                            <FileIcon size={14} className="shrink-0 text-colorTextSecondary" />
                            <span
                                className={cn(
                                    "min-w-0 flex-1 truncate font-mono text-[12px] leading-5",
                                    selected === "skill" && "font-medium",
                                )}
                            >
                                SKILL.md
                            </span>
                            <EditedDot show={edited("skill")} />
                            <OpenCheck show={selected === "skill"} />
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
                                                "shrink-0 text-colorTextTertiary transition-transform",
                                                folded.has(group.folder) && "-rotate-90",
                                            )}
                                        />
                                        <Folder
                                            size={12}
                                            className="shrink-0 text-colorTextSecondary"
                                        />
                                        <span className="min-w-0 flex-1 truncate font-mono text-[12px] leading-5 text-colorTextSecondary">
                                            {group.folder}
                                        </span>
                                        <span className="shrink-0 text-[12px] text-colorTextTertiary">
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
            <div className="flex shrink-0 flex-col border-0 border-t border-solid border-colorBorderSecondary p-1 empty:hidden">
                {/* With results, Enter or a click opens a file; "Add a file" waits for no match (F07 f3). */}
                {!disabled && !(searching && results.length) ? (
                    <button type="button" onClick={onAddFile} className={SKILL_ACTION_ROW}>
                        <Plus size={14} className="text-colorText" />
                        {t("entityUi.skillForm.addAFile")}
                    </button>
                ) : null}
                {!disabled && !searching ? (
                    <button type="button" onClick={onUpload} className={SKILL_ACTION_ROW}>
                        <UploadSimple size={14} className="text-colorText" />
                        {t("entityUi.skillView.uploadFolderOrZip")}
                    </button>
                ) : null}
                {download && !searching ? (
                    <button
                        type="button"
                        onClick={download.onDownload}
                        className={SKILL_ACTION_ROW}
                    >
                        <DownloadSimple size={14} className="text-colorText" />
                        <span className="flex-1">{download.label}</span>
                    </button>
                ) : null}
            </div>
        </div>
    )
}
