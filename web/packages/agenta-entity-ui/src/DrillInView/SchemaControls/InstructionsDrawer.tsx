/**
 * InstructionsDrawer
 *
 * The right-hand editor drawer for a single instructions markdown file (e.g. AGENTS.md), opened
 * from a file row in the Instructions section. It hosts the shared `MarkdownEditor` (which already
 * carries a source ↔ rendered toggle, so Preview comes for free) alongside a right rail of
 * suggested actions and a version-history placeholder.
 *
 * Like the tools/skills drawer, editing happens on a draft the host owns: the drawer reports
 * changes via `onChange`, commits via `onSave`, and discards via `onCancel` / the close button, so
 * an in-progress edit never touches the config until the user confirms.
 *
 * Built on the shared `EnhancedDrawer`. Version history is a stubbed skeleton for now — wiring the
 * revision-diff data is a separate increment.
 */
import {useCallback} from "react"

import {EnhancedDrawer} from "@agenta/ui/drawer"
import {FileText} from "@phosphor-icons/react"
import {Button} from "antd"

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

// Suggested section scaffolds — clicking appends a heading to the draft so the author has a
// starting point. Purely additive; nothing is required.
const SUGGESTIONS: {label: string; snippet: string}[] = [
    {label: "Output format", snippet: "\n\n## Output format\n"},
    {label: "Tone & style", snippet: "\n\n## Tone & style\n"},
    {label: "Guardrails", snippet: "\n\n## Guardrails\n"},
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
    const appendSnippet = useCallback(
        (snippet: string) => onChange(`${value}${snippet}`),
        [value, onChange],
    )

    return (
        <EnhancedDrawer
            open={open}
            onClose={onCancel}
            placement="right"
            width={720}
            // Explicit Cancel/Save only — an outside click must not silently drop the draft.
            closeOnLayoutClick={false}
            destroyOnClose
            title={
                <div className="flex min-w-0 items-center gap-2">
                    <FileText size={16} />
                    <span className="truncate font-mono text-sm font-medium">{filename}</span>
                </div>
            }
            footer={
                <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[var(--ag-c-97A4B0,#97a4b0)]">
                        Draft — applies on save
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                        <Button onClick={onCancel}>Cancel</Button>
                        <Button type="primary" onClick={onSave} disabled={disabled}>
                            Save
                        </Button>
                    </div>
                </div>
            }
            styles={{body: {padding: 16}}}
        >
            <div className="flex gap-4">
                <div className="min-w-0 flex-1">
                    <MarkdownEditor
                        value={value}
                        onChange={onChange}
                        disabled={disabled}
                        placeholder={
                            "# Role\n\nDescribe what the agent does and how it should behave…"
                        }
                    />
                </div>

                <div className="flex w-[200px] shrink-0 flex-col gap-4 border-l border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] pl-4">
                    <div>
                        <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--ag-c-97A4B0,#97a4b0)]">
                            Suggested
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {SUGGESTIONS.map((s) => (
                                <button
                                    key={s.label}
                                    type="button"
                                    disabled={disabled}
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
            </div>
        </EnhancedDrawer>
    )
}
