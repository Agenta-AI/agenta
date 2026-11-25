import {useCallback, useEffect, useRef, useState, type ReactNode} from "react"
import {createPortal} from "react-dom"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import type {SkillFile} from "@agenta/skills"
import {useIsExpandedWindow} from "@agenta/ui/hooks"
import {cn} from "@agenta/ui/styles"
import {
    Button,
    Field,
    IconTile,
    Input,
    RightPane,
    Textarea,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {CaretRight, Files, X} from "@phosphor-icons/react"

import {
    baseOf,
    descriptionTooLong,
    dirOf,
    draftSkillName,
    isMarkdownPath,
    type SkillDraft,
} from "./skillDraft"
import {SkillFilesPanel} from "./SkillFilesPanel"
import {SkillMarkdownFrame} from "./SkillMarkdownFrame"
import {useFillPageHeight} from "./useFillPageHeight"

export interface SkillEditorProps {
    draft: SkillDraft
    onChange: (next: SkillDraft) => void
    readOnly?: boolean
    /** A Name field on top (the create page; the skill page edits the name in its title). */
    showName?: boolean
    autoFocusName?: boolean
    /** Paints empty required fields once a save was tried. */
    showMissing?: boolean
    /** Above the fields (banners). */
    notices?: ReactNode
    /**
     * Where Files goes: the page's right pane, or "inline" for a host that is itself a drawer or a
     * panel (a column beside the fields when it is wide, a Files row that swaps in when it is not).
     */
    filesPlacement?: "pane" | "inline"
    /**
     * Where the Files toggle goes on a wide window (the page header's actions). Without it, a
     * closed pane reopens from the Files row above the fields.
     */
    filesToggleSlot?: HTMLElement | null
}

/** The skill editor the skill page and the create page share: fields, a file, the Files pane. */
const TOOLS_SLOT = "flex min-w-0 items-center overflow-x-auto [scrollbar-width:none]"

export function SkillEditor({
    draft,
    onChange,
    readOnly = false,
    showName = false,
    autoFocusName = false,
    showMissing = false,
    notices,
    filesPlacement = "pane",
    filesToggleSlot,
}: SkillEditorProps) {
    const t = useT(skillsEditorCatalog)
    const tCommon = useT(commonCatalog)
    const inline = filesPlacement === "inline"
    const expanded = useIsExpandedWindow() && !inline
    const [filesOpen, setFilesOpen] = useState(expanded)
    // Docked beside the editor on a wide window; a drill-in a tap away on a narrow one.
    useEffect(() => setFilesOpen(expanded), [expanded])
    const [openPath, setOpenPath] = useState<string | null>(null)
    // Slots in the label rows that the markdown formatting tools render into.
    const [bodyTools, setBodyTools] = useState<HTMLDivElement | null>(null)
    const [fileTools, setFileTools] = useState<HTMLDivElement | null>(null)
    const [addSlot, setAddSlot] = useState<HTMLDivElement | null>(null)
    const [fileBox, setFileBox] = useState<HTMLDivElement | null>(null)
    const fileHeight = useFillPageHeight(fileBox)
    const [bodyBox, setBodyBox] = useState<HTMLDivElement | null>(null)
    // On a page the instructions take the rest of the height; in a drawer they grow with the text.
    const bodyHeight = useFillPageHeight(inline ? null : bodyBox)

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

    // A narrow window opens Files from this row; a wide one from the header toggle when it has one.
    const filesRow =
        filesOpen || (expanded && filesToggleSlot !== undefined) ? null : (
            <button
                type="button"
                onClick={() => setFilesOpen(true)}
                className={cn(
                    inline && "@2xl:hidden",
                    "-mx-2 flex h-row-single cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left font-[inherit] text-label text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-accent motion-reduce:transition-none",
                )}
            >
                <IconTile size={24} aria-hidden>
                    <Files />
                </IconTile>
                <span className="min-w-0 flex-1 truncate">
                    {t("skills.editor.filesCount", {count: draft.files.length + 1})}
                </span>
                <CaretRight aria-hidden size={14} className="text-muted-foreground" />
            </button>
        )

    const filesToggle =
        expanded && filesToggleSlot
            ? createPortal(
                  <TooltipProvider>
                      <Tooltip>
                          <TooltipTrigger asChild>
                              <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={t("skills.editor.files")}
                                  aria-pressed={filesOpen}
                                  className={filesOpen ? "bg-selected" : undefined}
                                  onClick={() => setFilesOpen((open) => !open)}
                              >
                                  <Files />
                              </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("skills.editor.files")}</TooltipContent>
                      </Tooltip>
                  </TooltipProvider>,
                  filesToggleSlot,
              )
            : null

    const fileView = current ? (
        <section key={current.path} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                <span title={current.path} className="flex min-w-0 flex-1 items-baseline">
                    {dirOf(current.path) ? (
                        <span className="min-w-0 shrink-[3] truncate text-label text-muted-foreground">
                            {dirOf(current.path)}/
                        </span>
                    ) : null}
                    <span className="min-w-0 truncate text-subtitle text-foreground">
                        {baseOf(current.path)}
                    </span>
                </span>
                {isMarkdownPath(current.path) && !readOnly ? (
                    <div ref={setFileTools} className={TOOLS_SLOT} />
                ) : null}
            </div>
            {current.executable && !draft.allowExecutable ? (
                <p className="m-0 text-meta text-warning">{t("skills.editor.turnOnPrograms")}</p>
            ) : null}
            <div ref={setFileBox} style={{height: fileHeight}} className="flex min-h-0 flex-col">
                {isMarkdownPath(current.path) ? (
                    <SkillMarkdownFrame
                        value={current.content}
                        onChange={(content) => setFile({content})}
                        placeholder={t("skills.editor.filePlaceholder")}
                        empty={t("skills.editor.nothingWritten")}
                        readOnly={readOnly}
                        toolbar={fileTools}
                        fill
                    />
                ) : (
                    <Textarea
                        aria-label={current.path}
                        value={current.content}
                        readOnly={readOnly}
                        spellCheck={false}
                        onChange={(event) => setFile({content: event.target.value})}
                        className="h-full resize-none font-mono text-code"
                    />
                )}
            </div>
        </section>
    ) : null

    const skillView = (
        <div className="flex flex-col gap-4">
            {showName ? (
                <div className="flex flex-col gap-1">
                    <Field
                        label={t("skills.editor.name")}
                        tooltip={t("skills.editor.nameHint")}
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
                    tooltip={t("skills.editor.descriptionHint")}
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
                        className="field-sizing-content min-h-0 max-h-15 resize-none [scrollbar-width:none]"
                    />
                </Field>
            </div>
            <Field
                label={t("skills.editor.instructions")}
                tooltip={t("skills.editor.instructionsHint")}
                error={missingBody ? t("skills.editor.instructionsMissing") : undefined}
                labelEnd={readOnly ? null : <div ref={setBodyTools} className={TOOLS_SLOT} />}
            >
                <div
                    ref={setBodyBox}
                    style={inline ? undefined : {height: bodyHeight}}
                    className="flex min-h-0 flex-col"
                >
                    <SkillMarkdownFrame
                        fill={!inline}
                        value={draft.body}
                        onChange={(body) => set({body})}
                        placeholder={t("skills.editor.instructionsPlaceholder")}
                        empty={
                            readOnly
                                ? t("skills.editor.nothingWritten")
                                : t("skills.editor.nothingYet")
                        }
                        readOnly={readOnly}
                        invalid={missingBody}
                        toolbar={bodyTools}
                    />
                </div>
            </Field>
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
            docked={!inline}
            addSlot={inline ? undefined : addSlot}
        />
    )
    const filesTitle = (
        <span className="flex items-center gap-2">
            <Files aria-hidden size={16} />
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
            {filesToggle}
            {notices}
            {filesRow}
            {fileView ?? skillView}
            {/* The docked pane opens with the page; the Name field keeps the focus. */}
            <RightPane
                open={filesOpen}
                onOpenChange={setFilesOpen}
                title={filesTitle}
                actions={readOnly ? null : <div ref={setAddSlot} className="flex" />}
                focusOnOpen={false}
            >
                {filesPanel}
            </RightPane>
        </div>
    )
}
