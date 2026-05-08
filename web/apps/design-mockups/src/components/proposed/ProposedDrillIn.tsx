/**
 * ProposedDrillIn — what the production drill-in could look like with the
 * gap-01 / gap-03 / gap-05 proposals applied:
 *   - gap-01: type chip on every field row (alongside the item count + view-mode dropdown)
 *   - gap-03: auto-expand top-level objects/arrays inline as nested cards
 *   - gap-05: dotted-key chip + collision warning when a literal `"a.b"` key
 *             coexists with nested `a.b` traversal
 *
 * This is a fresh implementation, not a fork of DrillInContent. It mirrors
 * the visual shape of DrillInFieldHeader (caret, name, count, view-mode
 * Select, action buttons) and adds the chip + auto-expand. Used side-by-side
 * with the production drill-in on each gap page so the team can compare.
 */

import {Fragment, useCallback, useEffect, useId, useMemo, useState} from "react"

import type {ChipVariant} from "@/mockups/components/proposed/TypeChip"
import {TypeChip} from "@/mockups/components/proposed/TypeChip"
import {ChipConversionPopover} from "@/mockups/components/proposed/ChipConversionPopover"
import {
    ArrowsInLineVertical,
    ArrowsOutLineVertical,
    CaretDown,
    CaretRight,
    Copy,
    Funnel,
    Info,
    Warning,
} from "@phosphor-icons/react"
import {Button, Input, InputNumber, Select, Switch, Tooltip} from "antd"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {MarkdownToggleButton} from "@agenta/ui"
import yaml from "js-yaml"

/**
 * Chip rendering mode — added 2026-05-04 from team feedback. The default
 * `all` shows the chip on every field row (gap-01 Variant A). `ambiguous-only`
 * hides chips for primitives where the rendered widget already disambiguates
 * the type (Switch = boolean, InputNumber = number) — gap-01 Variant C.
 * `none` removes chips entirely and signals types via *value styling*
 * (monospace + colour for numbers/booleans/null, italic for stringified-JSON,
 * regular weight for strings). The styled-values variant matches the spirit
 * of "no chrome, just rendering" — useful for power users who don't need a
 * vocabulary they already know.
 */
export type ChipRenderMode = "all" | "ambiguous-only" | "none"

interface ProposedDrillInProps {
    data: Record<string, unknown>
    rootTitle?: string
    /** Detect literal-dotted-key collisions and surface chips */
    detectDotKeyCollisions?: boolean
    /** Auto-expand top-level objects/arrays as nested cards (gap-03 proposal) */
    autoExpand?: boolean
    /**
     * When true (default), primitive leaf values render as editable widgets
     * (`<Input>` for strings, `<InputNumber>` for numbers, `<Switch>` for
     * booleans) — matching production. When false, all leaves render as
     * read-only text. Use the page-level toggle to compare both modes.
     */
    editable?: boolean
    /** Chip rendering mode. Default `all`. */
    chipMode?: ChipRenderMode
    /**
     * Union of keys known to exist across all rows in the testset (gap-04).
     * When provided, keys present in `knownColumns` but absent from `data`
     * render as ghost rows with the `[not authored]` chip — making the
     * union-projection visible without polluting storage. The matching
     * save-side filter belongs in the parent (drop empties before dispatch).
     */
    knownColumns?: string[]
    /**
     * When provided, the root view-mode is controlled by the parent.
     * Vocabulary matches per-field controls (`form` / `json` / `yaml`) so
     * top-level and nested view-mode dropdowns share a single language.
     * Pair with `hideRootViewMode` to drop the body-level dropdown and let
     * the parent own the control.
     */
    rootViewMode?: "form" | "json" | "yaml"
    onRootViewModeChange?: (mode: "form" | "json" | "yaml") => void
    /**
     * Hide the body-level view-mode dropdown next to the root title. Set
     * when the parent owns the view-mode toggle (drawer chrome, page header).
     */
    hideRootViewMode?: boolean
}

function setAtPath(root: unknown, path: (string | number)[], next: unknown): unknown {
    if (path.length === 0) return next
    const [head, ...tail] = path
    if (Array.isArray(root)) {
        const idx = typeof head === "number" ? head : Number(head)
        const copy = [...root]
        copy[idx] = setAtPath(copy[idx], tail, next)
        return copy
    }
    const obj = (root && typeof root === "object" ? root : {}) as Record<string, unknown>
    return {...obj, [head as string]: setAtPath(obj[head as string], tail, next)}
}

/**
 * Minimal YAML serializer for the view-mode toggle. Doesn't aim to be
 * spec-correct — just produces readable indented output for the demo. Real
 * implementation would use `yaml` package.
 */
function toYaml(value: unknown, indent = 0): string {
    const pad = "  ".repeat(indent)
    if (value === null) return `${pad}null`
    if (typeof value === "string") {
        // Quote strings that contain special chars to keep parseability hint
        return /[:#\n]/.test(value) ? `${pad}"${value.replace(/"/g, '\\"')}"` : `${pad}${value}`
    }
    if (typeof value === "number" || typeof value === "boolean") return `${pad}${String(value)}`
    if (Array.isArray(value)) {
        if (value.length === 0) return `${pad}[]`
        return value
            .map((item) => {
                if (item !== null && typeof item === "object") {
                    const inner = toYaml(item, indent + 1)
                    // Lift first line under the dash
                    const [first, ...rest] = inner.split("\n")
                    return `${pad}- ${first.trimStart()}${rest.length ? "\n" + rest.join("\n") : ""}`
                }
                return `${pad}- ${toYaml(item, 0).trimStart()}`
            })
            .join("\n")
    }
    if (typeof value === "object") {
        const obj = value as Record<string, unknown>
        const entries = Object.entries(obj)
        if (entries.length === 0) return `${pad}{}`
        return entries
            .map(([k, v]) => {
                if (v !== null && typeof v === "object" && !(Array.isArray(v) && v.length === 0)) {
                    return `${pad}${k}:\n${toYaml(v, indent + 1)}`
                }
                return `${pad}${k}: ${toYaml(v, 0).trimStart()}`
            })
            .join("\n")
    }
    return `${pad}${String(value)}`
}

type FieldKind =
    | {kind: "string"; value: string}
    | {kind: "stringified"; value: string; parsed: unknown; parsedKind: "object" | "array"}
    | {kind: "number"; value: number}
    | {kind: "boolean"; value: boolean}
    | {kind: "null"}
    | {kind: "object"; value: Record<string, unknown>; count: number}
    | {kind: "array"; value: unknown[]; count: number}
    | {kind: "messages"; value: unknown[]; count: number}

function tryParseJsonObject(s: string): {parsed: unknown; kind: "object" | "array"} | null {
    if (!s || (s[0] !== "{" && s[0] !== "[")) return null
    try {
        const parsed = JSON.parse(s)
        if (Array.isArray(parsed)) return {parsed, kind: "array"}
        if (parsed && typeof parsed === "object") return {parsed, kind: "object"}
        return null
    } catch {
        return null
    }
}

function classify(value: unknown): FieldKind {
    if (value === null) return {kind: "null"}
    if (Array.isArray(value)) {
        const isMessages =
            value.length > 0 &&
            value.every(
                (item) =>
                    item != null &&
                    typeof item === "object" &&
                    "role" in (item as object) &&
                    ("content" in (item as object) || "tool_calls" in (item as object)),
            )
        if (isMessages) return {kind: "messages", value, count: value.length}
        return {kind: "array", value, count: value.length}
    }
    if (typeof value === "object") {
        const obj = value as Record<string, unknown>
        return {kind: "object", value: obj, count: Object.keys(obj).length}
    }
    if (typeof value === "string") {
        // Detect stringified JSON — the gap-02 / gap-04 fault line. We surface
        // it as a distinct kind so the chip ([stringified], italic dashed-blue)
        // and the body (parse-affordance + structured preview) can both
        // signal "this is technically a string but it's parseable JSON".
        const parsed = tryParseJsonObject(value)
        if (parsed) {
            return {kind: "stringified", value, parsed: parsed.parsed, parsedKind: parsed.kind}
        }
        return {kind: "string", value}
    }
    if (typeof value === "number") return {kind: "number", value}
    if (typeof value === "boolean") return {kind: "boolean", value}
    return {kind: "string", value: String(value)}
}

/**
 * Type primitive for a field — what the value IS (one of JSON's primitive
 * types). Render hints (`messages`, `stringified`, `markdown`) are
 * orthogonal and emitted separately via `renderHintFor`. Chip refactor
 * 2026-05-05 per JP feedback.
 */
function variantFor(kind: FieldKind["kind"]): ChipVariant {
    switch (kind) {
        case "object":
            return "json-object"
        case "array":
            return "json-array"
        case "messages":
            // Type primitive is `json-array`; the [messages] render hint
            // stacks alongside via renderHintFor below.
            return "json-array"
        case "null":
            return "null"
        case "string":
            return "string"
        case "stringified":
            // Type primitive is `string`; the [stringified] render hint
            // stacks alongside via renderHintFor below.
            return "string"
        case "number":
            return "number"
        case "boolean":
            return "boolean"
    }
}

/**
 * StringField picks its editor by per-field `mode` preference, NOT by
 * content length at edit-time. `mode === "short"` → antd `<Input>`
 * (single-line). `mode === "long"` → production Lexical `SharedEditor` with
 * markdown preview toggle. After mount, mode only changes via the chip
 * popover ("Switch to long-form editor"); typing doesn't auto-flip it
 * (which would surprise the user and break focus).
 *
 * Length is used ONCE at mount-time as a hydration heuristic — if the
 * incoming value is already long-form, default to "long" because the user
 * is most likely dealing with markdown / multi-paragraph text. See the
 * lazy useState initializer below.
 */
function isLongFormString(value: string): boolean {
    return value.length > 100 || value.includes("\n")
}

function StringField({
    editorId,
    value,
    editable,
    onChange,
    mode,
    autoFocus,
}: {
    editorId: string
    value: string
    editable: boolean
    onChange: (next: string) => void
    /** Per-field editor mode. "short" = antd <Input>, "long" = Lexical SharedEditor. */
    mode: "short" | "long"
    /** When true and mode is "long", the Lexical editor mounts focused. */
    autoFocus?: boolean
}) {
    if (mode === "short") {
        return editable ? (
            <Input value={value} onChange={(e) => onChange(e.target.value)} />
        ) : (
            <span style={leafText}>{value}</span>
        )
    }
    // Long-form / markdown — use the production Lexical editor. The
    // EditorProvider boots Lexical with markdown plugins; SharedEditor
    // renders the editor surface; MarkdownToggleButton (production
    // component) reads/writes the markdownViewAtom keyed by editorId, which
    // SharedEditor responds to. Same id between toggle + editor = they share
    // the atom so the visible button drives the rendered view.
    // The [markdown] chip on the field header already labels the mode, so
    // we don't need a second "Markdown" label inside a toolbar. The render
    // toggle (M↓: rendered preview ↔ raw text) lives as an absolutely
    // positioned button at the editor's top-right corner — keeps the
    // Lexical context for MarkdownToggleButton without adding a horizontal
    // bar that reads as a collapsible section header.
    return (
        <EditorProvider
            key={`${editorId}-text-provider`}
            id={editorId}
            initialValue={value}
            showToolbar={false}
            enableTokens={false}
        >
            <div style={longFormSurfaceStyle}>
                <SharedEditor
                    id={editorId}
                    initialValue={value}
                    editorType="border"
                    className="overflow-visible"
                    disableDebounce
                    noProvider
                    disabled={!editable}
                    state={editable ? undefined : "readOnly"}
                    handleChange={editable ? onChange : undefined}
                    autoFocus={autoFocus}
                />
                <div style={longFormToggleStyle}>
                    <MarkdownToggleButton id={editorId} />
                </div>
            </div>
        </EditorProvider>
    )
}

/**
 * Chips that represent correctness warnings, not value vocabulary. Multiple
 * of these on the same row collapse into a single Warning-icon button (see
 * FieldWarningsIndicator) so the row stays readable. The popover/tooltip is
 * where the user actually reads what's wrong and decides what to do.
 */
const WARNING_CHIPS: ReadonlySet<ChipVariant> = new Set<ChipVariant>([
    "dotted-key",
    "collision",
    "shadowed",
    "mixed",
])

/**
 * Depth-aware header background. Each nesting level shifts the header
 * tint slightly so depth reads at a glance even when you're scanning
 * the structure quickly. Capped at depth 3 so very deep nesting doesn't
 * keep darkening into illegibility.
 */
const DEPTH_HEADER_BG = ["#FAFAFA", "#F2F4F7", "#E9ECF1", "#E2E6ED"]
function depthHeaderBg(depth: number): string {
    return DEPTH_HEADER_BG[Math.min(depth, DEPTH_HEADER_BG.length - 1)]
}

function describeWarning(chip: ChipVariant, fieldName: string): string {
    switch (chip) {
        case "dotted-key":
            return `"${fieldName}" is a literal key containing a dot. Templates resolve literal keys before nested paths, so {{${fieldName}}} reaches THIS value, not a nested traversal.`
        case "collision":
            return `Another field on this row collides with "${fieldName}" — a literal "a.b" key and a nested "a.b" path coexist. The literal-key wins at template resolution time, but the nested form is silently shadowed.`
        case "shadowed":
            return `"${fieldName}" is shadowed by a sibling literal-dot key. The nested path won't be reachable via templates as long as the literal key exists.`
        case "mixed":
            return `"${fieldName}" mixes types across rows in this column. Pick one and lock it via the schema, or accept that the column is intentionally heterogeneous.`
        default:
            return ""
    }
}

/**
 * Single Warning-icon button + Tooltip aggregating every warning chip on a
 * field row. Renders nothing when the row has no warning-class chips. The
 * tooltip lists each warning with its specific message — one per bullet so
 * users can read them independently. Click target is the icon; hover also
 * surfaces the tooltip via antd's default Tooltip behavior.
 */
function FieldWarningsIndicator({
    chips,
    fieldName,
}: {
    chips: ChipVariant[]
    fieldName: string
}) {
    const warnings = chips.filter((c) => WARNING_CHIPS.has(c))
    if (warnings.length === 0) return null
    const messages = warnings.map((chip) => ({chip, message: describeWarning(chip, fieldName)}))
    return (
        <Tooltip
            title={
                <div style={{display: "flex", flexDirection: "column", gap: 6}}>
                    {messages.map(({chip, message}) => (
                        <div key={chip} style={{lineHeight: 1.4}}>
                            <strong style={{textTransform: "capitalize"}}>
                                {chip.replace("-", " ")}
                            </strong>
                            <span> — {message}</span>
                        </div>
                    ))}
                </div>
            }
            color="#fff"
            styles={{
                body: {
                    color: "#051729",
                    border: "1px solid rgba(207, 19, 34, 0.35)",
                    fontSize: 12,
                    maxWidth: 360,
                },
            }}
        >
            <button
                type="button"
                aria-label={`${warnings.length} warning${warnings.length > 1 ? "s" : ""} on ${fieldName}`}
                style={fieldWarningButton}
            >
                <Warning size={14} weight="fill" />
            </button>
        </Tooltip>
    )
}

/**
 * Info-icon indicator for fields that need a small explanation that doesn't
 * belong in the body. Mirrors the Warning indicator: small icon button in
 * the header, tooltip carries the prose. Stringified strings use it to
 * explain the round-trip behavior; future kinds (e.g. schema-projected
 * fields) can reuse this component with their own copy.
 */
const INFO_BY_KIND: Record<string, {title: string; body: string}> = {
    stringified: {
        title: "Stored as a JSON string",
        body: "Edits round-trip through the stringified storage — the parsed object updates and the string is re-serialized on save. Switch the render to JSON to edit the raw escaped string directly.",
    },
}

function FieldInfoIndicator({kind}: {kind: keyof typeof INFO_BY_KIND}) {
    const info = INFO_BY_KIND[kind]
    if (!info) return null
    return (
        <Tooltip
            title={
                <div style={{display: "flex", flexDirection: "column", gap: 4, lineHeight: 1.45}}>
                    <strong>{info.title}</strong>
                    <span>{info.body}</span>
                </div>
            }
            color="#fff"
            styles={{
                body: {
                    color: "#051729",
                    border: "1px solid rgba(5, 23, 41, 0.12)",
                    fontSize: 12,
                    maxWidth: 320,
                },
            }}
        >
            <button
                type="button"
                aria-label={info.title}
                style={fieldInfoButton}
            >
                <Info size={14} />
            </button>
        </Tooltip>
    )
}

function ProposedField({
    name,
    value,
    nameChips = [],
    autoExpand,
    depth = 0,
    path,
    editable = true,
    onChange,
    chipMode = "all",
    forceCollapsed,
    collapseSignal,
}: {
    name: string
    value: unknown
    nameChips?: ChipVariant[]
    autoExpand?: boolean
    depth?: number
    path: (string | number)[]
    editable?: boolean
    onChange?: (path: (string | number)[], next: unknown) => void
    chipMode?: ChipRenderMode
    /**
     * When the parent emits an "expand all" / "collapse all" event, it bumps
     * `collapseSignal` and sets `forceCollapsed` to the desired state. We
     * reset our local collapse + open state to match. Between signals, the
     * caret button drives local state as usual.
     */
    forceCollapsed?: boolean
    collapseSignal?: number
}) {
    const editorId = useId()
    const kind = classify(value)
    // Stringified-JSON fields are always expandable — the existing caret on
    // every field header is the universal expand control. Clicking it on a
    // stringified field shows the parsed structure inline; clicking again
    // collapses back to "just a string". This unifies the affordance with
    // objects / arrays / messages — no separate `parse?` button needed.
    const expandable =
        kind.kind === "object" ||
        kind.kind === "array" ||
        kind.kind === "messages" ||
        kind.kind === "stringified"
    // Mirror production semantics: every field — primitive AND expandable —
    // gets a collapse chevron. `isCollapsed` hides the body. `autoExpand` for
    // expandable kinds means "start with the body visible AND nested cards
    // open". For primitives, `isCollapsed=false` is the natural default
    // (matching production's `DrillInFieldHeader` where the caret toggles the
    // entire field body regardless of value type).
    const initiallyCollapsed = false
    const [isCollapsed, setIsCollapsed] = useState(initiallyCollapsed)
    // Auto-expand at all depths when the prop is set, so deeply nested values
    // (e.g. inputs.messages, gap-06) render inline. Messages always auto-expand
    // so role cards appear without an extra click.
    const shouldAutoExpandNested =
        (autoExpand && expandable) || (kind.kind === "messages" && expandable)
    const [open, setOpen] = useState(shouldAutoExpandNested)
    // Per-field view mode for expandable kinds. "form" = nested cards with
    // typed widgets (was previously labelled "Rendered"). "json" / "yaml" =
    // serialized blob. Local state per row so siblings don't share modes.
    const [viewMode, setViewMode] = useState<"form" | "json" | "yaml">("form")
    // Per-field editor-mode preference for string content. Initialized ONCE
    // at mount via the lazy initializer: if the hydrated value is already
    // long-form, default to "long" so a multi-paragraph markdown field opens
    // in the Lexical editor by default. After mount, only the chip popover
    // changes mode — typing doesn't auto-flip and break focus.
    const [stringMode, setStringMode] = useState<"short" | "long">(() => {
        if (kind.kind === "string" && isLongFormString(kind.value)) return "long"
        return "short"
    })
    // Set true when the user explicitly switches to "long" via the chip; tells
    // the SharedEditor to autofocus on mount so focus jumps from the inline
    // input into the Lexical editor and the user can keep typing.
    const [autoFocusLongEditor, setAutoFocusLongEditor] = useState(false)

    // Per-level expand/collapse-all for THIS field's children (mirror of the
    // top-level toolbar so every level acts the same). When the user clicks
    // the button in this field's header, the signal increments and propagates
    // to nested ProposedFields via the same `forceCollapsed` / `collapseSignal`
    // props the top-level uses.
    const [childrenAllCollapsed, setChildrenAllCollapsed] = useState(false)
    const [childrenCollapseSignal, setChildrenCollapseSignal] = useState(0)
    const toggleChildren = () => {
        setChildrenAllCollapsed((prev) => !prev)
        setChildrenCollapseSignal((s) => s + 1)
    }

    // React to the parent's expand-all / collapse-all signal. The effect
    // re-runs only when the signal increments, so the caret button still
    // owns local state between global toggles.
    useEffect(() => {
        if (collapseSignal === undefined || forceCollapsed === undefined) return
        setIsCollapsed(forceCollapsed)
        if (expandable) {
            setOpen(!forceCollapsed)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collapseSignal])
    // Type primitive (axis 1, always one). Render hints (markdown /
    // stringified / messages / tool-calls) used to render as a second chip
    // here; they're now exposed via the right-side Select instead so the
    // chip area stays clean and only carries native types + warnings.
    const variant: ChipVariant = variantFor(kind.kind)

    // Toggle handler — runs on caret click AND on bubbled clicks from the
    // rest of the header so clicking anywhere on the row (name, empty
    // space, count text) collapses/expands. Interactive children inside
    // the header (chip popover, render Select, action buttons, warning
    // indicator) stop propagation so they don't accidentally toggle.
    const toggleField = () => {
        if (expandable) {
            if (isCollapsed) {
                setIsCollapsed(false)
                if (!open) setOpen(true)
            } else {
                setIsCollapsed(true)
                setOpen(false)
            }
        } else {
            setIsCollapsed((prev) => !prev)
        }
    }
    const stopBubble = (e: React.MouseEvent | React.KeyboardEvent) => e.stopPropagation()

    return (
        <div
            style={{
                ...rowStyle,
                paddingLeft: depth > 0 ? 0 : undefined,
            }}
        >
            <div
                data-drill-in-header
                style={{
                    ...headerStyle,
                    cursor: "pointer",
                    background: depthHeaderBg(depth),
                }}
                onClick={toggleField}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        toggleField()
                    }
                }}
                aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${name}`}
            >
                <div style={headerLeft}>
                    <button
                        type="button"
                        // The caret stays as a focusable button for keyboard
                        // affordance, but its onClick is delegated to the
                        // bubble — header.onClick handles the toggle.
                        tabIndex={-1}
                        style={caretButton}
                        aria-hidden
                    >
                        {isCollapsed ? <CaretRight size={14} /> : <CaretDown size={14} />}
                    </button>
                    <span style={fieldName}>{name}</span>
                    {chipMode !== "none" &&
                        !(
                            chipMode === "ambiguous-only" &&
                            (variant === "string" || variant === "number" || variant === "boolean")
                        ) && (
                            <span onClick={stopBubble}>
                                <ChipConversionPopover
                                    variant={variant}
                                    value={value}
                                    editable={editable}
                                    onConvert={(next) => onChange?.(path, next)}
                                >
                                    <TypeChip
                                        variant={variant}
                                        onClick={editable ? () => {} : undefined}
                                    />
                                </ChipConversionPopover>
                            </span>
                        )}
                    {/* Render hints (markdown / stringified / messages /
                        tool-calls) used to render here as italic dashed
                        chips. They were display-level information conflated
                        with the type-vocabulary chips. They've moved into
                        the right-side render-type Select below — same
                        interaction model as the per-object Form/JSON/YAML
                        select, so the chip area only carries native types
                        and warnings. */}
                    {/* nameChips covers two concerns: warnings (dotted-key,
                        collision, shadowed, mixed — render-time correctness
                        signals) and informational chips (path, unused, etc.).
                        Warnings get consolidated into a single Warning-icon
                        button with an aggregated tooltip so the row stays
                        readable; informationals still render as regular
                        chips. */}
                    <span onClick={stopBubble}>
                        <FieldWarningsIndicator chips={nameChips} fieldName={name} />
                    </span>
                    {/* Stringified-string explainer — was a wordy italic
                        paragraph below the body; now an Info icon + tooltip
                        in the header so the body stays clean. Mirrors the
                        Warning-icon pattern. */}
                    {kind.kind === "stringified" ? (
                        <span onClick={stopBubble}>
                            <FieldInfoIndicator kind="stringified" />
                        </span>
                    ) : null}
                    {nameChips
                        .filter((chip) => !WARNING_CHIPS.has(chip))
                        .map((chip) => (
                            <TypeChip key={chip} variant={chip} />
                        ))}
                    {kind.kind === "object" && (
                        <span style={countText}>{kind.count} properties</span>
                    )}
                    {kind.kind === "array" && <span style={countText}>{kind.count} items</span>}
                    {kind.kind === "messages" && (
                        <span style={countText}>{kind.count} messages</span>
                    )}
                    {kind.kind === "stringified" && (
                        <span style={countText}>
                            {kind.parsedKind === "array"
                                ? `${(kind.parsed as unknown[]).length} items`
                                : `${Object.keys(kind.parsed as object).length} properties`}
                        </span>
                    )}
                </div>
                <div style={headerRight} onClick={stopBubble}>
                    {expandable ? (
                        <Tooltip
                            title={
                                childrenAllCollapsed
                                    ? "Expand all children"
                                    : "Collapse all children"
                            }
                        >
                            <Button
                                type="text"
                                size="small"
                                onClick={toggleChildren}
                                icon={
                                    childrenAllCollapsed ? (
                                        <ArrowsOutLineVertical size={12} />
                                    ) : (
                                        <ArrowsInLineVertical size={12} />
                                    )
                                }
                                aria-label={
                                    childrenAllCollapsed
                                        ? "Expand all children"
                                        : "Collapse all children"
                                }
                                aria-pressed={childrenAllCollapsed}
                            />
                        </Tooltip>
                    ) : null}
                    {kind.kind === "string" ? (
                        <Select
                            size="small"
                            value={stringMode === "long" ? "markdown" : "text"}
                            options={[
                                {value: "text", label: "Text"},
                                {value: "markdown", label: "Markdown"},
                            ]}
                            onChange={(v) => {
                                const next: "short" | "long" =
                                    v === "markdown" ? "long" : "short"
                                setStringMode(next)
                                setAutoFocusLongEditor(next === "long")
                            }}
                            style={{minWidth: 96}}
                            popupMatchSelectWidth={false}
                        />
                    ) : null}
                    {expandable && (
                        <Select
                            size="small"
                            value={viewMode}
                            // Messages-arrays relabel "Form" → "Chat" because
                            // the per-message-card render IS chat-shaped; the
                            // user reads "view as Chat" rather than "view as
                            // Form" of role objects. Same underlying state
                            // value ("form") drives the cards render.
                            options={[
                                {
                                    value: "form",
                                    label: kind.kind === "messages" ? "Chat" : "Form",
                                },
                                {value: "json", label: "JSON"},
                                {value: "yaml", label: "YAML"},
                            ]}
                            onChange={(v) => setViewMode(v as "form" | "json" | "yaml")}
                            style={{minWidth: 96}}
                            popupMatchSelectWidth={false}
                        />
                    )}
                    <Tooltip title="Copy">
                        <Button
                            type="text"
                            size="small"
                            icon={<Copy size={12} />}
                            style={{padding: "0 4px"}}
                        />
                    </Tooltip>
                </div>
            </div>

            {/* Body — hidden when the field is collapsed (chevron right) */}
            {!isCollapsed && !expandable && (
                <div style={leafBody}>
                    {kind.kind === "string" && (
                        <StringField
                            editorId={editorId}
                            value={kind.value}
                            editable={editable}
                            onChange={(next) => onChange?.(path, next)}
                            mode={stringMode}
                            autoFocus={autoFocusLongEditor}
                        />
                    )}
                    {kind.kind === "number" &&
                        (editable ? (
                            <InputNumber
                                value={kind.value}
                                onChange={(v) => onChange?.(path, v ?? 0)}
                                style={{width: "100%"}}
                            />
                        ) : (
                            <span style={chipMode === "none" ? styledNumber : leafText}>
                                {String(kind.value)}
                            </span>
                        ))}
                    {kind.kind === "boolean" &&
                        (editable ? (
                            <div style={booleanRow}>
                                <Switch
                                    checked={kind.value}
                                    onChange={(checked) => onChange?.(path, checked)}
                                />
                                <span
                                    style={
                                        chipMode === "none" ? styledBoolean(kind.value) : leafText
                                    }
                                >
                                    {String(kind.value)}
                                </span>
                            </div>
                        ) : (
                            <span
                                style={chipMode === "none" ? styledBoolean(kind.value) : leafText}
                            >
                                {String(kind.value)}
                            </span>
                        ))}
                    {kind.kind === "null" && (
                        <span
                            style={
                                chipMode === "none"
                                    ? styledNull
                                    : {...leafText, color: "rgba(5, 23, 41, 0.4)"}
                            }
                        >
                            null
                        </span>
                    )}
                </div>
            )}

            {!isCollapsed && expandable && open && viewMode === "json" && (
                <div style={serializedBody}>
                    <EditorProvider
                        key={`${editorId}-json-provider`}
                        codeOnly
                        language="json"
                        showToolbar={false}
                        enableTokens={false}
                    >
                        <SharedEditor
                            id={`${editorId}-json`}
                            // For stringified fields, the source-of-truth IS the
                            // raw string (which is itself valid JSON). For
                            // objects/arrays/messages we pretty-print the
                            // structure. Pretty-print the parsed value of a
                            // stringified field for readability — saving in
                            // editable mode writes the string back.
                            initialValue={
                                kind.kind === "stringified"
                                    ? JSON.stringify(kind.parsed, null, 2)
                                    : JSON.stringify(value, null, 2)
                            }
                            editorType="border"
                            className="overflow-visible"
                            disableDebounce
                            noProvider
                            disabled={!editable}
                            state={editable ? undefined : "readOnly"}
                            handleChange={
                                editable
                                    ? (next: string) => {
                                          try {
                                              const parsed = JSON.parse(next)
                                              // Stringified field: re-encode back
                                              // to a string so the storage shape
                                              // is preserved (the gap-04 rule).
                                              if (kind.kind === "stringified") {
                                                  onChange?.(path, JSON.stringify(parsed))
                                              } else {
                                                  onChange?.(path, parsed)
                                              }
                                          } catch {
                                              // Invalid JSON during typing — wait for valid
                                          }
                                      }
                                    : undefined
                            }
                            editorProps={{
                                codeOnly: true,
                                language: "json",
                                showToolbar: false,
                                showLineNumbers: true,
                            }}
                        />
                    </EditorProvider>
                </div>
            )}
            {!isCollapsed && expandable && open && viewMode === "yaml" && (
                <div style={serializedBody}>
                    <EditorProvider
                        key={`${editorId}-yaml-provider`}
                        codeOnly
                        language="yaml"
                        showToolbar={false}
                        enableTokens={false}
                    >
                        <SharedEditor
                            id={`${editorId}-yaml`}
                            initialValue={toYaml(kind.kind === "stringified" ? kind.parsed : value)}
                            editorType="border"
                            className="overflow-visible"
                            disableDebounce
                            noProvider
                            disabled
                            state="readOnly"
                            editorProps={{
                                codeOnly: true,
                                language: "yaml",
                                showToolbar: false,
                                showLineNumbers: true,
                            }}
                        />
                    </EditorProvider>
                </div>
            )}
            {!isCollapsed &&
                expandable &&
                open &&
                viewMode === "form" &&
                kind.kind === "object" && (
                    <div style={nestedBody}>
                        {Object.entries(kind.value).map(([k, v]) => (
                            <ProposedField
                                key={k}
                                name={k}
                                value={v}
                                depth={depth + 1}
                                autoExpand={autoExpand}
                                path={[...path, k]}
                                editable={editable}
                                onChange={onChange}
                                chipMode={chipMode}
                                forceCollapsed={childrenAllCollapsed}
                                collapseSignal={childrenCollapseSignal}
                            />
                        ))}
                    </div>
                )}
            {!isCollapsed && expandable && open && viewMode === "form" && kind.kind === "array" && (
                <div style={nestedBody}>
                    {kind.value.map((v, i) => (
                        <ProposedField
                            key={i}
                            name={`[${i}]`}
                            value={v}
                            depth={depth + 1}
                            autoExpand={autoExpand}
                            path={[...path, i]}
                            editable={editable}
                            onChange={onChange}
                            chipMode={chipMode}
                            forceCollapsed={childrenAllCollapsed}
                            collapseSignal={childrenCollapseSignal}
                        />
                    ))}
                </div>
            )}
            {!isCollapsed &&
                expandable &&
                open &&
                viewMode === "form" &&
                kind.kind === "stringified" && (
                    <div style={nestedBody}>
                        {/* Round-trip explainer used to render here as a long
                            italic paragraph. It's now an Info-icon tooltip in
                            the field header (see FieldInfoIndicator above) so
                            the body stays focused on the parsed children. */}
                        {kind.parsedKind === "object" &&
                            Object.entries(kind.parsed as Record<string, unknown>).map(([k, v]) => (
                                <ProposedField
                                    key={k}
                                    name={k}
                                    value={v}
                                    depth={depth + 1}
                                    autoExpand={autoExpand}
                                    path={[...path, k]}
                                    editable={editable}
                                    onChange={(absPath, next) => {
                                        // Translate the absolute path back into a
                                        // relative path inside the parsed object,
                                        // apply the change, re-stringify, write the
                                        // new string at THIS field's path. Round-trip
                                        // preserves the [stringified] storage shape.
                                        const relPath = absPath.slice(path.length)
                                        const newParsed = setAtPath(kind.parsed, relPath, next)
                                        onChange?.(path, JSON.stringify(newParsed))
                                    }}
                                    chipMode={chipMode}
                                    forceCollapsed={childrenAllCollapsed}
                                    collapseSignal={childrenCollapseSignal}
                                />
                            ))}
                        {kind.parsedKind === "array" &&
                            (kind.parsed as unknown[]).map((v, i) => (
                                <ProposedField
                                    key={i}
                                    name={`[${i}]`}
                                    value={v}
                                    depth={depth + 1}
                                    autoExpand={autoExpand}
                                    path={[...path, i]}
                                    editable={editable}
                                    onChange={(absPath, next) => {
                                        const relPath = absPath.slice(path.length)
                                        const newParsed = setAtPath(kind.parsed, relPath, next)
                                        onChange?.(path, JSON.stringify(newParsed))
                                    }}
                                    chipMode={chipMode}
                                    forceCollapsed={childrenAllCollapsed}
                                    collapseSignal={childrenCollapseSignal}
                                />
                            ))}
                    </div>
                )}
            {!isCollapsed &&
                expandable &&
                open &&
                viewMode === "form" &&
                kind.kind === "messages" && (
                    <div style={messagesBody}>
                        {kind.value.map((msg, i) => {
                            const m = msg as {
                                role?: string
                                content?: string
                                tool_calls?: unknown[]
                            }
                            return (
                                <div key={i} style={messageCard}>
                                    <div style={messageRole(m.role)}>{m.role ?? "?"}</div>
                                    {m.content !== undefined && (
                                        <div style={messageContent}>
                                            {String(m.content) || (
                                                <em style={{color: "rgba(5,23,41,0.45)"}}>
                                                    (empty content)
                                                </em>
                                            )}
                                        </div>
                                    )}
                                    {m.tool_calls && Array.isArray(m.tool_calls) && (
                                        <div style={toolCallsBlock}>
                                            <div style={toolCallsHeader}>
                                                <span style={toolCallsLabel}>tool_calls</span>
                                                <TypeChip variant="tool-calls" />
                                                <span style={countText}>
                                                    {m.tool_calls.length} call
                                                    {m.tool_calls.length === 1 ? "" : "s"}
                                                </span>
                                            </div>
                                            {m.tool_calls.map((tc, j) => {
                                                const call = tc as {
                                                    id?: string
                                                    function?: {
                                                        name?: string
                                                        arguments?: string
                                                    }
                                                }
                                                let parsedArgs: unknown = null
                                                if (typeof call.function?.arguments === "string") {
                                                    try {
                                                        parsedArgs = JSON.parse(
                                                            call.function.arguments,
                                                        )
                                                    } catch {
                                                        parsedArgs = call.function.arguments
                                                    }
                                                }
                                                return (
                                                    <div key={j} style={toolCallCard}>
                                                        <div style={toolCallTitle}>
                                                            <strong>
                                                                {call.function?.name ?? "?"}
                                                            </strong>
                                                            {call.id && (
                                                                <span style={countText}>
                                                                    {" "}
                                                                    · {call.id}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <pre style={toolCallArgs}>
                                                            {JSON.stringify(parsedArgs, null, 2)}
                                                        </pre>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
        </div>
    )
}

export function ProposedDrillIn({
    data,
    rootTitle = "Testcase",
    detectDotKeyCollisions = false,
    autoExpand = false,
    editable = true,
    chipMode = "all",
    knownColumns,
    rootViewMode: controlledRootViewMode,
    onRootViewModeChange,
    hideRootViewMode = false,
}: ProposedDrillInProps) {
    const [draft, setDraft] = useState<Record<string, unknown>>(data)

    // Reset draft when the source data identity changes (e.g. switching pages).
    // Cheap heuristic via JSON.stringify since data is small and shallow here.
    const dataKey = useMemo(() => JSON.stringify(data), [data])
    const lastKeyRef = useMemo(() => ({current: dataKey}), [])
    if (lastKeyRef.current !== dataKey) {
        lastKeyRef.current = dataKey
        // setState during render is allowed when guarded by a ref check
        // (React docs: "Storing information from previous renders").
        setDraft(data)
    }

    const handleChange = useCallback((path: (string | number)[], next: unknown) => {
        setDraft((prev) => setAtPath(prev, path, next) as Record<string, unknown>)
    }, [])

    const keyKind = useMemo(() => {
        // Per-key categorization: 'dotted-collision' (literal-dot key with a
        // colliding nested counterpart), 'nested-collision' (nested object whose
        // path is shadowed by a literal-dot sibling), 'dotted' (literal-dot
        // alone, no collision).
        type KeyKind = "dotted-collision" | "nested-collision" | "dotted" | null
        const map = new Map<string, KeyKind>()
        if (!detectDotKeyCollisions) return map
        const keys = Object.keys(draft)
        const dottedKeys = keys.filter((k) => k.includes("."))
        for (const dotted of dottedKeys) {
            const head = dotted.split(".")[0]
            if (head in draft && typeof draft[head] === "object" && draft[head] !== null) {
                map.set(dotted, "dotted-collision")
                map.set(head, "nested-collision")
            } else {
                map.set(dotted, "dotted")
            }
        }
        return map
    }, [draft, detectDotKeyCollisions])

    // gap-04 — keys that exist on other rows but not this one. Render as
    // ghost rows with the [not authored] chip so the user sees the union
    // shape without polluting storage. Empty unless `knownColumns` is given.
    const notAuthoredKeys = useMemo(() => {
        if (!knownColumns || knownColumns.length === 0) return []
        return knownColumns.filter((k) => !(k in draft))
    }, [knownColumns, draft])

    // Top-level view mode for the whole row. "form" is the default
    // structured view (per-field cards — vocabulary unified with per-field
    // dropdowns so "Form" means the same thing at every depth). "json" /
    // "yaml" render the entire draft as a single serialized blob — paste a
    // row's worth of JSON/YAML once, switch back to "form" to see the parsed
    // structure. Useful when adding a new testcase from an existing payload
    // instead of typing field-by-field.
    //
    // Controllable from the parent: when `rootViewMode` is provided, the
    // drawer chrome (or page) owns the toggle and we surrender our local
    // state. Pair with `hideRootViewMode` to drop the body-level dropdown
    // entirely so there's no duplicate control next to the title.
    const [internalRootViewMode, setInternalRootViewMode] = useState<
        "form" | "json" | "yaml"
    >("form")
    const rootViewMode = controlledRootViewMode ?? internalRootViewMode
    const setRootViewMode = (mode: "form" | "json" | "yaml") => {
        if (controlledRootViewMode === undefined) {
            setInternalRootViewMode(mode)
        }
        onRootViewModeChange?.(mode)
    }

    // Expand / collapse all top-level fields. The signal increments on each
    // click and is forwarded to every ProposedField; ProposedField resets its
    // local collapsed state to match `forceCollapsed` when the signal changes.
    // After the reset, individual carets re-take local control until the next
    // global toggle. Default: everything expanded (matches autoExpand intent).
    const [allCollapsed, setAllCollapsed] = useState(false)
    const [collapseSignal, setCollapseSignal] = useState(0)
    const toggleAll = () => {
        setAllCollapsed((prev) => !prev)
        setCollapseSignal((s) => s + 1)
    }

    // gap-04 schema-mismatch ghost rows hide by default — they're a "this
    // column exists in the testset's schema but not on this row" signal,
    // not the row's actual content. The user surfaces them with the toggle
    // below the field list when they care to see what's missing.
    const [showNotAuthored, setShowNotAuthored] = useState(false)

    // Optional view: stack rows with correctness warnings (dotted-key /
    // collision) at the bottom of the field list with a divider in between.
    // Off by default — preserves the user's authored shape (e.g. `geo` and
    // `geo.region` stay adjacent, which is part of *why* they collide).
    // Useful for triage when there are many fields.
    const [groupIssues, setGroupIssues] = useState(false)
    const orderedEntries = useMemo(() => {
        const entries = Object.entries(draft).map(([key, value]) => ({
            key,
            value,
            isWarning: keyKind.has(key),
        }))
        if (!groupIssues) return entries
        const ok = entries.filter((e) => !e.isWarning)
        const warn = entries.filter((e) => e.isWarning)
        return [...ok, ...warn]
    }, [draft, keyKind, groupIssues])
    const firstWarningIndex = orderedEntries.findIndex((e) => e.isWarning)
    const warningCount = orderedEntries.length - (firstWarningIndex === -1 ? orderedEntries.length : firstWarningIndex)
    const hasWarnings = warningCount > 0

    return (
        <div style={shellStyle}>
            <div style={rootHeaderStyle}>
                <div style={rootLabel}>{rootTitle}</div>
                <div style={rootHeaderActions}>
                    {hasWarnings ? (
                        <Tooltip
                            title={
                                groupIssues ? "Show issues in place" : "Group issues at bottom"
                            }
                        >
                            <Button
                                type="text"
                                size="small"
                                onClick={() => setGroupIssues((v) => !v)}
                                icon={
                                    <Funnel
                                        size={14}
                                        weight={groupIssues ? "fill" : "regular"}
                                    />
                                }
                                style={{
                                    color: groupIssues ? "#cf1322" : undefined,
                                }}
                                aria-label={
                                    groupIssues ? "Show issues in place" : "Group issues at bottom"
                                }
                                aria-pressed={groupIssues}
                            />
                        </Tooltip>
                    ) : null}
                    <Tooltip title={allCollapsed ? "Expand all" : "Collapse all"}>
                        <Button
                            type="text"
                            size="small"
                            onClick={toggleAll}
                            icon={
                                allCollapsed ? (
                                    <ArrowsOutLineVertical size={14} />
                                ) : (
                                    <ArrowsInLineVertical size={14} />
                                )
                            }
                            aria-label={allCollapsed ? "Expand all" : "Collapse all"}
                        />
                    </Tooltip>
                    {hideRootViewMode ? null : (
                        <Select
                            size="small"
                            value={rootViewMode}
                            options={[
                                {value: "form", label: "Form"},
                                {value: "json", label: "JSON"},
                                {value: "yaml", label: "YAML"},
                            ]}
                            onChange={(v) => setRootViewMode(v as "form" | "json" | "yaml")}
                            style={{minWidth: 96}}
                            popupMatchSelectWidth={false}
                        />
                    )}
                    {/* Copy action mirrors the per-field Copy button so the
                        top-level toolbar's right edge aligns with each row's
                        right edge. Same vocabulary across levels. */}
                    <Tooltip title="Copy">
                        <Button
                            type="text"
                            size="small"
                            icon={<Copy size={12} />}
                            style={{padding: "0 4px"}}
                            aria-label={`Copy ${rootTitle}`}
                        />
                    </Tooltip>
                </div>
            </div>
            {rootViewMode !== "form" ? (
                <RootSerializedView
                    draft={draft}
                    mode={rootViewMode}
                    editable={editable}
                    onApply={(next) => setDraft(next)}
                />
            ) : null}
            {rootViewMode === "form" && (
                <div className="proposed-drill-in-field-list" style={fieldListStyle}>
                    {orderedEntries.map((entry, i) => {
                        const {key, value} = entry
                        const kind = keyKind.get(key)
                        const nameChips: ChipVariant[] = []
                        if (kind === "dotted-collision") {
                            // Both chips on the literal-dot row so the user
                            // sees what the key IS (literal) AND what's at
                            // risk (collision).
                            nameChips.push("dotted-key", "collision")
                        } else if (kind === "nested-collision") {
                            nameChips.push("collision")
                        } else if (kind === "dotted") {
                            nameChips.push("dotted-key")
                        }
                        const isFirstWarning =
                            groupIssues && hasWarnings && i === firstWarningIndex
                        return (
                            <Fragment key={key}>
                                {isFirstWarning ? (
                                    <div style={issuesDivider}>
                                        <Warning size={12} weight="fill" />
                                        <span>
                                            Issues ({warningCount})
                                        </span>
                                    </div>
                                ) : null}
                                <ProposedField
                                    name={key}
                                    value={value}
                                    nameChips={nameChips}
                                    autoExpand={autoExpand}
                                    depth={0}
                                    path={[key]}
                                    editable={editable}
                                    onChange={handleChange}
                                    chipMode={chipMode}
                                    forceCollapsed={allCollapsed}
                                    collapseSignal={collapseSignal}
                                />
                            </Fragment>
                        )
                    })}
                    {/* gap-04 schema-mismatch footer. Read-only ghost rows
                        for keys present in the testset's schema/union but
                        absent from this row. Hidden by default; the user
                        opts in to see them. Clicking "author" would create
                        the key here — that's parent territory. */}
                    {notAuthoredKeys.length > 0 ? (
                        <div style={schemaMismatchFooter}>
                            <button
                                type="button"
                                style={schemaMismatchToggle}
                                onClick={() => setShowNotAuthored((v) => !v)}
                                aria-expanded={showNotAuthored}
                            >
                                {showNotAuthored ? (
                                    <CaretDown size={12} />
                                ) : (
                                    <CaretRight size={12} />
                                )}
                                <span>
                                    {showNotAuthored ? "Hide" : "Show"}{" "}
                                    {notAuthoredKeys.length} unauthored{" "}
                                    {notAuthoredKeys.length === 1 ? "column" : "columns"}{" "}
                                    from schema
                                </span>
                            </button>
                            {showNotAuthored ? (
                                <div style={schemaMismatchList}>
                                    {notAuthoredKeys.map((key) => (
                                        <NotAuthoredGhostRow
                                            key={key}
                                            name={key}
                                            chipMode={chipMode}
                                        />
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    )
}

/**
 * Root-level serialized view (JSON or YAML) for the entire draft. Used by
 * ProposedDrillIn when the user toggles to "JSON" or "YAML". Auto-applies
 * parsed edits back to the draft on every keystroke; shows an inline parse
 * error when the text isn't valid. The fields-view picks back up wherever
 * the parsed structure lands.
 *
 * Practical use: paste a JSON or YAML payload to populate a new testcase
 * row in one shot, instead of typing field-by-field.
 */
function RootSerializedView({
    draft,
    mode,
    editable,
    onApply,
}: {
    draft: Record<string, unknown>
    mode: "json" | "yaml"
    editable: boolean
    onApply: (next: Record<string, unknown>) => void
}) {
    const editorId = useId()
    // Serialize the current draft once at mount-of-this-mode. We don't
    // re-serialize on every parent re-render because that would clobber
    // the user's in-progress edits when the parsed text round-trips back
    // to draft (different whitespace/key-order).
    const initialText = useMemo(
        () =>
            mode === "json" ? JSON.stringify(draft, null, 2) : yaml.dump(draft, {lineWidth: 120}),
        // Intentionally only depends on `mode` — switching modes re-serializes
        // from current draft, but typing inside one mode doesn't.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [mode],
    )
    const [text, setText] = useState(initialText)
    const [parseError, setParseError] = useState<string | null>(null)

    const handleChange = useCallback(
        (next: string) => {
            setText(next)
            try {
                const parsed = mode === "json" ? JSON.parse(next) : yaml.load(next)
                if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
                    setParseError(
                        `Top-level value must be an object, got ${
                            Array.isArray(parsed) ? "array" : typeof parsed
                        }.`,
                    )
                    return
                }
                setParseError(null)
                onApply(parsed as Record<string, unknown>)
            } catch (err) {
                setParseError(err instanceof Error ? err.message : String(err))
            }
        },
        [mode, onApply],
    )

    return (
        <div style={rootSerializedBody}>
            <EditorProvider
                key={`${editorId}-${mode}-provider`}
                codeOnly
                language={mode === "json" ? "json" : "yaml"}
                showToolbar={false}
                enableTokens={false}
            >
                <SharedEditor
                    id={`${editorId}-${mode}`}
                    initialValue={text}
                    editorType="border"
                    className="overflow-visible"
                    disableDebounce
                    noProvider
                    disabled={!editable}
                    state={editable ? undefined : "readOnly"}
                    handleChange={editable ? handleChange : undefined}
                />
            </EditorProvider>
            {parseError ? (
                <div style={rootParseError}>
                    <strong>Parse error:</strong> {parseError}
                </div>
            ) : (
                <div style={rootParseHint}>
                    Edits apply to the draft as you type. Switch back to <strong>Form</strong> to
                    see the parsed structure.
                </div>
            )}
        </div>
    )
}

/**
 * Ghost row for a column present in the testset's union but not in this
 * row's data. Visually muted, [not authored] chip, no editor body.
 */
function NotAuthoredGhostRow({name, chipMode}: {name: string; chipMode: ChipRenderMode}) {
    return (
        <div style={{...rowStyle, opacity: 0.5}}>
            <div style={headerStyle}>
                <div style={headerLeft}>
                    <span style={{width: 14}} />
                    <span style={fieldName}>{name}</span>
                    {chipMode !== "none" && <TypeChip variant="not-authored" />}
                </div>
                <div style={headerRight}>
                    <span style={countText}>not in this row</span>
                </div>
            </div>
        </div>
    )
}

const shellStyle = {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    fontSize: 12,
    color: "#051729",
}

const rootLabel = {
    fontSize: 13,
    fontWeight: 700,
    color: "#051729",
}

// Padding mirrors the field-row offset (1px container border + 10px header
// padding = 11px) so the top toolbar's title aligns with the field carets
// below and the right actions align with each row's right actions.
const rootHeaderStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between" as const,
    gap: 12,
    padding: "0 11px",
    marginBottom: 4,
}

const rootHeaderActions = {
    display: "flex",
    alignItems: "center",
    gap: 6,
}

// Shared frame for the field list — one border around the whole stack so
// adjacent rows look like sections of a single surface, not separately
// floating cards. Internal dividers come from each row's `borderTop`.
const fieldListStyle = {
    display: "flex",
    flexDirection: "column" as const,
    background: "white",
    border: "1px solid rgba(5, 23, 41, 0.08)",
    borderRadius: 6,
    overflow: "hidden" as const,
}

const schemaMismatchFooter = {
    display: "flex",
    flexDirection: "column" as const,
    borderTop: "1px solid rgba(5, 23, 41, 0.06)",
    background: "#fafafa",
}

const schemaMismatchToggle = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: 11,
    color: "rgba(5, 23, 41, 0.55)",
    fontFamily: "inherit",
    textAlign: "left" as const,
    width: "100%",
}

const schemaMismatchList = {
    display: "flex",
    flexDirection: "column" as const,
    borderTop: "1px solid rgba(5, 23, 41, 0.06)",
}

// Divider between the in-place rows and the grouped warning rows. Picks up
// the same red as the warning indicator so the visual handoff is obvious
// (top half of the list = clean, below the divider = needs attention).
const issuesDivider = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 600,
    color: "#cf1322",
    background: "rgba(207, 19, 34, 0.04)",
    borderTop: "1px solid rgba(207, 19, 34, 0.18)",
    borderBottom: "1px solid rgba(207, 19, 34, 0.18)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
}

const rootSerializedBody = {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    padding: 8,
    background: "#fafafa",
    border: "1px solid rgba(5, 23, 41, 0.08)",
    borderRadius: 6,
}

const rootParseHint = {
    fontSize: 11,
    color: "rgba(5, 23, 41, 0.55)",
    fontStyle: "italic" as const,
}

const rootParseError = {
    fontSize: 11,
    color: "#cf1322",
    background: "#fff2f0",
    border: "1px solid rgba(207, 19, 34, 0.3)",
    borderRadius: 4,
    padding: "6px 10px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
}

const rowStyle = {
    background: "white",
    // No own border / radius — the parent fieldListStyle owns the outer
    // shape and borders. Adjacent rows get a top divider via the selector
    // below in headerStyle (firstRow override removes it on the first row).
    borderTop: "1px solid rgba(5, 23, 41, 0.06)",
    overflow: "hidden" as const,
}

const headerStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between" as const,
    gap: 8,
    padding: "2px 10px",
    minHeight: 28,
    background: "#FAFAFA",
    fontSize: 12,
    lineHeight: "20px",
}

const headerLeft = {
    display: "flex",
    alignItems: "center",
    // flexWrap allows the chip stack (type chip + render-hint chip + name
    // chips like dotted-key / collision / shadowed) to drop to a second
    // line when the field card is narrow. Without it, trailing chips were
    // clipped by `rowStyle.overflow: hidden` and disappeared silently —
    // exactly the regression that hid `[dotted-key]` / `[⚠ collision]`
    // on the geo.region row in narrow side-by-side panels.
    flexWrap: "wrap" as const,
    gap: 8,
    flex: 1,
    minWidth: 0,
}

const headerRight = {
    display: "flex",
    alignItems: "center",
    gap: 6,
}

const caretButton = {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    color: "rgba(5, 23, 41, 0.65)",
}

// Indicator buttons — explicit height + alignment so the SVG icon shares the
// same vertical center as the type chip + field name in the row. `lineHeight:0`
// alone wasn't enough because the SVG's `display:inline-block` baseline
// rendered slightly above the chip's text baseline.
const fieldIndicatorButton = {
    background: "transparent",
    border: "none",
    cursor: "pointer" as const,
    padding: 0,
    display: "inline-flex",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    height: 20,
    width: 20,
    verticalAlign: "middle" as const,
}

const fieldWarningButton = {
    ...fieldIndicatorButton,
    color: "#cf1322",
}

const fieldInfoButton = {
    ...fieldIndicatorButton,
    color: "rgba(5, 23, 41, 0.45)",
}

const fieldName = {
    fontWeight: 500,
    color: "#051729",
}

const countText = {
    fontSize: 10,
    color: "rgba(5, 23, 41, 0.55)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
}

const leafBody = {
    padding: "4px 12px 6px",
    background: "white",
}

const inputStyle = {
    width: "100%",
    border: "1px solid rgba(5, 23, 41, 0.12)",
    borderRadius: 4,
    padding: "6px 10px",
    fontSize: 12,
    fontFamily: "inherit",
    background: "white",
}

const leafText = {
    fontSize: 12,
    color: "#051729",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
}

const booleanRow = {
    display: "flex",
    alignItems: "center",
    gap: 10,
}

const serializedBody = {
    padding: "10px 12px",
    background: "white",
}

const serializedPre = {
    margin: 0,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 11,
    lineHeight: 1.6,
    color: "#051729",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
}

const serializedTextareaStyle = {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 11,
    lineHeight: 1.5,
}

// Long-form string editor — the SharedEditor (Lexical) sits inside a
// relatively positioned wrapper so the M↓ render-toggle can float at the
// top-right corner without occupying a separate horizontal toolbar (which
// otherwise reads as a collapsible section header).
const longFormSurfaceStyle = {
    position: "relative" as const,
}

const longFormToggleStyle = {
    position: "absolute" as const,
    top: 4,
    right: 4,
    // Keep the toggle above the editor's text but click-through-able to the
    // editor on the surrounding area.
    zIndex: 2,
}

// Type-driven value styles for chipMode="none". The signal moves from a
// labelled chip ([num], [bool], [null]) into the value's own visual treatment.
const styledNumber = {
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    color: "#722ed1", // purple — matches PrettyJson syntax in RowDetailPopover
    fontVariantNumeric: "tabular-nums" as const,
}

const styledBoolean = (v: boolean) =>
    ({
        fontSize: 12,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        color: v ? "#389e0d" : "#cf1322", // green / red
        fontWeight: 600,
    }) as const

const styledNull = {
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    color: "rgba(5, 23, 41, 0.45)",
    fontStyle: "italic" as const,
}

// Nested body: children are flush against each other (no gap) and indented
// from the left so the user reads "this group lives inside the parent".
// A thin vertical rail on the left reinforces nesting without adding a
// nested card-inside-card border. Each child's own borderTop provides the
// separator between siblings AND between the parent header and first child.
//
// `marginLeft: 17` aligns the rail roughly under the parent's caret center
// (header padding 10 + caret midpoint 7), so the rail visually "descends"
// from the parent toggle rather than floating arbitrary distance from the
// edge. Stronger alpha (0.12) makes the rail readable at depth ≥ 2 where
// two rails sit near each other.
const nestedBody = {
    paddingLeft: 14,
    marginLeft: 17,
    display: "flex",
    flexDirection: "column" as const,
    gap: 0,
    background: "white",
    borderLeft: "2px solid rgba(5, 23, 41, 0.12)",
}

const messagesBody = {
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    background: "white",
}

const messageCard = {
    border: "1px solid rgba(5, 23, 41, 0.08)",
    borderRadius: 6,
    padding: "8px 10px",
}

const messageRole = (role?: string): React.CSSProperties => {
    const colorMap: Record<string, string> = {
        system: "#d46b08",
        user: "#1677ff",
        assistant: "#13c2c2",
        tool: "#389e0d",
    }
    return {
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        color: colorMap[role ?? ""] ?? "rgba(5, 23, 41, 0.55)",
        marginBottom: 4,
    }
}

const messageContent = {
    fontSize: 12,
    color: "#051729",
    lineHeight: 1.5,
}

const toolCallsBlock = {
    marginTop: 6,
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
}

const toolCallsHeader = {
    display: "flex",
    alignItems: "center",
    gap: 6,
}

const toolCallsLabel = {
    fontSize: 11,
    fontWeight: 500,
    color: "#051729",
}

const toolCallCard = {
    border: "1px solid rgba(5, 23, 41, 0.08)",
    borderRadius: 4,
    padding: "6px 10px",
    background: "rgba(56, 158, 13, 0.04)",
}

const toolCallTitle = {
    fontSize: 11,
    color: "#051729",
    marginBottom: 4,
}

const toolCallArgs = {
    margin: 0,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 10,
    lineHeight: 1.4,
    color: "rgba(5, 23, 41, 0.75)",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
}

export default ProposedDrillIn
