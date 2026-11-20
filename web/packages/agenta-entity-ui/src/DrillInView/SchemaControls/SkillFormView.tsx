/**
 * SkillFormView
 *
 * The form of the one skill view (F07 f1 to f10): a file button that opens the file menu, then the
 * open file. SKILL.md shows Name, Description, the SKILL.md editor and Advanced; another file shows
 * its path, "Mark executable" and a code editor. The menu adds, renames, deletes and uploads files.
 *
 * Mirrors the inline `SkillTemplateSchema` shape (sdk/utils/types.py, `__ag_type__ =
 * "skill-template"`): a kebab `name`, a `description`, the `body` (SKILL.md Markdown), the bundled
 * `files[]`, and two switches. Controlled: the host owns the value and saves it.
 */
import {useEffect, useId, useMemo, useRef, useState, type ReactNode} from "react"

import {createT, useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import commitDiffCatalog from "@agenta/i18n/catalogs/entityUi.commitDiff"
import schemaControlsCatalog from "@agenta/i18n/catalogs/entityUi.schemaControls"
import skillCatalog from "@agenta/i18n/catalogs/entityUi.skillForm"
import skillViewCatalog from "@agenta/i18n/catalogs/entityUi.skillView"
import skillsGalleryCatalog from "@agenta/i18n/catalogs/skills.gallery"
import {message} from "@agenta/ui/app-message"
import {HeightCollapse} from "@agenta/ui/height-collapse"
import {cn} from "@agenta/ui/styles"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AutosizeTextarea,
    Button,
    CollapseCaret,
    Field,
    Input,
    Popover,
    PopoverContent,
    PHONE_TOUCH_TARGET_CLASS,
    PopoverTrigger,
    Switch,
} from "@agenta/ui/ui"
import {
    ArrowsInSimple,
    ArrowsOutSimple,
    CaretUpDown,
    File as FileIcon,
    SlidersHorizontal,
    Trash,
} from "@phosphor-icons/react"

import {CodeEditor, codeLanguageFromPath} from "./CodeEditor"
import {MarkdownEditor} from "./MarkdownEditor"
import {downloadSkill, skillDownloadKind} from "./skillDownload"
import {SkillFileMenu, type SkillFileSelection} from "./SkillFileMenu"
import {
    editedFileCount,
    fileEdited,
    fileName,
    filePathProblem,
    pathOf,
    skillFilesOf,
    skillMdEdited,
    type FilePathProblem,
} from "./skillFiles"
import {
    NOT_TEXT,
    SKILL_BODY_MAX,
    SKILL_DESCRIPTION_MAX,
    SKILL_NAME_MAX,
    SKILL_NAME_PATTERN,
    skillNameError,
    slugifySkillName,
} from "./skillName"
import {applySkillUpload, mergePastedSkill, type SkillFileEntry} from "./skillUpload"
import {SkillUploadStep, type SkillUploadControl} from "./SkillUploadStep"

export interface SkillFormViewProps {
    value: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
    /**
     * The saved skill, for the unsaved dots and the edited count. Defaults to the value the form
     * mounted with.
     */
    baseline?: Record<string, unknown>
    /**
     * The Name field takes the caret on mount, a frame late so a drawer's own focus has landed.
     * For a form that opens empty, where the name is the first thing to type.
     */
    autoFocusName?: boolean
    /**
     * Paint the empty required fields red. Off until the host's Create or Save is pressed: a
     * field that reddens the moment the caret leaves it scolds a reader who has not tried to submit.
     */
    showMissing?: boolean
    /** Offer a download of the skill as SKILL.md or a .zip. Off for a draft not yet created. */
    downloadable?: boolean
    /**
     * A read-only view (a phone): Name, Description, a file's path and the switches show as text
     * rows, and the editors show their text without a toolbar. Pass `disabled` with it.
     */
    valuesAsText?: boolean
    /**
     * The upload step reports here and leaves Cancel and Upload to the view's action row. Pass
     * `onUploadControl` from `useSkillViewForm`. Left out, the step draws its own two buttons.
     */
    onUploadControl?: (control: SkillUploadControl | null) => void
}

const tNow = createT(skillCatalog)

type MarkdownView = "source" | "rendered"

/** The editors keep this height at least, so about 14 lines show; the form scrolls under them. */
const EDITOR_MIN = "min-h-[300px]"

/** A long path cut in the middle, so the file name stays readable on the file button. */
const middleCut = (text: string, max = 44): string =>
    text.length <= max
        ? text
        : `${text.slice(0, Math.ceil((max - 1) / 2))}…${text.slice(-Math.floor((max - 1) / 2))}`

const PATH_PROBLEM_KEY = {
    empty: "entityUi.skillView.pathRequired",
    skillMd: "entityUi.skillView.pathSkillMd",
    invalid: "entityUi.skillView.pathInvalid",
    duplicate: "entityUi.skillView.pathDuplicate",
} as const satisfies Record<FilePathProblem, string>

/** A switch with its label and its line under it. */
function SwitchRow({
    label,
    hint,
    checked,
    onChange,
    disabled,
    valuesAsText,
}: {
    label: string
    hint: string
    checked: boolean
    onChange: (value: boolean) => void
    disabled?: boolean
    /** The value as text ("On" or "Off"), with no switch. */
    valuesAsText?: boolean
}) {
    const t = useT(commitDiffCatalog)
    return (
        <div className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] leading-5 text-colorText">{label}</span>
                <span className="text-[12px] leading-4 text-colorTextTertiary">{hint}</span>
            </span>
            {valuesAsText ? (
                <span className="shrink-0 text-sm text-colorText">
                    {checked ? t("entityUi.commitDiff.on") : t("entityUi.commitDiff.off")}
                </span>
            ) : (
                <Switch
                    checked={checked}
                    onCheckedChange={onChange}
                    disabled={disabled}
                    aria-label={label}
                    className="shrink-0"
                />
            )}
        </div>
    )
}

/** A field's value as a text row, for a read-only view; "None" when it is empty. */
function ReadOnlyText({text, mono = false}: {text: string; mono?: boolean}) {
    const t = useT(commonCatalog)
    return (
        <span
            className={cn(
                "whitespace-pre-line break-words text-sm",
                text.trim() ? "text-colorText" : "text-colorTextTertiary",
                mono && "font-mono",
            )}
        >
            {text.trim() ? text : t("common.none")}
        </span>
    )
}

/** A field label at the panel scale (F07): 12/16, medium, secondary. */
const fieldLabel = (text: string) => (
    <span className="text-[12px] leading-4 text-colorTextSecondary">{text}</span>
)

/** A field whose help line sits under the control (F07), not between the label and the control. */
function FieldWithHelp({
    help,
    children,
}: {
    /** Left out for a read-only value: there is no control to explain. */
    help?: string
    children: (helpId: string | undefined) => ReactNode
}) {
    const helpId = useId()
    return (
        <div className="flex shrink-0 flex-col gap-1">
            {children(help ? helpId : undefined)}
            {help ? (
                <span id={helpId} className="text-[12px] leading-4 text-colorTextTertiary">
                    {help}
                </span>
            ) : null}
        </div>
    )
}

export function SkillFormView({
    value,
    onChange,
    disabled,
    valuesAsText = false,
    baseline: baselineProp,
    autoFocusName = false,
    showMissing = false,
    downloadable = false,
    onUploadControl,
}: SkillFormViewProps) {
    const t = useT(skillCatalog, skillViewCatalog, skillsGalleryCatalog, schemaControlsCatalog)
    const skill = (value ?? {}) as Record<string, unknown>
    const [mountValue] = useState(skill)
    const baseline = baselineProp ?? mountValue
    const files = skillFilesOf(skill)
    const baselineFiles = useMemo(() => skillFilesOf(baseline), [baseline])

    const nameInput = useRef<HTMLInputElement>(null)
    useEffect(() => {
        if (!autoFocusName) return
        const frame = requestAnimationFrame(() => nameInput.current?.focus())
        return () => cancelAnimationFrame(frame)
    }, [autoFocusName])

    const [selected, setSelected] = useState<SkillFileSelection>("skill")
    const [menuOpen, setMenuOpen] = useState(false)
    // Folded folders stay folded while this skill stays open.
    const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
    const [uploading, setUploading] = useState(false)
    const [skipped, setSkipped] = useState<{path: string; reason: string}[]>([])
    const [expanded, setExpanded] = useState(false)
    const [deleting, setDeleting] = useState<number | null>(null)
    // A new or renamed file takes the caret in its path field.
    const pathInput = useRef<HTMLInputElement>(null)
    const [focusPath, setFocusPath] = useState(0)
    // The file "Add a file" just made: its empty path is the starting point, not a mistake (F07 f6).
    const [freshFile, setFreshFile] = useState<number | null>(null)
    useEffect(() => {
        if (!focusPath) return
        const frame = requestAnimationFrame(() => pathInput.current?.focus())
        return () => cancelAnimationFrame(frame)
    }, [focusPath])
    // The name's format check is quiet on a pristine draft; on once the user or an upload touches it.
    const [nameTouched, setNameTouched] = useState(() => Boolean(String(skill.name ?? "").trim()))
    // Open when a switch is already on, so an existing skill never hides a set switch.
    const [advancedOpen, setAdvancedOpen] = useState(
        () => Boolean(skill.disable_model_invocation) || Boolean(skill.allow_executable_files),
    )

    // The JSON view can put any type here, and a cast alone would let `.trim()` throw.
    const asText = (raw: unknown) => (typeof raw === "string" ? raw : "")
    const notText = (raw: unknown) => raw != null && typeof raw !== "string"
    const name = asText(skill.name)
    const description = asText(skill.description)
    const body = asText(skill.body)
    const missing = (raw: unknown, text: string) => !notText(raw) && showMissing && !text.trim()

    const rawNameError = skillNameError(skill.name, {touched: nameTouched})
    const nameMissing = missing(skill.name, name)
    const nameError = nameMissing ? undefined : rawNameError
    const nameSuggestion = nameError && name.trim() ? slugifySkillName(name) : ""
    const showNameSuggestion = Boolean(nameSuggestion) && nameSuggestion !== name
    const descriptionMissing = missing(skill.description, description)
    const descriptionError = notText(skill.description)
        ? NOT_TEXT
        : [...description].length > SKILL_DESCRIPTION_MAX
          ? t("entityUi.skillForm.maxCharacters", {count: SKILL_DESCRIPTION_MAX})
          : undefined
    const bodyMissing = missing(skill.body, body)
    const bodyError = notText(skill.body)
        ? NOT_TEXT
        : [...body].length > SKILL_BODY_MAX
          ? t("entityUi.skillForm.maxCharacters", {count: SKILL_BODY_MAX})
          : undefined

    const set = (key: string, fieldValue: unknown) => {
        const next = {...skill}
        if (
            fieldValue === undefined ||
            fieldValue === null ||
            fieldValue === "" ||
            fieldValue === false
        )
            delete next[key]
        else next[key] = fieldValue
        onChange(next)
    }
    const setFiles = (next: SkillFileEntry[]) => {
        const updated = {...skill}
        if (next.length) updated.files = next
        else delete updated.files
        onChange(updated)
    }
    const updateFile = (index: number, patch: Partial<SkillFileEntry>) =>
        setFiles(files.map((file, i) => (i === index ? {...file, ...patch} : file)))

    const open = (entry: SkillFileSelection) => {
        setSelected(entry)
        setUploading(false)
        setMenuOpen(false)
    }
    const addFile = () => {
        setFiles([...files, {path: "", content: ""}])
        setFreshFile(files.length)
        open(files.length)
        setFocusPath((n) => n + 1)
    }
    const rename = (index: number) => {
        open(index)
        setFocusPath((n) => n + 1)
    }
    const removeFile = (index: number) => {
        setFreshFile(null)
        setFiles(files.filter((_, i) => i !== index))
        setSelected((current) => {
            if (current === "skill" || current === index) return "skill"
            return current > index ? current - 1 : current
        })
    }

    // A SKILL.md pasted outside a field fills the form (production behavior).
    const skillRef = useRef(skill)
    skillRef.current = skill
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    useEffect(() => {
        if (disabled) return
        const onPaste = (event: ClipboardEvent) => {
            const el = event.target as HTMLElement | null
            if (
                el &&
                (el.tagName === "INPUT" ||
                    el.tagName === "TEXTAREA" ||
                    el.isContentEditable ||
                    el.closest('[contenteditable="true"]'))
            )
                return
            const text = event.clipboardData?.getData("text/plain") ?? ""
            // Only claim a paste that opens with a metadata block, so other pastes fall through.
            if (!/^\uFEFF?---\r?\n/.test(text)) return
            event.preventDefault()
            onChangeRef.current(mergePastedSkill(skillRef.current, text))
            setSelected("skill")
            message.success(tNow("entityUi.skillForm.filledFromPaste"))
        }
        document.addEventListener("paste", onPaste)
        return () => document.removeEventListener("paste", onPaste)
    }, [disabled])

    const activeFile = typeof selected === "number" ? files[selected] : undefined
    const showSkill = selected === "skill" || !activeFile
    const activeIndex = showSkill ? null : (selected as number)
    const pathProblem = activeIndex === null ? undefined : filePathProblem(files, activeIndex)
    // An empty path waits for a submit before it says so, like an empty name.
    const shownPathProblem =
        pathProblem === "empty" && (!showMissing || activeIndex === freshFile)
            ? undefined
            : pathProblem
    const activePath = pathOf(activeFile)
    const newFile = activeIndex !== null && !baselineFiles.some((f) => pathOf(f) === activePath)

    const edited = (entry: SkillFileSelection) =>
        entry === "skill" ? skillMdEdited(skill, baseline) : fileEdited(files, entry, baselineFiles)
    const editedCount = editedFileCount(skill, baseline)
    const fileCount = files.length + 1
    const countLine = editedCount
        ? `${t("entityUi.skillView.files", {count: fileCount})} · ${t("entityUi.skillView.edited", {count: editedCount})}`
        : t("entityUi.skillView.files", {count: fileCount})
    const downloadKind = downloadable ? skillDownloadKind(skill) : null
    const deletingName = deleting === null ? "" : fileName(pathOf(files[deleting]))

    const expandButton = (
        <button
            type="button"
            aria-label={
                expanded
                    ? t("entityUi.skillView.shrinkEditor")
                    : t("entityUi.skillView.expandEditor")
            }
            title={
                expanded
                    ? t("entityUi.skillView.shrinkEditor")
                    : t("entityUi.skillView.expandEditor")
            }
            onClick={() => setExpanded((prev) => !prev)}
            className={cn(
                "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-colorTextSecondary hover:bg-colorFillTertiary hover:text-colorText",
                PHONE_TOUCH_TARGET_CLASS,
            )}
        >
            {expanded ? <ArrowsInSimple size={14} /> : <ArrowsOutSimple size={14} />}
        </button>
    )
    // The toolbar sits in this view's own row, beside the Source switch and the expand button.
    const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null)
    const [bodyView, setBodyView] = useState<MarkdownView>("rendered")

    // Menus render inside the form, so a modal drawer around it keeps their lists scrollable.
    const [formRoot, setFormRoot] = useState<HTMLDivElement | null>(null)

    return (
        <div ref={setFormRoot} className="flex h-full min-h-0 flex-col">
            {/* The file bar: a full-width band under the header (F07 f1). */}
            <div className="flex h-12 shrink-0 items-center gap-2 border-0 border-y border-solid border-colorBorderSecondary bg-[var(--ag-surface-raised)] px-4 max-md:h-14">
                <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            title={activeFile ? activePath : "SKILL.md"}
                            aria-haspopup="dialog"
                            className="box-border flex h-7 min-w-0 max-w-[70%] cursor-pointer items-center gap-2 rounded-[6px] border border-solid border-border bg-colorBgContainer px-2.5 font-[inherit] text-colorText hover:bg-colorFillTertiary max-md:h-11 max-md:rounded-lg"
                        >
                            <FileIcon size={14} className="shrink-0 text-colorTextSecondary" />
                            <span className="min-w-0 truncate font-mono text-[12px] leading-5">
                                {uploading
                                    ? "SKILL.md"
                                    : activeFile
                                      ? middleCut(activePath || t("entityUi.skillForm.untitled"))
                                      : "SKILL.md"}
                            </span>
                            <CaretUpDown size={14} className="shrink-0 text-colorTextTertiary" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                        align="start"
                        sideOffset={4}
                        container={formRoot}
                        className="w-[332px] p-0"
                    >
                        <SkillFileMenu
                            files={files}
                            selected={selected}
                            edited={edited}
                            folded={folded}
                            onToggleFolder={(folder) =>
                                setFolded((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(folder)) next.delete(folder)
                                    else next.add(folder)
                                    return next
                                })
                            }
                            onOpen={open}
                            onRename={rename}
                            onDelete={(index) => {
                                setMenuOpen(false)
                                setDeleting(index)
                            }}
                            onAddFile={addFile}
                            onUpload={() => {
                                setMenuOpen(false)
                                setUploading(true)
                            }}
                            download={
                                downloadKind
                                    ? {
                                          label:
                                              downloadKind === "zip"
                                                  ? t("entityUi.skillForm.downloadZip")
                                                  : t("entityUi.skillForm.downloadSkillMd"),
                                          onDownload: () => {
                                              setMenuOpen(false)
                                              downloadSkill(skill)
                                          },
                                      }
                                    : undefined
                            }
                            disabled={disabled}
                        />
                    </PopoverContent>
                </Popover>
                {activeIndex !== null && !disabled && !uploading ? (
                    <button
                        type="button"
                        aria-label={t("entityUi.skillView.deleteFile")}
                        title={t("entityUi.skillView.deleteFile")}
                        onClick={() => setDeleting(activeIndex)}
                        className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-colorTextSecondary hover:bg-colorFillTertiary hover:text-[var(--ag-colorError)] max-md:size-11"
                    >
                        <Trash size={14} />
                    </button>
                ) : null}
                <span className="ml-auto shrink-0 text-[12px] leading-4 text-colorTextTertiary">
                    {countLine}
                </span>
            </div>

            <div
                className={cn(
                    "flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 pt-3",
                    expanded ? "overflow-hidden" : "overflow-y-auto",
                )}
            >
                {skipped.length ? (
                    <div className="flex shrink-0 flex-col gap-1 rounded-md border border-solid border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] px-3 py-2 text-xs text-[var(--ag-colorWarningText)]">
                        <span className="font-medium">
                            {t("skills.gallery.skippedCount", {count: skipped.length})}
                        </span>
                        {skipped.map((file) => (
                            <span key={file.path} className="truncate font-mono" title={file.path}>
                                {file.path} · {file.reason}
                            </span>
                        ))}
                    </div>
                ) : null}

                {uploading ? (
                    <SkillUploadStep
                        fileCount={fileCount}
                        onControl={onUploadControl}
                        onCancel={() => setUploading(false)}
                        onUpload={(upload, mode) => {
                            const result = applySkillUpload(skill, upload, mode)
                            if ("error" in result) return t("skills.gallery.noSkillMdFound")
                            onChange(result.skill)
                            setSkipped(upload.skipped)
                            setUploading(false)
                            setSelected("skill")
                            if (mode === "replace") {
                                setNameTouched(true)
                                if (result.skill.disable_model_invocation) setAdvancedOpen(true)
                            }
                            return null
                        }}
                    />
                ) : showSkill ? (
                    <>
                        {!expanded ? (
                            <>
                                <FieldWithHelp
                                    help={
                                        valuesAsText
                                            ? undefined
                                            : t("entityUi.skillForm.nameTooltip")
                                    }
                                >
                                    {(helpId) => (
                                        <Field
                                            className="shrink-0"
                                            invalid={nameMissing}
                                            label={fieldLabel(t("entityUi.skillForm.name"))}
                                            error={
                                                nameError ? (
                                                    <span>
                                                        {nameError}
                                                        {showNameSuggestion ? (
                                                            <>
                                                                {" "}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setNameTouched(true)
                                                                        set("name", nameSuggestion)
                                                                    }}
                                                                    disabled={disabled}
                                                                    className="cursor-pointer rounded-sm border-0 bg-transparent p-0 font-[inherit] text-xs text-error underline underline-offset-2 hover:no-underline disabled:cursor-not-allowed"
                                                                >
                                                                    {t(
                                                                        "entityUi.skillForm.useSuggestion",
                                                                        {
                                                                            name: nameSuggestion,
                                                                        },
                                                                    )}
                                                                </button>
                                                            </>
                                                        ) : null}
                                                    </span>
                                                ) : undefined
                                            }
                                        >
                                            {valuesAsText ? (
                                                <ReadOnlyText text={name} mono />
                                            ) : (
                                                <Input
                                                    ref={nameInput}
                                                    value={name}
                                                    onChange={(event) => {
                                                        setNameTouched(true)
                                                        set("name", event.target.value)
                                                    }}
                                                    maxLength={SKILL_NAME_MAX}
                                                    aria-invalid={
                                                        nameMissing || nameError ? true : undefined
                                                    }
                                                    placeholder="my-skill"
                                                    disabled={disabled}
                                                    aria-describedby={helpId}
                                                    className="h-[34px] rounded-[6px] font-mono text-[13px]"
                                                />
                                            )}
                                        </Field>
                                    )}
                                </FieldWithHelp>
                                <FieldWithHelp
                                    help={
                                        valuesAsText
                                            ? undefined
                                            : t("entityUi.skillForm.descriptionTooltip")
                                    }
                                >
                                    {(helpId) => (
                                        <Field
                                            className="shrink-0"
                                            invalid={descriptionMissing}
                                            label={fieldLabel(t("entityUi.skillForm.description"))}
                                            error={descriptionError}
                                        >
                                            {valuesAsText ? (
                                                <ReadOnlyText text={description} />
                                            ) : (
                                                <AutosizeTextarea
                                                    value={description}
                                                    onChange={(event) =>
                                                        set("description", event.target.value)
                                                    }
                                                    autoSize={{minRows: 4}}
                                                    className="resize-y rounded-[6px] text-[13px]"
                                                    aria-describedby={helpId}
                                                    aria-invalid={
                                                        descriptionMissing || descriptionError
                                                            ? true
                                                            : undefined
                                                    }
                                                    placeholder={t(
                                                        "entityUi.skillForm.descriptionPlaceholder",
                                                    )}
                                                    disabled={disabled}
                                                />
                                            )}
                                        </Field>
                                    )}
                                </FieldWithHelp>
                            </>
                        ) : null}
                        <Field
                            className={cn(
                                "flex flex-col",
                                expanded ? "min-h-0 flex-1" : EDITOR_MIN,
                            )}
                            invalid={bodyMissing}
                            error={bodyError}
                        >
                            <div
                                className={cn(
                                    "flex flex-col overflow-hidden rounded-md border border-solid border-border",
                                    expanded ? "min-h-0 flex-1" : `${EDITOR_MIN} flex-1`,
                                )}
                            >
                                <div className="flex shrink-0 items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary bg-[var(--ag-surface-raised)] py-1 pl-1.5 pr-1">
                                    <div ref={setToolbarHost} className="min-w-0 flex-1" />
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setBodyView((v) =>
                                                v === "source" ? "rendered" : "source",
                                            )
                                        }
                                        className={cn(
                                            "shrink-0 cursor-pointer rounded-[6px] border-0 bg-transparent px-1.5 py-0.5 font-[inherit] text-[12px] font-medium text-colorText underline underline-offset-2 hover:bg-colorFillTertiary",
                                            PHONE_TOUCH_TARGET_CLASS,
                                        )}
                                    >
                                        {bodyView === "source"
                                            ? t("entityUi.schemaControls.richText")
                                            : t("entityUi.schemaControls.source")}
                                    </button>
                                    {expandButton}
                                </div>
                                <div className="md-prose-panel flex min-h-0 flex-1 flex-col">
                                    <MarkdownEditor
                                        value={body}
                                        onChange={(next) => set("body", next)}
                                        placeholder={t("entityUi.skillForm.bodyPlaceholder")}
                                        disabled={disabled}
                                        showToolbar={!valuesAsText}
                                        toolbarContainer={toolbarHost}
                                        view={bodyView}
                                        onViewChange={setBodyView}
                                        hideHeader
                                        bordered={false}
                                        grow
                                    />
                                </div>
                            </div>
                        </Field>
                        {!expanded ? (
                            <div className="flex shrink-0 flex-col">
                                <button
                                    type="button"
                                    onClick={() => setAdvancedOpen((prev) => !prev)}
                                    // Not disabled when read only: the switches stay readable.
                                    aria-expanded={advancedOpen}
                                    className="flex cursor-pointer items-center justify-between border-0 bg-transparent px-0 py-1.5 font-[inherit] max-md:min-h-11"
                                >
                                    <span className="flex items-center gap-2">
                                        <SlidersHorizontal
                                            size={14}
                                            className="text-colorTextSecondary"
                                        />
                                        <span className="text-[12px] font-medium leading-4 text-colorText">
                                            {t("entityUi.skillForm.advanced")}
                                        </span>
                                    </span>
                                    <CollapseCaret
                                        open={advancedOpen}
                                        size={10}
                                        className="text-colorTextSecondary"
                                    />
                                </button>
                                <HeightCollapse open={advancedOpen}>
                                    <div className="flex flex-col gap-3 pb-2 pt-1">
                                        <SwitchRow
                                            label={t("entityUi.skillForm.hideFromPrompt")}
                                            hint={t("entityUi.skillForm.hideFromPromptHint", {
                                                // The command a person types (F07 f8): the skill's own name.
                                                name: SKILL_NAME_PATTERN.test(name) ? name : "name",
                                            })}
                                            checked={Boolean(skill.disable_model_invocation)}
                                            onChange={(on) => set("disable_model_invocation", on)}
                                            disabled={disabled}
                                            valuesAsText={valuesAsText}
                                        />
                                        <SwitchRow
                                            label={t("entityUi.skillForm.allowExecutable")}
                                            hint={t("entityUi.skillForm.allowExecutableHint")}
                                            checked={Boolean(skill.allow_executable_files)}
                                            onChange={(on) => set("allow_executable_files", on)}
                                            disabled={disabled}
                                            valuesAsText={valuesAsText}
                                        />
                                    </div>
                                </HeightCollapse>
                            </div>
                        ) : null}
                    </>
                ) : (
                    <>
                        {!expanded ? (
                            <>
                                <FieldWithHelp
                                    help={
                                        valuesAsText
                                            ? undefined
                                            : newFile
                                              ? t("entityUi.skillView.newPathHint")
                                              : t("entityUi.skillView.pathHint")
                                    }
                                >
                                    {(helpId) => (
                                        <Field
                                            className="shrink-0"
                                            label={fieldLabel(t("entityUi.skillView.filePath"))}
                                            error={
                                                shownPathProblem
                                                    ? t(PATH_PROBLEM_KEY[shownPathProblem])
                                                    : undefined
                                            }
                                        >
                                            {valuesAsText ? (
                                                <ReadOnlyText text={activePath} mono />
                                            ) : (
                                                <Input
                                                    ref={pathInput}
                                                    value={activePath}
                                                    onChange={(event) => {
                                                        setFreshFile(null)
                                                        updateFile(activeIndex as number, {
                                                            path: event.target.value,
                                                        })
                                                    }}
                                                    placeholder="scripts/foo.py"
                                                    aria-invalid={
                                                        shownPathProblem ? true : undefined
                                                    }
                                                    aria-describedby={helpId}
                                                    disabled={disabled}
                                                    className="h-[34px] rounded-[6px] font-mono text-[13px]"
                                                />
                                            )}
                                        </Field>
                                    )}
                                </FieldWithHelp>
                                <SwitchRow
                                    label={t("entityUi.skillForm.markExecutable")}
                                    hint={t("entityUi.skillView.markExecutableHint")}
                                    checked={Boolean(activeFile?.executable)}
                                    onChange={(on) =>
                                        updateFile(activeIndex as number, {
                                            executable: on || undefined,
                                        })
                                    }
                                    // A file runs only when the skill allows executable files.
                                    disabled={disabled || !skill.allow_executable_files}
                                    valuesAsText={valuesAsText}
                                />
                            </>
                        ) : null}
                        {/* Plain text with no toolbar row (F07 f4); the expand button floats in the corner. */}
                        <div
                            className={cn(
                                "relative flex flex-col overflow-hidden rounded-[6px] border border-solid border-border",
                                expanded ? "min-h-0 flex-1" : `${EDITOR_MIN} flex-1`,
                            )}
                        >
                            <div className="absolute right-1 top-1 z-10">{expandButton}</div>
                            <div className="flex min-h-0 flex-1 flex-col">
                                {/* Keyed by index (paths are editable) for a fresh editor per file;
                                    no debounce, so a file switch cannot drop a pending edit. */}
                                <CodeEditor
                                    key={`skill-file-${activeIndex}`}
                                    value={activeFile?.content ?? ""}
                                    onChange={(next) =>
                                        updateFile(activeIndex as number, {content: next})
                                    }
                                    language={codeLanguageFromPath(activePath)}
                                    placeholder={t("entityUi.skillForm.fileContent")}
                                    disabled={disabled}
                                    disableDebounce
                                    grow
                                    plain
                                />
                            </div>
                        </div>
                    </>
                )}
            </div>

            <AlertDialog
                open={deleting !== null}
                onOpenChange={(next) => {
                    if (!next) setDeleting(null)
                }}
            >
                <AlertDialogContent className="sm:max-w-[400px]">
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t("entityUi.skillView.deleteTitle", {name: deletingName})}
                        </AlertDialogTitle>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button variant="outline">{t("entityUi.skillView.cancel")}</Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button
                                variant="destructive"
                                onClick={() => {
                                    if (deleting !== null) removeFile(deleting)
                                    setDeleting(null)
                                }}
                            >
                                {t("entityUi.skillView.delete")}
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
