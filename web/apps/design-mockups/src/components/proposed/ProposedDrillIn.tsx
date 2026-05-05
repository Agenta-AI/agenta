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

import {useCallback, useId, useMemo, useState} from "react"

import type {ChipVariant} from "@/mockups/components/proposed/TypeChip"
import {TypeChip} from "@/mockups/components/proposed/TypeChip"
import {ChipConversionPopover} from "@/mockups/components/proposed/ChipConversionPopover"
import {CaretDown, CaretRight, Copy} from "@phosphor-icons/react"
import {Button, Input, InputNumber, Segmented, Select, Switch, Tooltip} from "antd"
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

function variantFor(kind: FieldKind["kind"]): ChipVariant {
    switch (kind) {
        case "object":
            return "json-object"
        case "array":
            return "json-array"
        case "messages":
            return "messages"
        case "null":
            return "null"
        case "string":
            return "string"
        case "stringified":
            return "stringified"
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
    return (
        <EditorProvider
            key={`${editorId}-text-provider`}
            id={editorId}
            initialValue={value}
            showToolbar={false}
            enableTokens={false}
        >
            <div style={longFormWrapStyle}>
                <div style={longFormToolbarStyle}>
                    <span style={longFormHintStyle}>Markdown</span>
                    <MarkdownToggleButton id={editorId} />
                </div>
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
            </div>
        </EditorProvider>
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
    const baseVariant = variantFor(kind.kind)
    // String chip flips to long-str when mode=long; other variants unchanged.
    const variant: ChipVariant =
        kind.kind === "string" && stringMode === "long" ? "long-str" : baseVariant

    return (
        <div
            style={{
                ...rowStyle,
                paddingLeft: depth > 0 ? 0 : undefined,
            }}
        >
            <div style={headerStyle}>
                <div style={headerLeft}>
                    <button
                        type="button"
                        onClick={() => {
                            // For expandable kinds, the caret toggles BOTH
                            // collapse-the-field AND expand-nested-cards in
                            // sync — production has one chevron driving both.
                            // For primitives, it just toggles the body.
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
                        }}
                        style={caretButton}
                        aria-label={isCollapsed ? "Expand" : "Collapse"}
                    >
                        {isCollapsed ? <CaretRight size={14} /> : <CaretDown size={14} />}
                    </button>
                    <span style={fieldName}>{name}</span>
                    {chipMode !== "none" &&
                        !(
                            chipMode === "ambiguous-only" &&
                            (variant === "string" ||
                                variant === "number" ||
                                variant === "boolean")
                        ) && (
                            <ChipConversionPopover
                                variant={variant}
                                value={value}
                                editable={editable}
                                onConvert={(next) => onChange?.(path, next)}
                                onModeSwitch={
                                    kind.kind === "string"
                                        ? (next) => {
                                              setStringMode(next)
                                              if (next === "long") {
                                                  setAutoFocusLongEditor(true)
                                              } else {
                                                  setAutoFocusLongEditor(false)
                                              }
                                          }
                                        : undefined
                                }
                            >
                                <TypeChip
                                    variant={variant}
                                    onClick={editable ? () => {} : undefined}
                                    notificationBadge={
                                        kind.kind === "string" &&
                                        stringMode === "short" &&
                                        isLongFormString(kind.value)
                                    }
                                    badgeTooltip="Long content detected — click to switch to long-form editor"
                                />
                            </ChipConversionPopover>
                        )}
                    {/* nameChips (collision / dotted-key / shadowed) ALWAYS render
                        — they're correctness signals, not type vocabulary. They
                        get their own action menus in a Phase 2 (resolve
                        collision, lock column type, etc.). */}
                    {nameChips.map((chip) => (
                        <TypeChip key={chip} variant={chip} />
                    ))}
                    {kind.kind === "object" && (
                        <span style={countText}>{kind.count} properties</span>
                    )}
                    {kind.kind === "array" && (
                        <span style={countText}>{kind.count} items</span>
                    )}
                    {kind.kind === "messages" && (
                        <span style={countText}>{kind.count} messages</span>
                    )}
                    {kind.kind === "stringified" && (
                        <span style={countText}>
                            {kind.parsedKind === "array"
                                ? `[ ${(kind.parsed as unknown[]).length} items ]`
                                : `{ ${Object.keys(kind.parsed as object).length} props }`}
                        </span>
                    )}
                </div>
                <div style={headerRight}>
                    {expandable && (
                        <Select
                            size="small"
                            value={viewMode}
                            options={[
                                {value: "form", label: "Form"},
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
                                    style={chipMode === "none" ? styledBoolean(kind.value) : leafText}
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
                        <span style={chipMode === "none" ? styledNull : {...leafText, color: "rgba(5, 23, 41, 0.4)"}}>
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
                            initialValue={toYaml(
                                kind.kind === "stringified" ? kind.parsed : value,
                            )}
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
            {!isCollapsed && expandable && open && viewMode === "form" && kind.kind === "object" && (
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
                        <div style={parsedHintStyle}>
                            Stored as a JSON string. Edits round-trip through the
                            stringified storage — the parsed object updates, the
                            string is re-serialized, and the chip stays{" "}
                            <code>[stringified]</code>. Switch to <code>JSON</code>{" "}
                            to edit the raw string directly.
                        </div>
                        {kind.parsedKind === "object" &&
                            Object.entries(kind.parsed as Record<string, unknown>).map(
                                ([k, v]) => (
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
                                            const newParsed = setAtPath(
                                                kind.parsed,
                                                relPath,
                                                next,
                                            )
                                            onChange?.(path, JSON.stringify(newParsed))
                                        }}
                                        chipMode={chipMode}
                                    />
                                ),
                            )}
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
                                        const newParsed = setAtPath(
                                            kind.parsed,
                                            relPath,
                                            next,
                                        )
                                        onChange?.(path, JSON.stringify(newParsed))
                                    }}
                                    chipMode={chipMode}
                                />
                            ))}
                    </div>
                )}
            {!isCollapsed && expandable && open && viewMode === "form" && kind.kind === "messages" && (
                <div style={messagesBody}>
                    {kind.value.map((msg, i) => {
                        const m = msg as {role?: string; content?: string; tool_calls?: unknown[]}
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
                                            <TypeChip variant="tool" label="tool" />
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
                                                                {" "}· {call.id}
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

    const handleChange = useCallback(
        (path: (string | number)[], next: unknown) => {
            setDraft((prev) => setAtPath(prev, path, next) as Record<string, unknown>)
        },
        [],
    )

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

    // Top-level view mode for the whole row. "fields" is the default
    // structured view (per-field cards). "json" / "yaml" render the entire
    // draft as a single serialized blob in a code editor — paste a row's
    // worth of JSON/YAML once, switch back to "fields" to see the parsed
    // structure. Useful when adding a new testcase from an existing payload
    // instead of typing field-by-field.
    const [rootViewMode, setRootViewMode] = useState<"fields" | "json" | "yaml">("fields")

    return (
        <div style={shellStyle}>
            <div style={rootHeaderStyle}>
                <div style={rootLabel}>{rootTitle}</div>
                <Segmented
                    size="small"
                    value={rootViewMode}
                    options={[
                        {label: "Fields", value: "fields"},
                        {label: "JSON", value: "json"},
                        {label: "YAML", value: "yaml"},
                    ]}
                    onChange={(v) =>
                        setRootViewMode(v as "fields" | "json" | "yaml")
                    }
                />
            </div>
            {rootViewMode !== "fields" ? (
                <RootSerializedView
                    draft={draft}
                    mode={rootViewMode}
                    editable={editable}
                    onApply={(next) => setDraft(next)}
                />
            ) : null}
            {rootViewMode === "fields" &&
                Object.entries(draft).map(([key, value]) => {
                const kind = keyKind.get(key)
                const nameChips: ChipVariant[] = []
                if (kind === "dotted-collision") {
                    // Both chips on the literal-dot row so the user sees what
                    // the key IS (literal) AND what's at risk (collision).
                    nameChips.push("dotted-key", "collision")
                } else if (kind === "nested-collision") {
                    nameChips.push("collision")
                } else if (kind === "dotted") {
                    nameChips.push("dotted-key")
                }
                return (
                    <ProposedField
                        key={key}
                        name={key}
                        value={value}
                        nameChips={nameChips}
                        autoExpand={autoExpand}
                        depth={0}
                        path={[key]}
                        editable={editable}
                        onChange={handleChange}
                        chipMode={chipMode}
                    />
                )
            })}
            {/* Union-projected ghost rows (gap-04). Read-only — clicking
                "author this column" would create the key on this row, but
                that's the parent's responsibility. The chip + muted styling
                signal that the field exists in the testset's union but isn't
                stored on this row. */}
            {rootViewMode === "fields" &&
                notAuthoredKeys.map((key) => (
                    <NotAuthoredGhostRow key={key} name={key} chipMode={chipMode} />
                ))}
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
            mode === "json"
                ? JSON.stringify(draft, null, 2)
                : yaml.dump(draft, {lineWidth: 120}),
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
                if (
                    parsed === null ||
                    typeof parsed !== "object" ||
                    Array.isArray(parsed)
                ) {
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
                    Edits apply to the draft as you type. Switch back to{" "}
                    <strong>Fields</strong> to see the parsed structure.
                </div>
            )}
        </div>
    )
}

/**
 * Ghost row for a column present in the testset's union but not in this
 * row's data. Visually muted, [not authored] chip, no editor body.
 */
function NotAuthoredGhostRow({
    name,
    chipMode,
}: {
    name: string
    chipMode: ChipRenderMode
}) {
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

const rootHeaderStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between" as const,
    gap: 12,
    marginBottom: 4,
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
    border: "1px solid rgba(5, 23, 41, 0.08)",
    borderRadius: 6,
    background: "white",
    overflow: "hidden" as const,
}

const headerStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between" as const,
    gap: 8,
    padding: "8px 12px",
    background: "#FAFAFA",
    borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
}

const headerLeft = {
    display: "flex",
    alignItems: "center",
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
    padding: "8px 12px",
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

// Long-form / markdown editor wrapper — visible toolbar with the production
// MarkdownToggleButton so non-technical users have an obvious "Preview" /
// "Edit raw" affordance instead of relying on Lexical defaults.
const longFormWrapStyle = {
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
    border: "1px solid rgba(5, 23, 41, 0.12)",
    borderRadius: 6,
    background: "white",
    overflow: "hidden" as const,
}

const longFormToolbarStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between" as const,
    padding: "4px 8px",
    background: "#fafafa",
    borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
}

const longFormHintStyle = {
    fontSize: 10,
    fontWeight: 600,
    color: "rgba(5, 23, 41, 0.55)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
}

const parsedHintStyle = {
    fontSize: 11,
    color: "rgba(5, 23, 41, 0.55)",
    fontStyle: "italic" as const,
    padding: "0 4px 6px",
    borderBottom: "1px dashed rgba(5, 23, 41, 0.08)",
    marginBottom: 6,
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

const nestedBody = {
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    background: "white",
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
