/**
 * VariableCard — a single bordered input card for one playground variable.
 *
 * Header (single line):
 *   - Left:  variable name (mono, blue), TypeChip (inferLogicalType +
 *            chat-detection override), optional [draft] badge.
 *   - Right: ViewTypeSelect (the "View as ▾" dropdown — Text/Markdown/Chat/
 *            Form/JSON/YAML, options vary per kind).
 *
 * Body switches by the active view mode:
 *   - text     → Text editor (string), antd InputNumber (number), Switch
 *                (boolean), "null" placeholder (null)
 *   - markdown → SharedEditor with markdownView enabled
 *   - chat     → ChatMessageList over a messages array
 *   - form     → FormView (recursive object/array editor)
 *   - json     → SharedEditor (codeOnly language="json"), parse-on-edit
 *   - yaml     → SharedEditor (codeOnly language="yaml"), parse-on-edit
 *
 * All edits write NATIVE values via `onValueChange(name, value)` — the card
 * never stringifies on the way out (RFC: "native JSON stays native until
 * template rendering"). The runtime gets objects as objects, arrays as
 * arrays, numbers as numbers, etc.
 */

import {useCallback, useMemo, useState, type ReactNode} from "react"

import {
    FormView,
    ViewTypeSelect,
    coerceTextEdit,
    inferLogicalType,
    isChatMessagesArray,
    parseJsonEdit,
    parseYamlEdit,
    valueToDisplay,
} from "@agenta/entity-ui/view-types"
import type {LogicalType, ViewOption, ViewType} from "@agenta/entity-ui/view-types"
import {ChatMessageList} from "@agenta/ui/chat-message"
import type {SimpleChatMessage} from "@agenta/ui/chat-message"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {TypeChip} from "@agenta/ui/type-chip"
import type {ChipVariant} from "@agenta/ui/type-chip"
import {InputNumber, Switch, Tag, Typography} from "antd"
import clsx from "clsx"
import {useAtom} from "jotai"

import {variableViewModeAtomFamily} from "./viewModeAtoms"

const {Text: AntText} = Typography

interface VariableCardProps {
    /** Stable identifier for the generation row this variable lives in. */
    rowId: string
    /** Variable name (testcase column or referenced template variable). */
    name: string
    /** Native value, or `undefined` for a draft variable. */
    value: unknown
    /** Computed dropdown options for the value. Provided by the parent so we
     *  recompute consistently with how the parent decided which cards to
     *  render (e.g. for chat-shaped messages → Chat is offered). */
    options: ViewOption[]
    /** The default view mode for this value. Used when the user hasn't
     *  explicitly chosen one yet (atom value is `null`). */
    defaultMode: ViewType
    /** True when the variable is referenced by the prompt but not authored
     *  on the testcase yet. Renders a `[draft]` badge. */
    isDraft?: boolean
    /** Whether the card is editable (vs read-only). */
    editable: boolean
    /** Writes the new value to the testcase / draft store. NATIVE value. */
    onValueChange: (name: string, value: unknown) => void
    /** Notified when the user picks a new view mode (optional — only the
     *  atom family is the source of truth; parents can subscribe here for
     *  side effects like analytics). */
    onViewModeChange?: (name: string, mode: ViewType) => void
}

export function VariableCard({
    rowId,
    name,
    value,
    options,
    defaultMode,
    isDraft,
    editable,
    onValueChange,
    onViewModeChange,
}: VariableCardProps) {
    const [explicitMode, setExplicitMode] = useAtom(
        variableViewModeAtomFamily({rowId, varName: name}),
    )
    const mode: ViewType = explicitMode ?? defaultMode

    const handleModeChange = useCallback(
        (next: ViewType) => {
            setExplicitMode(next)
            onViewModeChange?.(name, next)
        },
        [setExplicitMode, onViewModeChange, name],
    )

    const handleValueChange = useCallback(
        (next: unknown) => onValueChange(name, next),
        [onValueChange, name],
    )

    const chipVariant = useMemo<ChipVariant>(
        () => (isChatMessagesArray(value) ? "messages" : (inferLogicalType(value) as ChipVariant)),
        [value],
    )

    return (
        <div className="agenta-variable-card flex flex-col gap-2 rounded-lg border border-[#e5e7eb] bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                    <AntText className="font-mono text-[12px] leading-[20px] font-medium text-[#1677FF] truncate">
                        {name}
                    </AntText>
                    <TypeChip variant={chipVariant} value={value} />
                    {isDraft ? (
                        <Tag
                            color="default"
                            style={{
                                fontSize: 10,
                                marginInlineEnd: 0,
                                fontFamily:
                                    "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                            }}
                            title="Not on testcase yet · saves when you fill this in and run or save."
                        >
                            draft
                        </Tag>
                    ) : null}
                </div>
                <ViewTypeSelect
                    value={mode}
                    options={options}
                    onChange={handleModeChange}
                    disabled={!editable}
                />
            </div>
            <div className="block">
                <CardBody
                    mode={mode}
                    value={value}
                    editable={editable}
                    onChange={handleValueChange}
                />
            </div>
        </div>
    )
}

/* ── Body switcher ──────────────────────────────────────────────────── */

interface CardBodyProps {
    mode: ViewType
    value: unknown
    editable: boolean
    onChange: (next: unknown) => void
}

function CardBody({mode, value, editable, onChange}: CardBodyProps): ReactNode {
    const originalType = useMemo<LogicalType>(() => inferLogicalType(value), [value])

    if (mode === "form") {
        // FormView expects an object record. If the value is an array, wrap
        // its indexed children into a record { "0": ..., "1": ... } so the
        // form can render. FormView itself recurses into arrays as well,
        // but its root signature is `Record<string, unknown>`.
        const obj =
            value !== null && typeof value === "object" && !Array.isArray(value)
                ? (value as Record<string, unknown>)
                : Array.isArray(value)
                  ? Object.fromEntries(value.map((v, i) => [String(i), v]))
                  : {}
        return (
            <FormView
                value={obj}
                editable={editable}
                onChange={(next) => {
                    if (Array.isArray(value)) {
                        // Recover an array from the indexed-record form. Sort
                        // the keys numerically and discard non-numeric keys
                        // (defensive — FormView preserves keys 1:1).
                        const rec = next as Record<string, unknown>
                        const arr: unknown[] = []
                        for (const [k, v] of Object.entries(rec)) {
                            const idx = Number(k)
                            if (Number.isInteger(idx) && idx >= 0) {
                                arr[idx] = v
                            }
                        }
                        onChange(arr)
                    } else {
                        onChange(next)
                    }
                }}
            />
        )
    }

    if (mode === "chat") {
        const messages = isChatMessagesArray(value) ? (value as SimpleChatMessage[]) : []
        return (
            <ChatMessageList
                messages={messages}
                onChange={(next) => onChange(next)}
                disabled={!editable}
            />
        )
    }

    if (mode === "json" || mode === "yaml") {
        return (
            <CodeLeafEditor
                key={`${mode}-${originalType}`}
                mode={mode}
                value={value}
                editable={editable}
                onChange={onChange}
            />
        )
    }

    // text / markdown for primitives — use the right widget per actual type.
    if (originalType === "number" && mode === "text") {
        return (
            <InputNumber
                size="middle"
                value={value as number}
                disabled={!editable}
                onChange={(next) => onChange(next ?? null)}
                placeholder="Enter number"
                className="w-full max-w-[320px]"
            />
        )
    }

    if (originalType === "boolean" && mode === "text") {
        return (
            <Switch
                checked={Boolean(value)}
                disabled={!editable}
                onChange={(next) => onChange(next)}
            />
        )
    }

    // string + null fall through to a SharedEditor (also covers markdown).
    return (
        <TextLeafEditor
            key={`${mode}-${originalType}`}
            mode={mode}
            value={value}
            editable={editable}
            originalType={originalType}
            onChange={onChange}
        />
    )
}

/* ── Text / Markdown editor ─────────────────────────────────────────── */

interface TextLeafEditorProps {
    mode: ViewType // "text" | "markdown" only
    value: unknown
    editable: boolean
    originalType: LogicalType
    onChange: (next: unknown) => void
}

function TextLeafEditor({mode, value, editable, originalType, onChange}: TextLeafEditorProps) {
    const initial = useMemo(() => valueToDisplay(value, mode), [value, mode])
    const [buffer, setBuffer] = useState(initial)

    const handleChange = useCallback(
        (next: string) => {
            setBuffer(next)
            onChange(coerceTextEdit(next, originalType))
        },
        [originalType, onChange],
    )

    return (
        <SharedEditor
            initialValue={buffer}
            handleChange={editable ? handleChange : undefined}
            editorType="border"
            className={clsx("min-h-[40px] overflow-hidden", mode === "markdown" && "prose-sm")}
            disableDebounce
            disabled={!editable}
            state={editable ? undefined : "readOnly"}
            placeholder="Enter value"
            editorProps={{
                showToolbar: false,
            }}
        />
    )
}

/* ── JSON / YAML code editor ────────────────────────────────────────── */

interface CodeLeafEditorProps {
    mode: "json" | "yaml"
    value: unknown
    editable: boolean
    onChange: (next: unknown) => void
}

function CodeLeafEditor({mode, value, editable, onChange}: CodeLeafEditorProps) {
    const initial = useMemo(() => valueToDisplay(value, mode), [value, mode])
    const [buffer, setBuffer] = useState(initial)

    const handleChange = useCallback(
        (next: string) => {
            setBuffer(next)
            const result = mode === "json" ? parseJsonEdit(next) : parseYamlEdit(next)
            if (result.ok) onChange(result.value)
            // Invalid → keep local buffer; don't propagate (matches V2 + the
            // existing JsonVariableEditor pattern in VariableControlAdapter).
        },
        [mode, onChange],
    )

    return (
        <SharedEditor
            initialValue={buffer}
            handleChange={editable ? handleChange : undefined}
            editorType="border"
            className="min-h-[60px] overflow-hidden"
            disableDebounce
            disabled={!editable}
            state={editable ? undefined : "readOnly"}
            placeholder={mode === "json" ? "{}" : ""}
            editorProps={{
                codeOnly: true,
                language: mode,
                showLineNumbers: true,
                showToolbar: false,
                disableLongText: true,
            }}
        />
    )
}
