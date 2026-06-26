/**
 * SkillFormView
 *
 * Structured form view for one inline skill, the Form side of {@link ConfigItemDrawer}. Mirrors
 * the inline `SkillConfigSchema` shape (sdk/utils/types.py, `__ag_type__ = "skill_config"`): a
 * kebab `name`, a `description` (the trigger the model matches), the `body` (SKILL.md Markdown),
 * the supporting `files[]`, and two behaviour flags.
 *
 * Laid out as a folder (matching the design): a left Files sidebar — SKILL.md pinned first, the
 * bundled files below, and a drop zone — beside a right editor pane for the selected file, with the
 * skill-level Name/Description and behaviour toggles. Author a skill by dropping/browsing a folder,
 * `.zip`, or `.skill` (parsed into the fields) or editing inline. `@ag.embed` reference entries are
 * NOT edited here — the host renders the drawer JSON-only for those so their markers round-trip.
 */
import {useState} from "react"

import {LabeledField} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/styles"
import {File as FileIcon, Info, Plus, Trash} from "@phosphor-icons/react"
import {Input, Switch, Tooltip, Typography} from "antd"

import {CodeEditor, codeLanguageFromPath} from "./CodeEditor"
import {MarkdownEditor} from "./MarkdownEditor"
import {type ParsedSkill, type SkillFileEntry} from "./skillUpload"
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
                <Typography.Text className="text-xs font-medium">{label}</Typography.Text>
                <Tooltip title={description}>
                    <Info size={13} className="shrink-0 text-[var(--ag-c-97A4B0,#97a4b0)]" />
                </Tooltip>
            </div>
            <Switch
                checked={checked}
                onChange={onChange}
                disabled={disabled}
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
        <div
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onSelect()
                }
            }}
            className={cn(
                "group/file flex cursor-pointer items-center gap-1.5 rounded px-2 py-1",
                // The list panel is the elevated/item colour; the selected row gets a fill overlay
                // (distinct in both light and dark, where EAEFF5 and F5F7FA collapse to one value).
                active
                    ? "bg-[var(--ant-color-fill-secondary)]"
                    : "hover:bg-[var(--ant-color-fill-tertiary)]",
            )}
        >
            <FileIcon size={13} className="shrink-0 text-[var(--ag-c-97A4B0,#97a4b0)]" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{label}</span>
            {onRemove && !disabled ? (
                <button
                    type="button"
                    aria-label="Remove file"
                    onClick={(e) => {
                        e.stopPropagation()
                        onRemove()
                    }}
                    className="flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 text-[var(--ag-c-97A4B0,#97a4b0)] opacity-0 transition-opacity hover:text-[var(--ag-c-FF4D4F,#ff4d4f)] group-hover/file:opacity-100"
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
        // body/files are always present on a parsed upload; assign unconditionally so a
        // replacement with an empty body or no bundled files clears the previous draft.
        next.body = parsed.body
        if (parsed.files.length) next.files = parsed.files
        else delete next.files
        onChange(next)
        setSelected("skill")
    }

    // The selected entry: SKILL.md (body) unless a valid file index is active.
    const activeFile = typeof selected === "number" ? files[selected] : undefined
    const showSkill = selected === "skill" || !activeFile

    return (
        <div className="flex h-full gap-3">
            {/* Left: full-height file list (SKILL.md pinned) with the drop zone pinned to the bottom. */}
            <div className="flex h-full w-44 shrink-0 flex-col gap-2 border-0 border-r border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] pr-3">
                <div className="flex shrink-0 items-center justify-between gap-1">
                    <Typography.Text className="text-xs font-medium">Files</Typography.Text>
                    {!disabled ? (
                        <Tooltip title="Add a file">
                            <button
                                type="button"
                                aria-label="Add file"
                                onClick={addFile}
                                className="flex cursor-pointer items-center border-0 bg-transparent p-0 text-[var(--ag-c-586673,#586673)] hover:text-[var(--ag-c-1C2C3D,#1c2c3d)]"
                            >
                                <Plus size={14} />
                            </button>
                        </Tooltip>
                    ) : null}
                </div>

                {/* The list grows to fill the column so the drop zone sits at the bottom. Filled
                    with the elevated/item colour so it reads as one panel, not a lone highlighted row. */}
                <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto rounded-lg bg-[var(--ag-c-EAEFF5,#eaeff5)] p-1">
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
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
                <LabeledField label="Name">
                    <Input
                        value={(skill.name as string | undefined) ?? ""}
                        onChange={(e) => set("name", e.target.value)}
                        placeholder="my-skill"
                        disabled={disabled}
                    />
                </LabeledField>

                <LabeledField
                    label="Description"
                    description="The trigger the model matches when deciding to use this skill"
                    withTooltip
                >
                    <Input.TextArea
                        value={(skill.description as string | undefined) ?? ""}
                        onChange={(e) => set("description", e.target.value)}
                        autoSize={{minRows: 2, maxRows: 4}}
                        placeholder="When the agent should reach for this skill"
                        disabled={disabled}
                    />
                </LabeledField>

                {showSkill ? (
                    <LabeledField
                        label="SKILL.md"
                        description="The Markdown body the harness reads, written after the composed frontmatter"
                        withTooltip
                    >
                        <MarkdownEditor
                            value={(skill.body as string | undefined) ?? ""}
                            onChange={(v) => set("body", v)}
                            placeholder={
                                "# My skill\n\nStep-by-step instructions the agent follows…"
                            }
                            disabled={disabled}
                            showToolbar
                            defaultView="rendered"
                        />
                    </LabeledField>
                ) : (
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <Input
                                value={activeFile?.path ?? ""}
                                onChange={(e) =>
                                    updateFile(selected as number, {path: e.target.value})
                                }
                                placeholder="scripts/foo.py"
                                disabled={disabled}
                                className="font-mono"
                            />
                            <Tooltip title="Mark executable (sandbox policy must also allow it)">
                                <span className="flex shrink-0 items-center gap-1">
                                    <Typography.Text type="secondary" className="font-mono text-xs">
                                        +x
                                    </Typography.Text>
                                    <Switch
                                        checked={Boolean(activeFile?.executable)}
                                        onChange={(v) =>
                                            updateFile(selected as number, {
                                                executable: v || undefined,
                                            })
                                        }
                                        disabled={disabled}
                                    />
                                </span>
                            </Tooltip>
                        </div>
                        <CodeEditor
                            value={activeFile?.content ?? ""}
                            onChange={(v) => updateFile(selected as number, {content: v})}
                            language={codeLanguageFromPath(activeFile?.path)}
                            placeholder="File content"
                            disabled={disabled}
                        />
                    </div>
                )}

                <ToggleRow
                    label="Hide from prompt"
                    description="Don't list this skill in the prompt — invoke only via /skill:name (Pi / Claude)"
                    checked={Boolean(skill.disable_model_invocation)}
                    onChange={(v) => set("disable_model_invocation", v)}
                    disabled={disabled}
                />

                <ToggleRow
                    label="Allow executable files"
                    description="Permit executable bundled files (the sandbox policy must also allow execution)"
                    checked={Boolean(skill.allow_executable_files)}
                    onChange={(v) => set("allow_executable_files", v)}
                    disabled={disabled}
                />
            </div>
        </div>
    )
}
