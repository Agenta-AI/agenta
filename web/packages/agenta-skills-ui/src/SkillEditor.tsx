import {useCallback, useEffect, useRef, useState, type ReactNode} from "react"

import {MarkdownEditor} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import {SKILL_DESCRIPTION_MAX, type SkillFile} from "@agenta/skills"
import {MarkdownPreview} from "@agenta/ui"
import {useIsExpandedWindow} from "@agenta/ui/hooks"
import {cn} from "@agenta/ui/styles"
import {
    Button,
    Field,
    IconTile,
    Input,
    RightPane,
    Segmented,
    Switch,
    Textarea,
} from "@agenta/ui/ui"
import {CaretRight, Files, FileText, X} from "@phosphor-icons/react"

import {
    baseOf,
    descriptionTooLong,
    dirOf,
    draftSkillName,
    isMarkdownPath,
    type SkillDraft,
} from "./skillDraft"
import {SkillFilesPanel} from "./SkillFilesPanel"
import {SkillHint} from "./SkillHint"

type InstructionsView = "write" | "preview"

export interface SkillEditorProps {
    draft: SkillDraft
    onChange: (next: SkillDraft) => void
    readOnly?: boolean
    /** A Name field on top (the create page; the skill page edits the name in its title). */
    showName?: boolean
    autoFocusName?: boolean
    /** Paints empty required fields once a save was tried. */
    showMissing?: boolean
    /** Where Instructions opens: Preview for a saved skill, Write for a new one. */
    defaultView?: InstructionsView
    /** Above the fields (banners). */
    notices?: ReactNode
    /**
     * Where Files goes: the page's right pane, or "inline" for a host that is itself a drawer or a
     * panel (a column beside the fields when it is wide, a Files row that swaps in when it is not).
     */
    filesPlacement?: "pane" | "inline"
}

const EDITOR_FRAME = "flex min-h-[320px] flex-col [&_.md-prose]:min-h-[280px]"

/** The skill editor the skill page and the create page share: fields, a file, the Files pane. */
export function SkillEditor({
    draft,
    onChange,
    readOnly = false,
    showName = false,
    autoFocusName = false,
    showMissing = false,
    defaultView = "preview",
    notices,
    filesPlacement = "pane",
}: SkillEditorProps) {
    const t = useT(skillsEditorCatalog)
    const tCommon = useT(commonCatalog)
    const inline = filesPlacement === "inline"
    const expanded = useIsExpandedWindow() && !inline
    const [filesOpen, setFilesOpen] = useState(expanded)
    // Docked beside the editor on a wide window; a drill-in a tap away on a narrow one.
    useEffect(() => setFilesOpen(expanded), [expanded])
    const [openPath, setOpenPath] = useState<string | null>(null)
    const [view, setView] = useState<InstructionsView>(readOnly ? "preview" : defaultView)

    // Latest draft and handler in refs, so the files panel gets stable callbacks and skips keystrokes.
    const latest = useRef(draft)
    latest.current = draft
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    const set = useCallback(
        (patch: Partial<SkillDraft>) => onChangeRef.current({...latest.current, ...patch}),
        [],
    )
    const updateFiles = useCallback(
        (update: (files: SkillFile[]) => SkillFile[]) => set({files: update(latest.current.files)}),
        [set],
    )
    const setAllowExecutable = useCallback(
        (allowExecutable: boolean) => set({allowExecutable}),
        [set],
    )
    const expandedRef = useRef(expanded)
    expandedRef.current = expanded
    const openFile = useCallback((path: string | null) => {
        setOpenPath(path)
        // Narrow windows show the file in place of the pane.
        if (!expandedRef.current) setFilesOpen(false)
    }, [])
    const moved = useCallback(
        (from: string, to: string | null) => setOpenPath((open) => (open === from ? to : open)),
        [],
    )

    const current = draft.files.find((file) => file.path === openPath) ?? null
    const tooLong = descriptionTooLong(draft)
    const missingName = showMissing && !draftSkillName(draft)
    const missingDescription = showMissing && !draft.description.trim()
    const missingBody = showMissing && !draft.body.trim()
    const savedAs = draft.name.trim() ? draftSkillName(draft) : ""

    const setFile = (patch: Partial<SkillFile>) =>
        updateFiles((files) =>
            files.map((file) => (file.path === openPath ? {...file, ...patch} : file)),
        )

    const filesRow = expanded ? null : (
        <button
            type="button"
            onClick={() => setFilesOpen(true)}
            className={cn(
                inline && "@2xl:hidden",
                "-mx-2 flex h-row-single cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left font-[inherit] text-label text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-accent max-sm:min-h-11 motion-reduce:transition-none",
            )}
        >
            <IconTile size={20} aria-hidden>
                <Files />
            </IconTile>
            <span className="min-w-0 flex-1 truncate">
                {t("skills.editor.filesCount", {count: draft.files.length + 1})}
            </span>
            <CaretRight aria-hidden size={14} className="text-muted-foreground" />
        </button>
    )

    const fileView = current ? (
        <section key={current.path} className="flex flex-col gap-3">
            <div className="flex min-h-8 items-center gap-2">
                <span title={current.path} className="flex min-w-0 flex-1 items-baseline">
                    {dirOf(current.path) ? (
                        <span className="min-w-0 shrink-[3] truncate text-label text-muted-foreground">
                            {dirOf(current.path)}/
                        </span>
                    ) : null}
                    <span className="min-w-0 truncate text-title text-foreground">
                        {baseOf(current.path)}
                    </span>
                </span>
                {isMarkdownPath(current.path) || readOnly ? null : (
                    <label className="flex shrink-0 cursor-pointer items-center gap-2 text-label text-muted-foreground">
                        {t("skills.editor.runAsProgram")}
                        <Switch
                            size="sm"
                            checked={Boolean(current.executable)}
                            onCheckedChange={(on) => setFile({executable: on || undefined})}
                        />
                    </label>
                )}
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("skills.editor.closeFile")}
                    onClick={() => setOpenPath(null)}
                >
                    <X />
                </Button>
            </div>
            {current.executable && !draft.allowExecutable ? (
                <p className="m-0 text-meta text-warning">{t("skills.editor.turnOnPrograms")}</p>
            ) : null}
            {isMarkdownPath(current.path) ? (
                <div className={EDITOR_FRAME}>
                    <MarkdownEditor
                        value={current.content}
                        onChange={(content) => setFile({content})}
                        placeholder={t("skills.editor.filePlaceholder")}
                        editable={!readOnly}
                        showToolbar={!readOnly}
                        defaultView="rendered"
                        hideHeader
                    />
                </div>
            ) : (
                <Textarea
                    aria-label={current.path}
                    value={current.content}
                    readOnly={readOnly}
                    spellCheck={false}
                    rows={18}
                    onChange={(event) => setFile({content: event.target.value})}
                    className="resize-y font-mono text-meta"
                />
            )}
        </section>
    ) : null

    const skillView = (
        <div className="flex flex-col gap-6">
            {showName ? (
                <div className="flex flex-col gap-1">
                    <Field
                        label={t("skills.editor.name")}
                        description={t("skills.editor.nameHint")}
                        error={missingName ? t("skills.editor.nameMissing") : undefined}
                    >
                        <Input
                            autoFocus={autoFocusName}
                            value={draft.name}
                            readOnly={readOnly}
                            aria-invalid={missingName || undefined}
                            placeholder={t("skills.editor.namePlaceholder")}
                            onChange={(event) => set({name: event.target.value})}
                        />
                    </Field>
                    {!missingName && savedAs && savedAs !== draft.name ? (
                        <p className="m-0 text-meta text-muted-foreground">
                            {t("skills.editor.savedAs", {name: savedAs})}
                        </p>
                    ) : null}
                </div>
            ) : null}
            <div className="flex flex-col gap-1">
                <Field
                    label={t("skills.editor.description")}
                    description={t("skills.editor.descriptionHint")}
                    error={
                        tooLong
                            ? t("skills.editor.descriptionTooLong")
                            : missingDescription
                              ? t("skills.editor.descriptionMissing")
                              : undefined
                    }
                >
                    <Textarea
                        rows={4}
                        value={draft.description}
                        readOnly={readOnly}
                        aria-invalid={tooLong || missingDescription || undefined}
                        placeholder={t("skills.editor.descriptionPlaceholder")}
                        onChange={(event) => set({description: event.target.value})}
                        className="resize-y"
                    />
                </Field>
                <span
                    className={cn(
                        "self-end text-meta tabular-nums",
                        tooLong ? "text-destructive" : "text-muted-foreground",
                    )}
                >
                    {t("skills.editor.descriptionCount", {
                        length: draft.description.length,
                        max: SKILL_DESCRIPTION_MAX,
                    })}
                </span>
            </div>
            <section className="flex flex-col gap-2">
                <div className="flex items-end gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-label font-medium text-foreground">
                            {t("skills.editor.instructions")}
                        </span>
                        <SkillHint>{t("skills.editor.instructionsHint")}</SkillHint>
                    </div>
                    {readOnly ? null : (
                        <Segmented
                            size="sm"
                            value={view}
                            onChange={(next) => setView(next as InstructionsView)}
                            options={[
                                {value: "write", label: t("skills.editor.write")},
                                {value: "preview", label: t("skills.editor.preview")},
                            ]}
                        />
                    )}
                </div>
                {view === "write" && !readOnly ? (
                    <div className={cn(EDITOR_FRAME, missingBody && "[&_.md-prose]:outline-destructive")}>
                        <MarkdownEditor
                            value={draft.body}
                            onChange={(body) => set({body})}
                            placeholder={t("skills.editor.instructionsPlaceholder")}
                            showToolbar
                            defaultView="rendered"
                            hideHeader
                        />
                    </div>
                ) : draft.body.trim() ? (
                    <div className="rounded-lg border border-solid border-border-muted px-4 py-3">
                        <MarkdownPreview content={draft.body} />
                    </div>
                ) : (
                    <p className="m-0 rounded-lg border border-dashed border-border px-4 py-6 text-center text-label text-muted-foreground">
                        {readOnly ? t("skills.editor.nothingWritten") : t("skills.editor.nothingYet")}
                    </p>
                )}
                {missingBody ? (
                    <p role="alert" className="m-0 text-meta text-destructive">
                        {t("skills.editor.instructionsMissing")}
                    </p>
                ) : null}
            </section>
        </div>
    )

    const filesPanel = (
        <SkillFilesPanel
            files={draft.files}
            allowExecutable={draft.allowExecutable}
            readOnly={readOnly}
            openPath={openPath}
            onOpen={openFile}
            onMoved={moved}
            onFiles={updateFiles}
            onAllowExecutable={setAllowExecutable}
        />
    )
    const filesTitle = (
        <span className="flex items-center gap-2">
            <FileText aria-hidden size={16} />
            {t("skills.editor.files")}
        </span>
    )

    if (inline) {
        // One Files panel: a column at 672px and wider; below, it takes the fields' place while open.
        return (
            <div className="@container min-w-0">
                <div className="flex min-w-0 gap-6">
                    <div
                        className={cn(
                            "min-w-0 flex-1 flex-col gap-4",
                            filesOpen ? "hidden @2xl:flex" : "flex",
                        )}
                    >
                        {notices}
                        {filesRow}
                        {fileView ?? skillView}
                    </div>
                    <aside
                        className={cn(
                            "min-w-0 flex-col gap-3 @2xl:flex @2xl:w-64 @2xl:shrink-0",
                            filesOpen ? "flex flex-1" : "hidden",
                        )}
                    >
                        <div className="flex min-h-8 items-center gap-2 text-label font-medium text-foreground">
                            <span className="flex-1">{filesTitle}</span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="@2xl:hidden"
                                aria-label={tCommon("common.close")}
                                onClick={() => setFilesOpen(false)}
                            >
                                <X />
                            </Button>
                        </div>
                        {filesPanel}
                    </aside>
                </div>
            </div>
        )
    }

    return (
        <div className="flex min-w-0 flex-col gap-4">
            {notices}
            {filesRow}
            {fileView ?? skillView}
            <RightPane open={filesOpen} onOpenChange={setFilesOpen} title={filesTitle}>
                {filesPanel}
            </RightPane>
        </div>
    )
}
