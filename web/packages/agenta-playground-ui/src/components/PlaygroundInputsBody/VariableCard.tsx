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

import {useCallback, useEffect, useMemo, useState, type ReactNode} from "react"

import {
    FormView,
    ViewTypeSelect,
    buildEmptyShapeFromSchema,
    coerceTextEdit,
    inferLogicalType,
    isChatMessagesArray,
    parseJsonEdit,
    parseYamlEdit,
    valueToDisplay,
} from "@agenta/entity-ui/view-types"
import type {ExpectedType, LogicalType, ViewOption, ViewType} from "@agenta/entity-ui/view-types"
import {ChatMessageList} from "@agenta/ui/chat-message"
import type {SimpleChatMessage} from "@agenta/ui/chat-message"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {TypeChip} from "@agenta/ui/type-chip"
import type {ChipVariant} from "@agenta/ui/type-chip"
import {CopySimple, Database, Info, Warning} from "@phosphor-icons/react"
import {Alert, Button, Input, InputNumber, Switch, Tag, Tooltip, Typography, message} from "antd"
import clsx from "clsx"
import {useAtom} from "jotai"

import {variableViewModeAtomFamily} from "./viewModeAtoms"

const {TextArea} = Input

const {Text: AntText} = Typography

/** A schema-vs-value structural conflict at a single top-level key —
 *  schema expects a nested object/array, value carries a scalar. Surfaced
 *  to the user as a banner with a "Use prompt shape" affordance. */
interface ShapeConflict {
    key: string
    currentValue: unknown
    expectedShape: unknown
}

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
    /** Optional tooltip text explaining what the variable represents.
     *  Surfaced as a small Info icon next to the name — matches the legacy
     *  `VariableControlAdapter` header treatment for evaluator envelope
     *  variables (`inputs`/`outputs`). */
    helpText?: string
    /** Declared port type from the runnable schema. Used as the TypeChip
     *  fallback when the runtime value is empty (`undefined` / `null` / `""`)
     *  so a draft variable known to be an object shows the `object` chip
     *  instead of `null`. */
    expectedType?: ExpectedType
    /** Declared port schema (JSON Schema fragment with `properties` /
     *  `_pathHints`). When the variable is a draft (no value yet), Form /
     *  JSON / YAML modes seed their initial render with an empty-value
     *  skeleton built from this schema, so the user sees the expected
     *  sub-fields without having to add them manually. Render-only — the
     *  testcase value stays untouched until the user actually edits. */
    expectedSchema?: unknown
    /** When set, the card shows a small database indicator with a tooltip
     *  `Synced from {name}`. Communicates that this row's data comes from
     *  a testset rather than being authored locally. Unified across every
     *  card in the inputs body — the host either passes a name for all
     *  cards or none. */
    connectedSourceName?: string | null
    /** Active prompt template format. When a value renders in chat mode,
     *  the inner `ChatMessageList`'s editors use this to tokenize
     *  `{{...}}` segments inside message content. Defaults to `"curly"`
     *  to match the rest of the editor stack's defaults. */
    templateFormat?: "mustache" | "curly" | "fstring" | "jinja2"
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
    helpText,
    expectedType,
    expectedSchema,
    connectedSourceName,
    templateFormat = "curly",
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

    const chipVariant = useMemo<ChipVariant>(() => {
        if (isChatMessagesArray(value)) return "messages"
        // For drafts (empty value), let the declared port type drive the
        // chip so `geo` referenced as `{{geo.region}}` shows an `object`
        // chip instead of falling through to `inferLogicalType(undefined)
        // → "null"`.
        const isEmpty = value === undefined || value === null || value === ""
        if (isEmpty && expectedType) {
            if (expectedType === "object") return "json-object"
            if (expectedType === "array") return "json-array"
            if (expectedType === "boolean") return "boolean"
            if (expectedType === "number" || expectedType === "integer") return "number"
            if (expectedType === "string") return "string"
        }
        return inferLogicalType(value) as ChipVariant
    }, [value, expectedType])

    // Render-only seed + shape-conflict detection used by Form / JSON / YAML
    // modes. Three outputs:
    //
    //   1. `seedShape` — the merged shape to render. Two flavours:
    //      a. Pure seed (value still empty): the full schema-derived skeleton.
    //         Until the user actually edits a field, onChange never fires;
    //         the testcase value stays untouched.
    //      b. Merged seed (value already non-empty AND schema has
    //         additional top-level keys the value doesn't carry yet): a
    //         shallow merge of the schema-derived skeleton UNDER the user's
    //         authored value. User keys win; schema-only keys appear as
    //         empty fields the user can fill in. Handles Mahmoud's "I added
    //         `{{country.b}}` after already authoring `country.a`" case
    //         (2026-06-01) — without the merge the new sub-path stays
    //         invisible because FormView renders only what's in the value.
    //
    //   2. `shapeConflicts` — keys where the user's value is a SCALAR but
    //      the schema now expects a nested OBJECT / ARRAY. Example: prompt
    //      was `{{country.x}}` (user typed `x: "foo"`), now it's
    //      `{{country.x.y}}` (schema expects `x: {y: ""}`). My merge keeps
    //      `x: "foo"` (don't lose data) but the user can't access `y`. We
    //      surface a banner letting them adopt the new shape.
    //
    // Arrays don't get the merge — schema only tells us the container
    // shape, not the row count.
    //
    // See `buildEmptyShapeFromSchema` for the shape-derivation rules
    // (prefers `_pathHints` over `properties`).
    const {seedShape, shapeConflicts} = useMemo<{
        seedShape: unknown
        shapeConflicts: ShapeConflict[]
    }>(() => {
        if (!expectedSchema) return {seedShape: null, shapeConflicts: []}
        const skeleton = buildEmptyShapeFromSchema(expectedSchema)
        if (skeleton === null) return {seedShape: null, shapeConflicts: []}

        const isEmpty = value === undefined || value === null || value === ""
        if (isEmpty) return {seedShape: skeleton, shapeConflicts: []}

        // Only merge when both sides are plain objects. Arrays / primitives
        // fall through to the value directly.
        const isObject = value !== null && typeof value === "object" && !Array.isArray(value)
        const skelIsObject =
            skeleton !== null && typeof skeleton === "object" && !Array.isArray(skeleton)
        if (!isObject || !skelIsObject) return {seedShape: null, shapeConflicts: []}

        const valueRec = value as Record<string, unknown>
        const skelRec = skeleton as Record<string, unknown>

        let added = false
        const merged: Record<string, unknown> = {...valueRec}
        const conflicts: ShapeConflict[] = []
        for (const [k, v] of Object.entries(skelRec)) {
            if (!(k in merged)) {
                merged[k] = v
                added = true
                continue
            }
            // Key exists — check for a structural mismatch. We only flag
            // it when the schema expects nested (object/array) but the
            // user's value is a scalar; the opposite direction (schema
            // says scalar but value is object) is left alone because the
            // user's data is structurally richer than the schema knows.
            const skelIsNested = v !== null && typeof v === "object"
            const valueIsScalar = merged[k] === null || typeof merged[k] !== "object"
            if (skelIsNested && valueIsScalar) {
                conflicts.push({key: k, currentValue: merged[k], expectedShape: v})
            }
        }
        // Emit the merged shape when EITHER we added new fields OR there's
        // a conflict to surface (the banner needs a stable render target).
        // Otherwise return null so CardBody falls through to the value
        // directly.
        const shouldEmitShape = added || conflicts.length > 0
        return {
            seedShape: shouldEmitShape ? merged : null,
            shapeConflicts: conflicts,
        }
    }, [value, expectedSchema])

    // "Use prompt shape" — overwrite the user's scalar at each conflicting
    // key with the schema's expected nested skeleton, preserving every
    // other key. Loses the scalar value (e.g. "foo") because we can't pick
    // which sub-key it belongs to (e.g. `x.y` vs `x.z`) without a UI
    // prompt. Follow-up: when the new schema has a single sub-key, drop
    // the scalar into that slot automatically; when multiple, surface a
    // small picker so the user chooses.
    const handleAdoptPromptShape = useCallback(() => {
        if (shapeConflicts.length === 0) return
        const valueIsObject = value !== null && typeof value === "object" && !Array.isArray(value)
        if (!valueIsObject) return
        const valueRec = value as Record<string, unknown>
        const next: Record<string, unknown> = {...valueRec}
        for (const conflict of shapeConflicts) {
            next[conflict.key] = conflict.expectedShape
        }
        onValueChange(name, next)
    }, [shapeConflicts, value, onValueChange, name])

    // Copy the value as text. Primitives stringify naturally; structured
    // values pretty-print as JSON. Drafts (no value yet) copy as empty
    // string — defensive against undefined.
    const handleCopy = useCallback(() => {
        const text =
            value === undefined || value === null
                ? ""
                : typeof value === "string"
                  ? value
                  : typeof value === "number" || typeof value === "boolean"
                    ? String(value)
                    : JSON.stringify(value, null, 2)
        navigator.clipboard.writeText(text).then(
            () => message.success({content: "Copied", duration: 1.5}),
            () => message.error({content: "Copy failed", duration: 2}),
        )
    }, [value])

    return (
        <div className="agenta-variable-card flex flex-col gap-2 rounded-lg border border-solid border-[#d4d4d8] bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                    <AntText className="font-mono text-[12px] leading-[20px] font-medium text-[#1677FF] truncate">
                        {name}
                    </AntText>
                    <TypeChip variant={chipVariant} value={value} />
                    {helpText ? (
                        <Tooltip
                            title={helpText}
                            placement="topLeft"
                            overlayStyle={{maxWidth: 360}}
                        >
                            <Info
                                size={12}
                                className="text-gray-400 hover:text-gray-600 shrink-0 cursor-help"
                                aria-label={`About ${name}`}
                            />
                        </Tooltip>
                    ) : null}
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
                <div className="flex items-center gap-1 shrink-0">
                    {/* Unified action cluster — copy + (when connected)
                     *  testset-sync indicator. Same set on every card so
                     *  the row reads as a consistent block of inputs. */}
                    {connectedSourceName ? (
                        <Tooltip title={`Synced from ${connectedSourceName}`} placement="top">
                            <Database
                                size={14}
                                className="text-gray-400 shrink-0"
                                aria-label="Synced from testset"
                            />
                        </Tooltip>
                    ) : null}
                    <Tooltip title="Copy value" placement="top">
                        <Button
                            type="text"
                            size="small"
                            icon={<CopySimple size={14} />}
                            onClick={handleCopy}
                            aria-label={`Copy ${name}`}
                        />
                    </Tooltip>
                    <ViewTypeSelect
                        value={mode}
                        options={options}
                        onChange={handleModeChange}
                        disabled={!editable}
                    />
                </div>
            </div>
            {shapeConflicts.length > 0 && editable ? (
                <Alert
                    type="warning"
                    showIcon
                    icon={<Warning size={14} />}
                    className="!py-1.5 !px-2 !rounded-md"
                    message={
                        <span className="text-[12px]">
                            {shapeConflicts.length === 1
                                ? `The prompt now expects nested fields at `
                                : `The prompt now expects nested fields at `}
                            {shapeConflicts.map((c, i) => (
                                <span key={c.key}>
                                    {i > 0 ? ", " : ""}
                                    <code className="font-mono text-[11px] bg-[#fff7e6] px-1 rounded">
                                        {c.key}
                                    </code>
                                </span>
                            ))}
                            . Adopting the new shape will discard your current scalar value
                            {shapeConflicts.length > 1 ? "s" : ""}.
                        </span>
                    }
                    action={
                        <Button
                            size="small"
                            type="link"
                            onClick={handleAdoptPromptShape}
                            className="!px-2"
                        >
                            Use prompt shape
                        </Button>
                    }
                />
            ) : null}
            <div className="block">
                <CardBody
                    mode={mode}
                    value={value}
                    seedShape={seedShape}
                    editable={editable}
                    onChange={handleValueChange}
                    templateFormat={templateFormat}
                />
            </div>
        </div>
    )
}

/* ── Body switcher ──────────────────────────────────────────────────── */

interface CardBodyProps {
    mode: ViewType
    value: unknown
    /** Optional empty-value skeleton derived from the port schema, used as
     *  the render-only seed for Form / JSON / YAML modes when `value` is a
     *  draft (empty). The testcase stays untouched until the user actually
     *  edits a field — `onChange` only fires on real edits. */
    seedShape?: unknown
    editable: boolean
    onChange: (next: unknown) => void
    /** Active prompt template format. Forwarded to `ChatMessageList` when
     *  the value renders in chat mode so its inner editors tokenize the
     *  right `{{...}}` syntax. */
    templateFormat?: "mustache" | "curly" | "fstring" | "jinja2"
}

function CardBody({
    mode,
    value,
    seedShape,
    editable,
    onChange,
    templateFormat = "curly",
}: CardBodyProps): ReactNode {
    const originalType = useMemo<LogicalType>(() => inferLogicalType(value), [value])

    // For structured modes (form / json / yaml), use the schema-derived
    // seed whenever it's available:
    //   - value empty   → seed is the pure skeleton
    //   - value object  → seed is value ⊕ schema-only keys (merged in
    //                       VariableCard above)
    // Either way, `seedShape != null` means "use the seed". Other modes
    // (text / markdown / chat) get the raw value — seeding wouldn't help.
    const renderValue = seedShape != null ? seedShape : value

    if (mode === "form") {
        // FormView expects an object record. If the value is an array, wrap
        // its indexed children into a record { "0": ..., "1": ... } so the
        // form can render. FormView itself recurses into arrays as well,
        // but its root signature is `Record<string, unknown>`.
        const obj =
            renderValue !== null && typeof renderValue === "object" && !Array.isArray(renderValue)
                ? (renderValue as Record<string, unknown>)
                : Array.isArray(renderValue)
                  ? Object.fromEntries(renderValue.map((v, i) => [String(i), v]))
                  : {}
        return (
            <FormView
                value={obj}
                editable={editable}
                onChange={(next) => {
                    if (Array.isArray(renderValue)) {
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
        // Match the prop set used by `MessagesField` (drill-in drawer) which
        // is the canonical working configuration for editing chat-shaped
        // arrays. Without `enableTokens` / `templateFormat` the message
        // editors mount their plugin stack in a constrained state and the
        // content reads as static text. `allowFileUpload={false}` matches
        // the variable-input UX — files belong in their own column, not
        // inline in a testcase value.
        return (
            <ChatMessageList
                messages={messages}
                onChange={(next) => onChange(next)}
                disabled={!editable}
                enableTokens
                templateFormat={templateFormat}
                allowFileUpload={false}
            />
        )
    }

    if (mode === "json" || mode === "yaml") {
        return (
            <CodeLeafEditor
                key={`${mode}-${originalType}`}
                mode={mode}
                value={renderValue}
                editable={editable}
                onChange={onChange}
            />
        )
    }

    // text / markdown for primitives — use the right widget per actual type.
    // Borderless: the variable card itself supplies the encapsulating border,
    // so the inner widget should NOT carry its own — otherwise the input
    // visually "floats" inside the card and reads as a separate element.
    if (originalType === "number" && mode === "text") {
        return (
            <InputNumber
                size="middle"
                variant="borderless"
                value={value as number}
                disabled={!editable}
                onChange={(next) => onChange(next ?? null)}
                placeholder="Enter number"
                className="w-full max-w-[320px] !px-0"
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

    // Resync the local buffer when `value` changes externally — e.g. testcase
    // refetch from the store, a row update from another surface, or a
    // discard/revert that resets the cell. Without this the visible text
    // goes stale while the underlying state has already moved on.
    useEffect(() => {
        setBuffer(initial)
    }, [initial])

    const handleChange = useCallback(
        (next: string) => {
            setBuffer(next)
            onChange(coerceTextEdit(next, originalType))
        },
        [originalType, onChange],
    )

    // Plain TextArea with the borderless variant — no hover ring, no focus
    // border, no padding, no shadow. The variable card supplies the only
    // visible boundary; this editor melts into it so the label, controls,
    // and value read as one block.
    return (
        <TextArea
            variant="borderless"
            value={buffer}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Enter a value"
            autoSize={{minRows: 2}}
            disabled={!editable}
            className={clsx(
                "!p-0 !shadow-none !min-h-[40px] resize-none",
                mode === "markdown" && "prose-sm",
            )}
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

    // Resync the local buffer when `value` changes externally — same
    // reasoning as TextLeafEditor above. Mode switches (json ↔ yaml) also
    // change `initial`, so this covers the user toggling view modes too.
    useEffect(() => {
        setBuffer(initial)
    }, [initial])

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

    // SharedEditor is needed here for code-only mode (line numbers + syntax
    // highlighting). It's borderless, with `state="filled"` to suppress the
    // built-in hover border, and explicit `!border-transparent` overrides to
    // beat the `isEditorFocused && "!border-[#BDC7D1]"` rule baked into
    // SharedEditorImpl. Result: NO inner border in any state — the variable
    // card supplies the only boundary.
    return (
        <SharedEditor
            initialValue={buffer}
            handleChange={editable ? handleChange : undefined}
            editorType="borderless"
            className="min-h-[60px] overflow-hidden !p-0 !border-transparent hover:!border-transparent focus:!border-transparent focus-within:!border-transparent [&.agenta-shared-editor]:!border-transparent"
            disableDebounce
            disabled={!editable}
            state={editable ? "filled" : "readOnly"}
            placeholder={mode === "json" ? "{}" : "Enter YAML"}
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
