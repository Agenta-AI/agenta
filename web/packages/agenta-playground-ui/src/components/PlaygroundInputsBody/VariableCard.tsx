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
import {CaretDown, CaretRight, CopySimple, Database, Info, Warning} from "@phosphor-icons/react"
import {Alert, Button, Input, InputNumber, Switch, Tag, Tooltip, Typography, message} from "antd"
import clsx from "clsx"
import {useAtom} from "jotai"

import {variableViewModeAtomFamily} from "./viewModeAtoms"

const {TextArea} = Input

const {Text: AntText} = Typography

/** A schema-vs-value structural conflict at a single key (possibly nested
 *  — `key` is a dotted path, e.g. `"obj.a"`). Schema expects a nested
 *  object/array, value carries a scalar. Surfaced to the user as a banner
 *  with a "Use prompt shape" affordance. */
interface ShapeConflict {
    key: string
    currentValue: unknown
    expectedShape: unknown
}

/** A nested key that exists in the value but not in the schema — captured
 *  at the depth where it was first dropped from the rendered shape. `path`
 *  is dotted relative to the variable root (e.g. `"a.y"` for the variable
 *  `obj`'s stashed key `obj.a.y`); `value` is the entire sub-tree the key
 *  carried, which can itself be a primitive or a deeply nested object. */
interface StashedPath {
    path: string
    value: unknown
}

/** Walks `skel` (schema-derived empty shape) and `val` (current value) in
 *  parallel, building a render shape that contains ONLY the keys the schema
 *  declares — at every depth. Keys present in `val` but absent from `skel`
 *  are dropped from the rendered output and collected into `stashed`; the
 *  caller's write-back path (`mergeEditWithStash` below) restores them when
 *  persisting edits.
 *
 *  This is the recursive counterpart to the previous top-level-only logic.
 *  Without recursion, a rename like `{{obj.a.y}}` → `{{obj.a.t}}` would still
 *  show `y` in the form because the top-level loop copied `valueRec.obj`
 *  verbatim without descending into `obj.a`. */
function buildSchemaStrictShape(
    skel: unknown,
    val: unknown,
    pathPrefix: string,
): {merged: unknown; conflicts: ShapeConflict[]; stashed: StashedPath[]} {
    const skelIsObject = skel !== null && typeof skel === "object" && !Array.isArray(skel)
    const valIsObject = val !== null && typeof val === "object" && !Array.isArray(val)
    if (!skelIsObject || !valIsObject) return {merged: val, conflicts: [], stashed: []}

    const skelRec = skel as Record<string, unknown>
    const valRec = val as Record<string, unknown>
    const merged: Record<string, unknown> = {}
    const conflicts: ShapeConflict[] = []
    const stashed: StashedPath[] = []

    for (const [k, skelV] of Object.entries(skelRec)) {
        const path = pathPrefix ? `${pathPrefix}.${k}` : k
        if (k in valRec) {
            const valV = valRec[k]
            const skelVIsNested =
                skelV !== null && typeof skelV === "object" && !Array.isArray(skelV)
            const valVIsScalar = valV === null || typeof valV !== "object"
            if (skelVIsNested && valVIsScalar) {
                conflicts.push({key: path, currentValue: valV, expectedShape: skelV})
                merged[k] = valV
            } else if (skelVIsNested) {
                const sub = buildSchemaStrictShape(skelV, valV, path)
                merged[k] = sub.merged
                conflicts.push(...sub.conflicts)
                stashed.push(...sub.stashed)
            } else {
                merged[k] = valV
            }
        } else {
            merged[k] = skelV
        }
    }

    // Value-only keys at THIS level — captured AFTER the schema walk so
    // stash entries from deeper levels (descended via recursion) come
    // first in the list. Display order: deepest first, then shallow,
    // which keeps the footer's `obj.a.y` entries grouped together when
    // multiple branches are affected.
    for (const [k, v] of Object.entries(valRec)) {
        if (!(k in skelRec)) {
            stashed.push({path: pathPrefix ? `${pathPrefix}.${k}` : k, value: v})
        }
    }

    return {merged, conflicts, stashed}
}

/** Walks `edit` (the FormView / JSON-editor output) and `original` (the
 *  testcase's current value) in parallel against `skel`. At every depth:
 *  - Keys in `original` that aren't in `skel` (the "stash") are preserved.
 *  - Keys in `skel` are taken from `edit` (recursing if nested).
 *
 *  This is the inverse of `buildSchemaStrictShape`: the user only sees /
 *  edits schema keys, but the underlying value keeps the stash so that
 *  re-adding `{{obj.a.y}}` to the prompt later restores `y`'s value
 *  without data loss. Mirrors the existing top-level "removed variable's
 *  column persists" behaviour, scoped to every depth. */
function mergeEditWithStash(edit: unknown, original: unknown, skel: unknown): unknown {
    const skelIsObject = skel !== null && typeof skel === "object" && !Array.isArray(skel)
    if (!skelIsObject) return edit
    const editIsObject = edit !== null && typeof edit === "object" && !Array.isArray(edit)
    if (!editIsObject) return edit

    const originalIsObject =
        original !== null && typeof original === "object" && !Array.isArray(original)
    const skelRec = skel as Record<string, unknown>
    const editRec = edit as Record<string, unknown>
    const originalRec = originalIsObject ? (original as Record<string, unknown>) : {}

    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(originalRec)) {
        if (!(k in skelRec)) result[k] = v
    }
    for (const [k, skelV] of Object.entries(skelRec)) {
        if (k in editRec) {
            result[k] = mergeEditWithStash(editRec[k], originalRec[k], skelV)
        }
    }
    return result
}

/** Set a value at a dotted path, returning a new object. Used by the
 *  "Use prompt shape" affordance for conflicts at nested paths (e.g.
 *  `obj.a` when `{{obj.a.t}}` is added while `obj.a` was a scalar). */
function setAtPath(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
): Record<string, unknown> {
    const dot = path.indexOf(".")
    if (dot === -1) return {...obj, [path]: value}
    const head = path.slice(0, dot)
    const tail = path.slice(dot + 1)
    const child = obj[head]
    const childRec =
        child !== null && typeof child === "object" && !Array.isArray(child)
            ? (child as Record<string, unknown>)
            : {}
    return {...obj, [head]: setAtPath(childRec, tail, value)}
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
    // modes. Two outputs:
    //
    //   1. `seedShape` — the merged shape to render. SCHEMA-STRICT at
    //      every depth: iterates over the SCHEMA's keys (not the value's),
    //      recursing into nested objects. Keys the value has but the
    //      schema no longer declares are EXCLUDED from the render, matching
    //      how removed top-level variables disappear from the main panel.
    //      Existing key values are preserved when present; schema-only keys
    //      appear as empty fields.
    //
    //      Examples (top-level):
    //        - Empty value, schema {a, c}: seedShape = {a: "", c: ""}.
    //        - Value {a, b, c}, schema {a, c} (b removed from prompt):
    //          seedShape = {a, c} — b dropped from render, kept in the
    //          underlying value (see `handleValueChange` below).
    //        - Value {a}, schema {a, b}: seedShape = {a, b: ""} —
    //          missing b added so the user can fill it (Mahmoud's case).
    //
    //      Examples (nested — Arda screenshot 2026-06-01):
    //        - Value {obj: {a: {y}}}, schema {obj: {a: {t}}}: seedShape =
    //          {obj: {a: {t: ""}}} — `y` dropped from render, kept in the
    //          underlying value. Top-level-only logic missed this case
    //          because it copied `valueRec.obj` verbatim.
    //
    //   2. `shapeConflicts` — paths where the user's value is a SCALAR
    //      but the schema now expects a nested OBJECT / ARRAY. Example:
    //      prompt was `{{country.x}}` (user typed `x: "foo"`), now it's
    //      `{{country.x.y}}` (schema expects `x: {y: ""}`). Merge keeps
    //      `x: "foo"` (don't lose data) but the user can't access `y`.
    //      Surfaced as a banner with "Use prompt shape" affordance. Paths
    //      are dotted (e.g. `"obj.a"`) for nested conflicts.
    //
    // Arrays don't get the merge — schema only tells us the container
    // shape, not the row count.
    //
    // The unreferenced-key stash is NOT tracked separately anymore — it's
    // recovered inline by `mergeEditWithStash` (used in handleValueChange
    // below), which walks the original value alongside the edit and
    // restores any value-only keys at every depth.
    //
    // See `buildEmptyShapeFromSchema` for the shape-derivation rules
    // (prefers `_pathHints` over `properties`), and `buildSchemaStrictShape`
    // above for the recursion logic.
    const {seedShape, shapeConflicts, stashedPaths} = useMemo<{
        seedShape: unknown
        shapeConflicts: ShapeConflict[]
        stashedPaths: StashedPath[]
    }>(() => {
        if (!expectedSchema) return {seedShape: null, shapeConflicts: [], stashedPaths: []}
        const skeleton = buildEmptyShapeFromSchema(expectedSchema)
        if (skeleton === null) return {seedShape: null, shapeConflicts: [], stashedPaths: []}

        const isEmpty = value === undefined || value === null || value === ""
        if (isEmpty) return {seedShape: skeleton, shapeConflicts: [], stashedPaths: []}

        // Only merge when both sides are plain objects. Arrays / primitives
        // fall through to the value directly.
        const isObject = value !== null && typeof value === "object" && !Array.isArray(value)
        const skelIsObject =
            skeleton !== null && typeof skeleton === "object" && !Array.isArray(skeleton)
        if (!isObject || !skelIsObject)
            return {seedShape: null, shapeConflicts: [], stashedPaths: []}

        const {merged, conflicts, stashed} = buildSchemaStrictShape(skeleton, value, "")
        return {seedShape: merged, shapeConflicts: conflicts, stashedPaths: stashed}
    }, [value, expectedSchema])

    // Skeleton kept in scope so `handleValueChange` can run the same deep
    // merge against it without re-derivation per write.
    const skeletonRef = useMemo<unknown>(
        () => (expectedSchema ? buildEmptyShapeFromSchema(expectedSchema) : null),
        [expectedSchema],
    )

    // "Use prompt shape" — overwrite the user's scalar at each conflicting
    // path (dotted, e.g. `obj.a`) with the schema's expected nested
    // skeleton, preserving every other key. Loses the scalar value
    // (e.g. "foo") because we can't pick which sub-key it belongs to
    // (e.g. `x.y` vs `x.z`) without a UI prompt. Follow-up: when the new
    // schema has a single sub-key, drop the scalar into that slot
    // automatically; when multiple, surface a small picker so the user
    // chooses.
    const handleAdoptPromptShape = useCallback(() => {
        if (shapeConflicts.length === 0) return
        const valueIsObject = value !== null && typeof value === "object" && !Array.isArray(value)
        if (!valueIsObject) return
        let next = value as Record<string, unknown>
        for (const conflict of shapeConflicts) {
            next = setAtPath(next, conflict.key, conflict.expectedShape)
        }
        onValueChange(name, next)
    }, [shapeConflicts, value, onValueChange, name])

    // Write changes back to the testcase. Walks the original value
    // alongside the edit against the schema skeleton, preserving any
    // value-only keys (the "stash") at every depth — the form only shows
    // what the schema declares, but the testcase value KEEPS the dropped
    // keys so re-adding `{{obj.<path>}}` to the prompt restores them
    // without data loss. Mirrors the top-level "removed variable's
    // testcase column persists" behaviour, scoped to every depth.
    const handleValueChange = useCallback(
        (next: unknown) => {
            if (skeletonRef === null) {
                onValueChange(name, next)
                return
            }
            const restored = mergeEditWithStash(next, value, skeletonRef)
            onValueChange(name, restored)
        },
        [onValueChange, name, value, skeletonRef],
    )

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
        <div className="agenta-variable-card flex flex-col gap-2 rounded-lg border border-solid border-[var(--ag-colorBorder)] bg-[var(--ag-colorBgContainer)] px-3 py-2 min-w-0">
            <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                    <AntText className="font-mono text-[12px] leading-[20px] font-medium text-[var(--ag-c-1677FF)] truncate">
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
                        // Custom flex layout — antd's `action` prop renders
                        // alongside `message` but doesn't reflow cleanly when
                        // the text wraps. We render text + button inside the
                        // message slot with a flex container so the button
                        // either sits inline (short text) or wraps to the
                        // next line (long text) without overlapping.
                        //
                        // Code chip uses a contrasting white bg with a thin
                        // amber border — the previous `bg-[#fff7e6]` was the
                        // SAME color as the warning Alert background, making
                        // the chip invisible (Arda screenshot 2026-06-01).
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                            <span className="text-[12px]">
                                The prompt now expects nested fields at{" "}
                                {shapeConflicts.map((c, i) => (
                                    <span key={c.key}>
                                        {i > 0 ? ", " : ""}
                                        <code className="font-mono text-[11px] bg-[var(--ag-colorBgContainer)] border border-solid border-[var(--ag-colorWarning)] text-[var(--ag-colorTextHeading)] px-1 rounded">
                                            {c.key}
                                        </code>
                                    </span>
                                ))}
                                . Adopting the new shape will discard your current scalar value
                                {shapeConflicts.length > 1 ? "s" : ""}.
                            </span>
                            <Button
                                size="small"
                                onClick={handleAdoptPromptShape}
                                className="shrink-0"
                            >
                                Use prompt shape
                            </Button>
                        </div>
                    }
                />
            ) : null}
            <div className="block">
                <CardBody
                    mode={mode}
                    value={value}
                    seedShape={seedShape}
                    expectedSchema={expectedSchema}
                    editable={editable}
                    onChange={handleValueChange}
                    templateFormat={templateFormat}
                />
            </div>
            {/* Stashed (value-only) nested keys footer. Mirrors the
             *  top-level `UnreferencedColumnsFooter` pattern inside the
             *  card: collapsed by default, click to reveal which sub-paths
             *  the prompt no longer references. The `key` prop re-mounts
             *  the footer when the path set changes, so a new stashed
             *  entry doesn't quietly appear inside an already-expanded
             *  disclosure (same anti-leak as top-level). */}
            <StashedPathsFooter
                key={stashedPaths.map((p) => p.path).join("|")}
                variableName={name}
                paths={stashedPaths}
            />
        </div>
    )
}

/* ── Stashed-paths disclosure ───────────────────────────────────────── */

interface StashedPathsFooterProps {
    variableName: string
    paths: StashedPath[]
}

/** Collapsed-by-default footer listing nested keys that exist on the
 *  testcase value but aren't referenced by the prompt anymore. Mirrors
 *  the top-level `UnreferencedColumnsFooter` but scoped to ONE variable's
 *  internal stash — paths are dotted (relative to the variable root) and
 *  the values are inert references (read-only, no edit). Re-adding
 *  `{{variableName.path}}` to the prompt promotes the stashed value back
 *  into the rendered form with its data intact. */
function StashedPathsFooter({variableName, paths}: StashedPathsFooterProps) {
    const [expanded, setExpanded] = useState(false)
    if (paths.length === 0) return null

    const noun = `nested key${paths.length === 1 ? "" : "s"}`
    const summary = expanded
        ? `${paths.length} unused ${noun} (not referenced by the prompt)`
        : `${paths.length} unused ${noun} hidden because the prompt does not reference them.`

    return (
        <div className="agenta-stashed-paths mt-1 flex flex-col gap-1">
            <Button
                type="text"
                size="small"
                icon={expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                onClick={() => setExpanded((prev) => !prev)}
                aria-expanded={expanded}
                className="self-start !px-1 text-[12px] !text-[var(--ag-rgba-051729-55)]"
            >
                {summary}
            </Button>
            {expanded ? (
                <div className="flex flex-col gap-1 pl-2 border-l-2 border-solid border-[var(--ag-colorBorderSecondary)]">
                    {paths.map((p) => (
                        <div key={p.path} className="flex items-baseline gap-2 text-[12px] py-0.5">
                            <code className="font-mono text-[11px] text-[var(--ag-c-1677FF)] shrink-0">
                                {variableName}.{p.path}
                            </code>
                            <span className="text-[var(--ag-rgba-051729-55)] truncate font-mono text-[11px]">
                                {previewValue(p.value)}
                            </span>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    )
}

/** Render-only preview of a stashed value. Primitives stringify; objects
 *  show as compact JSON, truncated so long blobs don't blow out the row. */
function previewValue(value: unknown): string {
    if (value === undefined) return "undefined"
    if (value === null) return "null"
    if (typeof value === "string") return value || '""'
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    const json = JSON.stringify(value)
    return json.length > 80 ? `${json.slice(0, 77)}…` : json
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
    /** Declared port schema fragment. Used by the form view to derive an
     *  empty-row template for array-of-objects ports (the items shape) so
     *  the user can `+ Add row` to extend the array. */
    expectedSchema?: unknown
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
    expectedSchema,
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
        // FormView accepts arrays at root now (Phase 2d of the mustache
        // section RFC) — array-of-objects ports render as a stack of row
        // editors with `+ Add row`. Pass arrays through as arrays; only
        // wrap non-array primitives into an empty `{}` so FormView always
        // sees a valid object / array root.
        const expectsArray = (expectedSchema as {type?: string} | null)?.type === "array"
        const isEmptyObject =
            renderValue !== null &&
            typeof renderValue === "object" &&
            !Array.isArray(renderValue) &&
            Object.keys(renderValue as object).length === 0

        const formValue: Record<string, unknown> | unknown[] = Array.isArray(renderValue)
            ? (renderValue as unknown[])
            : // Migration coercion: an empty `{}` on a port that's now
              // declared as array (e.g. a section opener with sub-paths
              // after Phase 2c retyped `repos` from object to array)
              // would otherwise render as ObjectRows with `(empty object)`
              // — confusing for an array-of-objects port. Coerce empty
              // objects to empty arrays so the form-array editor shows.
              // Non-empty objects pass through to preserve user data on
              // ports that legitimately hold object values.
              expectsArray && isEmptyObject
              ? []
              : renderValue !== null &&
                  typeof renderValue === "object" &&
                  !Array.isArray(renderValue)
                ? (renderValue as Record<string, unknown>)
                : {}

        // Pass the FULL schema down; FormView threads it through every
        // nested field and each array node derives its own `+ Add row`
        // template from its LOCAL `items` schema. This is what makes
        // nested array-of-objects (e.g. `repos[i].contributors` for the
        // `{{#repos}}{{#contributors}}…` case) use the inner items shape
        // (`{name: ""}`) instead of incorrectly inheriting the outer row
        // shape (`{name, stars, description, contributors}`).
        return (
            <FormView
                value={formValue}
                editable={editable}
                onChange={onChange}
                schema={expectedSchema}
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
