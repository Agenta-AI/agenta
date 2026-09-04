/**
 * SkillFormView
 *
 * Structured form view for one inline skill, the Form side of {@link ConfigItemDrawer}. Mirrors
 * the inline `SkillTemplateSchema` shape (sdk/utils/types.py, `__ag_type__ = "skill-template"`): a
 * kebab `name`, a `description` (the trigger the model matches), the `body` (SKILL.md Markdown),
 * the supporting `files[]`, and two behaviour flags.
 *
 * Laid out as a folder (matching the design): a left Files sidebar — SKILL.md pinned first, the
 * bundled files below, and a drop zone — beside a right editor pane for the selected file, with the
 * skill-level Name/Description and behaviour toggles. Author a skill by dropping/browsing a folder,
 * `.zip`, or `.skill` (parsed into the fields) or editing inline. `@ag.embed` reference entries are
 * NOT edited here — the host renders the drawer JSON-only for those so their markers round-trip.
 */
import {useEffect, useRef, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {HeightCollapse} from "@agenta/ui/height-collapse"
import {cn} from "@agenta/ui/styles"
import {
    AutosizeTextarea,
    Field,
    Input,
    Switch,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {
    CaretDown,
    File as FileIcon,
    Info,
    Plus,
    SlidersHorizontal,
    Trash,
} from "@phosphor-icons/react"

import {CodeEditor, codeLanguageFromPath} from "./CodeEditor"
import {MarkdownEditor} from "./MarkdownEditor"
import {
    NOT_TEXT,
    SKILL_BODY_MAX,
    SKILL_DESCRIPTION_MAX,
    SKILL_NAME_MAX,
    skillNameError,
    slugifySkillName,
} from "./skillName"
import {mergePastedSkill, type ParsedSkill, type SkillFileEntry} from "./skillUpload"
import {SkillUploadZone} from "./SkillUploadZone"

export interface SkillFormViewProps {
    value: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
}

/** Which file the right pane is editing: the pinned SKILL.md body, or a `files[]` entry by index. */
type Selection = "skill" | number

/** A compact label-left / switch-right toggle row (the switch keeps its natural width). */
function ToggleRow({
    label,
    description,
    checked,
    onChange,
    disabled,
}: {
    label: string
    description: string
    checked: boolean
    onChange: (value: boolean) => void
    disabled?: boolean
}) {
    return (
        <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1">
                <span className="text-xs font-medium">{label}</span>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            {/* No aria-label: a generic span prohibits it (axe
                                `aria-prohibited-attr`); Radix wires aria-describedby instead. */}
                            <span className="flex shrink-0 items-center">
                                <Info size={13} className="shrink-0 text-[var(--ag-zinc-5)]" />
                            </span>
                        </TooltipTrigger>
                        <TooltipContent side="right">{description}</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
            <Switch
                checked={checked}
                onCheckedChange={onChange}
                disabled={disabled}
                aria-label={label}
                className="shrink-0"
            />
        </div>
    )
}

/** One row in the left Files list. */
function FileRow({
    label,
    active,
    onSelect,
    onRemove,
    disabled,
}: {
    label: string
    active: boolean
    onSelect: () => void
    onRemove?: () => void
    disabled?: boolean
}) {
    return (
        // Row stays clickable but is not the role=button node — it holds the remove button
        // (nested-interactive). The button role lives on the label span below.
        <div
            onClick={onSelect}
            className={cn(
                "group/file flex cursor-pointer items-center gap-1.5 rounded px-2 py-1",
                // The list panel is the elevated/item colour; the selected row gets a fill overlay
                // (distinct in both light and dark, where EAEFF5 and F5F7FA collapse to one value).
                active
                    ? "bg-[var(--ant-color-fill-secondary)]"
                    : "hover:bg-[var(--ant-color-fill-tertiary)]",
            )}
        >
            <FileIcon size={13} className="shrink-0 text-[var(--ag-zinc-5)]" />
            <span
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onSelect()
                    }
                }}
                className="min-w-0 flex-1 truncate font-mono text-xs"
            >
                {label}
            </span>
            {onRemove && !disabled ? (
                <button
                    type="button"
                    aria-label="Remove file"
                    onClick={(e) => {
                        e.stopPropagation()
                        onRemove()
                    }}
                    className="flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 text-[var(--ag-zinc-5)] opacity-0 transition-opacity hover:text-colorError group-hover/file:opacity-100"
                >
                    <Trash size={13} />
                </button>
            ) : null}
        </div>
    )
}

export function SkillFormView({value, onChange, disabled}: SkillFormViewProps) {
    const skill = (value ?? {}) as Record<string, unknown>
    const files: SkillFileEntry[] = Array.isArray(skill.files)
        ? (skill.files as SkillFileEntry[])
        : []

    const [selected, setSelected] = useState<Selection>("skill")
    // Quiet on a pristine draft; on once the user or an upload touches the field.
    const [nameTouched, setNameTouched] = useState(() => Boolean(String(skill.name ?? "").trim()))
    const [descriptionTouched, setDescriptionTouched] = useState(() =>
        Boolean(String(skill.description ?? "").trim()),
    )
    const [bodyTouched, setBodyTouched] = useState(() => Boolean(String(skill.body ?? "").trim()))
    // Open when a flag is already off-default, so an existing skill never hides a set toggle.
    const [advancedOpen, setAdvancedOpen] = useState(
        () => Boolean(skill.disable_model_invocation) || Boolean(skill.allow_executable_files),
    )

    // The JSON view can put any type here, and a cast alone would let `.trim()` / spread throw.
    const asText = (value: unknown) => (typeof value === "string" ? value : "")
    const notText = (value: unknown) => value != null && typeof value !== "string"
    const name = asText(skill.name)
    const description = asText(skill.description)
    const body = asText(skill.body)
    // An empty value reads as red chrome (label + input border) rather than a "Required." line.
    // A non-string value is NOT missing — it has its own NOT_TEXT message, which must still show.
    const missing = (raw: unknown, text: string, touched: boolean) =>
        !notText(raw) && touched && !text.trim()

    const rawNameError = skillNameError(skill.name, {touched: nameTouched})
    const nameMissing = missing(skill.name, name, nameTouched)
    const nameError = nameMissing ? undefined : rawNameError
    const nameSuggestion = nameError && name.trim() ? slugifySkillName(name) : ""
    const showNameSuggestion = Boolean(nameSuggestion) && nameSuggestion !== name
    const descriptionMissing = missing(skill.description, description, descriptionTouched)
    const descriptionError = notText(skill.description)
        ? NOT_TEXT
        : [...description].length > SKILL_DESCRIPTION_MAX
          ? `Max ${SKILL_DESCRIPTION_MAX} characters.`
          : undefined
    // Body gets the same treatment: without it an empty SKILL.md disables Create with no cue.
    const bodyMissing = missing(skill.body, body, bodyTouched)
    const bodyError = notText(skill.body)
        ? NOT_TEXT
        : [...body].length > SKILL_BODY_MAX
          ? `Max ${SKILL_BODY_MAX} characters.`
          : undefined

    const set = (key: string, fieldValue: unknown) => {
        const next = {...skill}
        if (
            fieldValue === undefined ||
            fieldValue === null ||
            fieldValue === "" ||
            fieldValue === false
        ) {
            delete next[key]
        } else {
            next[key] = fieldValue
        }
        onChange(next)
    }

    const setFiles = (next: SkillFileEntry[]) => {
        const updated = {...skill}
        if (next.length) updated.files = next
        else delete updated.files
        onChange(updated)
    }
    const updateFile = (index: number, patch: Partial<SkillFileEntry>) =>
        setFiles(files.map((f, i) => (i === index ? {...f, ...patch} : f)))
    const addFile = () => {
        setFiles([...files, {path: "", content: ""}])
        setSelected(files.length) // the new entry's index
    }
    const removeFile = (index: number) => {
        setFiles(files.filter((_, i) => i !== index))
        setSelected((cur) => {
            if (cur === "skill") return cur
            if (cur === index) return "skill"
            return cur > index ? cur - 1 : cur
        })
    }

    // Merge an uploaded/parsed skill into the draft (only overwrite what the upload provides).
    const applyParsed = (parsed: ParsedSkill) => {
        const next = {...skill}
        if (parsed.name) next.name = parsed.name
        if (parsed.description) next.description = parsed.description
        // Touched regardless of what the upload carried, so a package missing a name or
        // description shows "Required." instead of only a dead Save button.
        setNameTouched(true)
        setDescriptionTouched(true)
        // body/files are always present on a parsed upload; assign unconditionally so a
        // replacement with an empty body or no bundled files clears the previous draft.
        next.body = parsed.body
        setBodyTouched(true)
        if (parsed.files.length) next.files = parsed.files
        else delete next.files
        onChange(next)
        setSelected("skill")
    }

    // Drawer-wide SKILL.md paste: refs keep the once-registered listener reading the latest draft.
    const skillRef = useRef(skill)
    skillRef.current = skill
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    useEffect(() => {
        if (disabled) return
        const onPaste = (e: ClipboardEvent) => {
            const el = e.target as HTMLElement | null
            if (
                el &&
                (el.tagName === "INPUT" ||
                    el.tagName === "TEXTAREA" ||
                    el.isContentEditable ||
                    el.closest('[contenteditable="true"]'))
            )
                return
            const text = e.clipboardData?.getData("text/plain") ?? ""
            // Only claim a paste that opens with a metadata block, so arbitrary pastes fall through.
            if (!/^\uFEFF?---\r?\n/.test(text)) return
            e.preventDefault()
            onChangeRef.current(mergePastedSkill(skillRef.current, text))
            setSelected("skill")
            message.success("Filled from the pasted skill")
        }
        document.addEventListener("paste", onPaste)
        return () => document.removeEventListener("paste", onPaste)
    }, [disabled])

    // The selected entry: SKILL.md (body) unless a valid file index is active.
    const activeFile = typeof selected === "number" ? files[selected] : undefined
    const showSkill = selected === "skill" || !activeFile

    return (
        <div className="flex h-full gap-3">
            {/* Left: full-height file list (SKILL.md pinned) with the drop zone pinned to the bottom. */}
            <div
                className={cn(
                    // -my/py pair: bleeds the divider through the drawer body's vertical padding so
                    // it meets the header and footer rules, without moving the rail's content.
                    // No `ag-drawer-rail`: that class paints a recessed band in dark, which shows
                    // through around the Files panel. The panel is this rail's surface, as in light.
                    "-my-4 flex w-44 shrink-0 flex-col gap-2 py-4 pr-3",
                    "border-0 border-r border-solid border-colorBorderSecondary",
                )}
            >
                <div className="flex shrink-0 items-center justify-between gap-1">
                    <span className="text-xs font-medium">Files</span>
                    {!disabled ? (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        type="button"
                                        aria-label="Add file"
                                        onClick={addFile}
                                        className="flex cursor-pointer items-center border-0 bg-transparent p-0 text-[var(--ag-c-586673)] hover:text-[var(--ag-c-1C2C3D)]"
                                    >
                                        <Plus size={14} />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent>Add a file</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    ) : null}
                </div>

                {/* The list grows to fill the column so the drop zone sits at the bottom. Filled
                    with the elevated/item colour so it reads as one panel, not a lone highlighted row. */}
                <div className="ag-rail-filelist flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto rounded-lg bg-[var(--ag-c-EAEFF5)] p-1">
                    <FileRow
                        label="SKILL.md"
                        active={showSkill}
                        onSelect={() => setSelected("skill")}
                        disabled={disabled}
                    />
                    {files.map((file, index) => (
                        <FileRow
                            key={index}
                            label={file.path || "untitled"}
                            active={selected === index}
                            onSelect={() => setSelected(index)}
                            onRemove={() => removeFile(index)}
                            disabled={disabled}
                        />
                    ))}
                </div>

                {!disabled ? (
                    <div className="shrink-0">
                        <SkillUploadZone onParsed={applyParsed} disabled={disabled} />
                    </div>
                ) : null}
            </div>

            {/* Right: skill-level fields + the selected file's editor + behaviour toggles. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden">
                <Field
                    className="shrink-0"
                    invalid={nameMissing}
                    label="Name"
                    tooltip="A short name like weather-report. Lowercase letters, numbers and hyphens only."
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
                                            className="cursor-pointer rounded-sm border-0 bg-transparent p-0 font-[inherit] text-xs text-error underline underline-offset-2 outline-none hover:no-underline hover:opacity-80 focus-visible:ring-2 focus-visible:ring-error/50 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"
                                        >
                                            Use &quot;{nameSuggestion}&quot;
                                        </button>
                                    </>
                                ) : null}
                            </span>
                        ) : undefined
                    }
                >
                    <Input
                        value={name}
                        onChange={(e) => {
                            setNameTouched(true)
                            set("name", e.target.value)
                        }}
                        onBlur={() => setNameTouched(true)}
                        maxLength={SKILL_NAME_MAX}
                        aria-invalid={nameMissing || nameError ? true : undefined}
                        placeholder="my-skill"
                        disabled={disabled}
                    />
                </Field>

                <Field
                    className="shrink-0"
                    invalid={descriptionMissing}
                    label="Description"
                    tooltip="Tells the agent when to use this skill."
                    error={descriptionError}
                >
                    <AutosizeTextarea
                        value={description}
                        onChange={(e) => {
                            setDescriptionTouched(true)
                            set("description", e.target.value)
                        }}
                        onBlur={() => setDescriptionTouched(true)}
                        autoSize={{minRows: 2, maxRows: 4}}
                        aria-invalid={descriptionMissing || descriptionError ? true : undefined}
                        placeholder="When the agent should reach for this skill"
                        disabled={disabled}
                    />
                </Field>

                {showSkill ? (
                    <Field
                        className="min-h-0 flex-1"
                        invalid={bodyMissing}
                        label="SKILL.md"
                        tooltip="The instructions the agent follows when it uses this skill."
                        error={bodyError}
                    >
                        <MarkdownEditor
                            value={body}
                            onChange={(v) => {
                                setBodyTouched(true)
                                set("body", v)
                            }}
                            placeholder={
                                "# My skill\n\nStep-by-step instructions the agent follows…"
                            }
                            disabled={disabled}
                            showToolbar
                            defaultView="rendered"
                            // Takes the drawer height left over after the other fields, so the body
                            // scrolls inside the editor and the drawer itself never does.
                            grow
                        />
                    </Field>
                ) : (
                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                        <div className="flex shrink-0 items-center gap-2">
                            <Input
                                value={activeFile?.path ?? ""}
                                onChange={(e) =>
                                    updateFile(selected as number, {path: e.target.value})
                                }
                                placeholder="scripts/foo.py"
                                aria-label="File path"
                                disabled={disabled}
                                className="font-mono"
                            />
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span className="flex shrink-0 items-center gap-1">
                                            <span className="font-mono text-xs text-colorTextDescription">
                                                +x
                                            </span>
                                            <Switch
                                                checked={Boolean(activeFile?.executable)}
                                                onCheckedChange={(v) =>
                                                    updateFile(selected as number, {
                                                        executable: v || undefined,
                                                    })
                                                }
                                                aria-label="Mark executable"
                                                disabled={disabled}
                                            />
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        Let this file run as a program. Your sandbox settings must
                                        allow it too.
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                        {/* Keyed by index (paths are editable) for a fresh editor per file; debounce off so a file switch cannot cancel a pending edit. */}
                        <CodeEditor
                            key={`skill-file-${selected}`}
                            value={activeFile?.content ?? ""}
                            onChange={(v) => updateFile(selected as number, {content: v})}
                            language={codeLanguageFromPath(activeFile?.path)}
                            placeholder="File content"
                            disabled={disabled}
                            disableDebounce
                            grow
                        />
                    </div>
                )}

                <div className="flex shrink-0 flex-col">
                    <button
                        type="button"
                        onClick={() => setAdvancedOpen((prev) => !prev)}
                        // Not disabled in read-only mode: the flags stay readable, just not editable.
                        aria-expanded={advancedOpen}
                        // px-0/font-[inherit]: preflight is off, so a bare button keeps the
                        // UA's 6px inline padding (misaligning it from the fields) and Arial.
                        className="flex cursor-pointer items-center justify-between border-0 bg-transparent px-0 py-1.5 font-[inherit]"
                    >
                        <span className="flex items-center gap-2">
                            <SlidersHorizontal
                                size={15}
                                className="text-[var(--ag-colorTextSecondary)]"
                            />
                            <span className="text-xs font-medium text-[var(--ag-colorText)]">
                                Advanced
                            </span>
                        </span>
                        <CaretDown
                            size={14}
                            className={`text-[var(--ag-colorIcon)] transition-transform ${
                                advancedOpen ? "" : "-rotate-90"
                            }`}
                        />
                    </button>
                    <HeightCollapse open={advancedOpen}>
                        <div className="flex flex-col gap-3 pb-2 pt-1">
                            <ToggleRow
                                label="Hide from prompt"
                                description="The agent won't pick this skill on its own. You run it yourself with /skill:name."
                                checked={Boolean(skill.disable_model_invocation)}
                                onChange={(v) => set("disable_model_invocation", v)}
                                disabled={disabled}
                            />

                            <ToggleRow
                                label="Allow executable files"
                                description="Let the files in this skill run as programs. Your sandbox settings must allow it too."
                                checked={Boolean(skill.allow_executable_files)}
                                onChange={(v) => set("allow_executable_files", v)}
                                disabled={disabled}
                            />
                        </div>
                    </HeightCollapse>
                </div>
            </div>
        </div>
    )
}
