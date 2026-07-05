/**
 * InstructionsDrawer
 *
 * The right-hand editor drawer for a single instructions markdown file (e.g. AGENTS.md), opened
 * from a file row in the Instructions section. A header `Edit | Preview` toggle switches between the
 * editing view (the shared `MarkdownEditor` with a formatting toolbar) and a read-only rendered
 * Preview that can Expand to fill the drawer. A right rail carries suggested-action scaffolds and a
 * version-history placeholder.
 *
 * Like the tools/skills drawer, editing happens on a draft the host owns: the drawer reports changes
 * via `onChange`, commits via `onSave`, and discards via `onCancel` / the close button, so an
 * in-progress edit never touches the config until the user confirms.
 *
 * Built on the shared `EnhancedDrawer`. Version history is a stubbed skeleton for now — wiring the
 * revision-diff data is a separate increment.
 */
import {useCallback, useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {ArrowsIn, ArrowsOut, FileText, Lightbulb} from "@phosphor-icons/react"
import {Segmented, Tooltip} from "antd"

import {MarkdownEditor} from "./MarkdownEditor"

export interface InstructionsDrawerProps {
    open: boolean
    /** File name shown in the drawer header (e.g. "AGENTS.md"). */
    filename: string
    /** Current draft content. */
    value: string
    /** Report a draft edit (content or a suggested-action insertion). */
    onChange: (next: string) => void
    /** Discard the draft and dismiss the drawer. */
    onCancel: () => void
    /** Commit the draft to the config. */
    onSave: () => void
    disabled?: boolean
}

type DrawerMode = "edit" | "preview"

// Suggested section scaffolds — clicking appends a ready-to-edit starting point (a sentence plus a
// couple of example bullets), not an instruction to the author. Purely additive; nothing is required.
const SUGGESTIONS: {label: string; snippet: string}[] = [
    {
        label: "Output format",
        snippet:
            "\n\n## Output format\nRespond with a short, direct answer in plain text.\n- Lead with the answer, then a one-line reason.\n- Use bullet points for steps or lists.\n",
    },
    {
        label: "Tone & style",
        snippet:
            "\n\n## Tone & style\nWrite in a warm, professional voice.\n- Keep it concise and free of jargon.\n- Mirror the user's language and level of formality.\n",
    },
    {
        label: "Guardrails",
        snippet:
            "\n\n## Guardrails\nStay within the agent's scope.\n- Never share internal data or credentials.\n- Don't give legal, medical, or financial advice.\n- If a request is unclear, ask one clarifying question.\n",
    },
]

export function InstructionsDrawer({
    open,
    filename,
    value,
    onChange,
    onCancel,
    onSave,
    disabled = false,
}: InstructionsDrawerProps) {
    const [mode, setMode] = useState<DrawerMode>("edit")
    const [expanded, setExpanded] = useState(false)

    const appendSnippet = useCallback(
        (snippet: string) => onChange(`${value}${snippet}`),
        [value, onChange],
    )

    const changeMode = useCallback((next: DrawerMode) => {
        setMode(next)
        if (next === "edit") setExpanded(false)
    }, [])

    const railHidden = mode === "preview" && expanded

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onCancel}
            placement="right"
            width={920}
            // Explicit Cancel/Save only — an outside click must not silently drop the draft.
            closeOnLayoutClick={false}
            destroyOnClose
            title={
                <div className="flex min-w-0 items-center gap-2">
                    <FileText size={16} />
                    <span className="truncate font-mono text-sm font-medium">{filename}</span>
                </div>
            }
            extra={
                <Segmented<DrawerMode>
                    value={mode}
                    onChange={(v) => changeMode(v)}
                    options={[
                        {label: "Edit", value: "edit"},
                        {label: "Preview", value: "preview"},
                    ]}
                />
            }
            footer={
                <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">
                        Draft — applies on save
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                        <Button onClick={onCancel} variant="outline">
                            Cancel
                        </Button>
                        <Button onClick={onSave} disabled={disabled}>
                            Save
                        </Button>
                    </div>
                </div>
            }
            styles={{body: {padding: 16, overflow: "hidden"}}}
        >
            <div className="flex h-full min-h-0 gap-6">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {mode === "edit" ? (
                        <MarkdownEditor
                            value={value}
                            onChange={onChange}
                            disabled={disabled}
                            showToolbar
                            defaultView="rendered"
                            hideHeader
                            fill
                            placeholder={
                                "# Role\n\nDescribe what the agent does and how it should behave…"
                            }
                        />
                    ) : (
                        <div className="relative flex-1">
                            <Tooltip title={expanded ? "Collapse" : "Expand"}>
                                <button
                                    type="button"
                                    aria-label={expanded ? "Collapse preview" : "Expand preview"}
                                    onClick={() => setExpanded((e) => !e)}
                                    className="absolute right-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] bg-[var(--ag-c-FFFFFF,#fff)] text-[var(--ag-c-586673,#586673)] hover:border-[var(--ag-c-97A4B0,#97a4b0)]"
                                >
                                    {expanded ? <ArrowsIn size={14} /> : <ArrowsOut size={14} />}
                                </button>
                            </Tooltip>
                            <MarkdownEditor
                                value={value}
                                onChange={onChange}
                                view="rendered"
                                editable={false}
                                hideHeader
                                bordered={false}
                                fill
                            />
                        </div>
                    )}
                </div>

                {!railHidden ? (
                    <div className="flex w-[240px] shrink-0 flex-col gap-6">
                        {filename === "AGENTS.md" ? (
                            <div className="rounded-md bg-[var(--ag-rgba-051729-04,rgba(5,23,41,0.04))] p-3">
                                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--ag-c-586673,#586673)]">
                                    <Lightbulb size={14} />
                                    Writing a good AGENTS.md
                                </div>
                                <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-[11px] leading-snug text-[var(--ag-c-97A4B0,#97a4b0)]">
                                    <li>
                                        Open with the agent&apos;s role and goal in one or two
                                        lines.
                                    </li>
                                    <li>
                                        Keep short, labelled sections (Role, Tools, Guardrails).
                                    </li>
                                    <li>Be concrete about the output format and hard limits.</li>
                                    <li>Prefer imperative instructions over long prose.</li>
                                </ul>
                            </div>
                        ) : null}
                        <div>
                            <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--ag-c-97A4B0,#97a4b0)]">
                                Suggested
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {SUGGESTIONS.map((s) => (
                                    <button
                                        key={s.label}
                                        type="button"
                                        disabled={disabled || mode === "preview"}
                                        onClick={() => appendSnippet(s.snippet)}
                                        className="cursor-pointer rounded-full border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] bg-transparent px-2.5 py-1 text-xs text-[var(--ag-c-586673,#586673)] transition-colors hover:border-[var(--ag-c-97A4B0,#97a4b0)] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        + {s.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <div className="mb-2 flex items-center gap-1.5">
                                <span className="text-[11px] uppercase tracking-wide text-[var(--ag-c-97A4B0,#97a4b0)]">
                                    Version history
                                </span>
                                <span className="rounded-full border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] px-1.5 text-[10px] text-[var(--ag-c-97A4B0,#97a4b0)]">
                                    soon
                                </span>
                            </div>
                            <div className="flex flex-col gap-2.5 opacity-50">
                                {[42, 32, 38].map((w, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ag-c-EAEFF5,#eaeff5)]" />
                                        <span
                                            className="h-2 rounded bg-[var(--ag-c-EAEFF5,#eaeff5)]"
                                            style={{width: `${w}%`}}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </EnhancedDrawer>
    )
}
