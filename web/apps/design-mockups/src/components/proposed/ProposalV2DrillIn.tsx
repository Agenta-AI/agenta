/**
 * ProposalV2DrillIn — the v2 design candidate for the testcase drawer.
 *
 * Each top-level field is its own section. The header shows
 *   - the field name on the left + a small kind chip (string / boolean /
 *     object / chat — no key counts), and
 *   - a single `View as ▾` dropdown on the right (replaces the row of
 *     icons we had before: drill-in chevron, copy button, raw toggle, etc.).
 *
 * The dropdown lets the user pick how the value is rendered; available
 * options come from `getViewOptions(value)`. JSON / YAML are always
 * available; Text / Markdown for strings; Chat for messages; Form for
 * objects.
 *
 * State: the drawer owns the data state. Each view receives `value` and
 * `onChange`; edits in the JSON / YAML / Form / Chat / Markdown / Text view
 * propagate up so view-switching shows the user's latest data.
 */

import {useCallback, useMemo, useState} from "react"

import {ChatMessageList} from "@agenta/ui/chat-message"
import type {SimpleChatMessage} from "@agenta/shared/types"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {Tag} from "antd"
import {dump as yamlDump, load as yamlLoad} from "js-yaml"

import {ProposalV2FormView} from "./ProposalV2FormView"
import {ProposalV2ViewTypeSelect} from "./ProposalV2ViewTypeSelect"
import {
    detectFieldKind,
    getDefaultViewForValue,
    getViewOptions,
    type ProposalV2FieldKind,
    type ProposalV2ViewType,
} from "./proposalV2Views"

interface ProposalV2DrillInProps {
    data: Record<string, unknown>
    editable?: boolean
    /** Optional outward notification when the user edits anything. */
    onChange?: (next: Record<string, unknown>) => void
}

export function ProposalV2DrillIn({
    data: initialData,
    editable = true,
    onChange,
}: ProposalV2DrillInProps) {
    const [data, setData] = useState<Record<string, unknown>>(initialData)

    const updateField = useCallback(
        (key: string, next: unknown) => {
            setData((prev) => {
                const updated = {...prev, [key]: next}
                onChange?.(updated)
                return updated
            })
        },
        [onChange],
    )

    return (
        <div className="proposal-v2-editor" style={styles.root}>
            {Object.keys(data).map((key) => (
                <FieldSection
                    key={key}
                    name={key}
                    value={data[key]}
                    onChange={(next) => updateField(key, next)}
                    editable={editable}
                />
            ))}
        </div>
    )
}

interface FieldSectionProps {
    name: string
    value: unknown
    onChange: (next: unknown) => void
    editable: boolean
}

function FieldSection({name, value, onChange, editable}: FieldSectionProps) {
    const options = useMemo(() => getViewOptions(value), [value])
    const [view, setView] = useState<ProposalV2ViewType>(() => getDefaultViewForValue(value))
    const kind = useMemo(() => detectFieldKind(value), [value])

    // The Form view fills its container — every child has its own framing
    // (label + leaf card + rail). Side padding on the section body would
    // cut into the form's effective width, so we drop it in form mode and
    // only keep a small vertical breathing room.
    const bodyStyle =
        view === "form" ? {...styles.sectionBody, ...styles.sectionBodyForm} : styles.sectionBody

    return (
        <section style={styles.section}>
            <header style={styles.sectionHeader}>
                <div style={styles.sectionTitle}>
                    <span style={styles.fieldName}>{name}</span>
                    <KindChip kind={kind} />
                </div>
                <ProposalV2ViewTypeSelect value={view} options={options} onChange={setView} />
            </header>
            <div style={bodyStyle}>
                <ViewBody view={view} value={value} onChange={onChange} editable={editable} />
            </div>
        </section>
    )
}

const KIND_LABEL: Record<ProposalV2FieldKind, string> = {
    string: "string",
    boolean: "boolean",
    object: "object",
    chat: "chat",
}

const KIND_TONE: Record<ProposalV2FieldKind, string> = {
    string: "geekblue",
    boolean: "purple",
    object: "gold",
    chat: "cyan",
}

function KindChip({kind}: {kind: ProposalV2FieldKind}) {
    return (
        <Tag color={KIND_TONE[kind]} style={styles.kindChip} variant="filled">
            {KIND_LABEL[kind]}
        </Tag>
    )
}

interface ViewBodyProps {
    view: ProposalV2ViewType
    value: unknown
    onChange: (next: unknown) => void
    editable: boolean
}

function ViewBody({view, value, onChange, editable}: ViewBodyProps) {
    if (view === "text") return <TextView value={value} onChange={onChange} editable={editable} />
    if (view === "markdown")
        return <MarkdownView value={value} onChange={onChange} editable={editable} />
    if (view === "chat") return <ChatView value={value} onChange={onChange} editable={editable} />
    if (view === "form")
        return (
            <ProposalV2FormView
                value={value as Record<string, unknown>}
                onChange={onChange}
                editable={editable}
            />
        )
    if (view === "json") return <JsonView value={value} onChange={onChange} editable={editable} />
    if (view === "yaml") return <YamlView value={value} onChange={onChange} editable={editable} />
    return null
}

/* ── Text view ──────────────────────────────────────────────────────────
   Use SharedEditor (production component) so the text reads in the same
   "card with editor inside" style as the rest of the app. Plain text mode,
   no line numbers. Falls back to a string representation for non-string
   values (e.g. `true`, `42`, `null`). */

function TextView({
    value,
    onChange,
    editable,
}: {
    value: unknown
    onChange: (next: unknown) => void
    editable: boolean
}) {
    const text = useMemo(() => stringifyForText(value), [value])
    const handleChange = useCallback(
        (next: string) => {
            // For non-string source values, only persist if the edit still
            // parses cleanly back to the original primitive type. Otherwise
            // the type-switch is one-way: editing forces it to a string.
            if (typeof value === "boolean") {
                if (next === "true") onChange(true)
                else if (next === "false") onChange(false)
                else onChange(next)
                return
            }
            if (typeof value === "number") {
                const n = Number(next)
                if (!Number.isNaN(n) && next.trim() !== "") onChange(n)
                else onChange(next)
                return
            }
            onChange(next)
        },
        [value, onChange],
    )
    return (
        <SharedEditor
            key={`text-${typeof value}-${text.length}`}
            initialValue={text}
            handleChange={editable ? handleChange : undefined}
            editorType="border"
            className="min-h-[80px] overflow-hidden"
            disableDebounce
            disabled={!editable}
            state={editable ? undefined : "readOnly"}
            editorProps={{
                showLineNumbers: false,
                showToolbar: false,
                disableLongText: true,
            }}
        />
    )
}

function stringifyForText(value: unknown): string {
    if (value === null) return "null"
    if (value === undefined) return ""
    if (typeof value === "string") return value
    return JSON.stringify(value, null, 2)
}

/* ── Markdown view ────────────────────────────────────────────────────── */

function MarkdownView({
    value,
    onChange,
    editable,
}: {
    value: unknown
    onChange: (next: unknown) => void
    editable: boolean
}) {
    const text = typeof value === "string" ? value : String(value ?? "")
    return (
        <SharedEditor
            key={`md-${text.length}`}
            initialValue={text}
            handleChange={editable ? (next: string) => onChange(next) : undefined}
            editorType="border"
            className="min-h-[120px] overflow-hidden"
            disableDebounce
            disabled={!editable}
            state={editable ? undefined : "readOnly"}
            editorProps={{
                language: "markdown",
                showToolbar: false,
                showLineNumbers: false,
            }}
        />
    )
}

/* ── Chat view ──────────────────────────────────────────────────────────
   Uses the production ChatMessageList. Editable. Tool-call cards, role
   selection, copy buttons all come from there. */

function ChatView({
    value,
    onChange,
    editable,
}: {
    value: unknown
    onChange: (next: unknown) => void
    editable: boolean
}) {
    const messages = useMemo<SimpleChatMessage[]>(() => {
        if (!Array.isArray(value)) return []
        return value as SimpleChatMessage[]
    }, [value])
    return (
        <div style={styles.chatWrap}>
            <ChatMessageList
                messages={messages}
                onChange={(next) => onChange(next)}
                disabled={!editable}
                showControls={editable}
                showCopyButton
                allowFileUpload={false}
                loadingFallback="static"
            />
        </div>
    )
}

/* ── JSON view ──────────────────────────────────────────────────────────
   Editable. We keep the raw text in local state so partial edits don't
   throw the value back to the parent. When the text parses as JSON we
   propagate. */

function JsonView({
    value,
    onChange,
    editable,
}: {
    value: unknown
    onChange: (next: unknown) => void
    editable: boolean
}) {
    const initialText = useMemo(() => {
        try {
            return JSON.stringify(value, null, 2)
        } catch {
            return String(value)
        }
    }, [value])

    const handleChange = useCallback(
        (next: string) => {
            try {
                const parsed = JSON.parse(next)
                onChange(parsed)
            } catch {
                // ignore — invalid JSON, don't propagate
            }
        },
        [onChange],
    )

    return (
        <SharedEditor
            key={`json-${initialText.length}`}
            initialValue={initialText}
            handleChange={editable ? handleChange : undefined}
            editorType="border"
            className="min-h-[120px] overflow-hidden"
            disableDebounce
            disabled={!editable}
            state={editable ? undefined : "readOnly"}
            editorProps={{
                codeOnly: true,
                language: "json",
                showLineNumbers: true,
                showToolbar: false,
            }}
        />
    )
}

/* ── YAML view ──────────────────────────────────────────────────────── */

function YamlView({
    value,
    onChange,
    editable,
}: {
    value: unknown
    onChange: (next: unknown) => void
    editable: boolean
}) {
    const initialText = useMemo(() => {
        try {
            return yamlDump(value, {
                noCompatMode: true,
                lineWidth: 100,
                quotingType: '"',
            })
        } catch {
            return String(value)
        }
    }, [value])

    const handleChange = useCallback(
        (next: string) => {
            try {
                const parsed = yamlLoad(next)
                onChange(parsed)
            } catch {
                // ignore — invalid YAML, don't propagate
            }
        },
        [onChange],
    )

    return (
        <SharedEditor
            key={`yaml-${initialText.length}`}
            initialValue={initialText}
            handleChange={editable ? handleChange : undefined}
            editorType="border"
            className="min-h-[120px] overflow-hidden"
            disableDebounce
            disabled={!editable}
            state={editable ? undefined : "readOnly"}
            editorProps={{
                codeOnly: true,
                language: "yaml",
                showLineNumbers: true,
                showToolbar: false,
            }}
        />
    )
}

/* ── Styles ─────────────────────────────────────────────────────────── */

const styles = {
    root: {
        // Flat list of fields. No outer padding so the field header (which
        // spans the parent width edge-to-edge) lines up with the drawer
        // chrome above.
        display: "flex",
        flexDirection: "column" as const,
    },
    section: {
        // No card chrome around each variable — fields are flat rows in a
        // shared list, separated by a thin divider. The drawer surface
        // already gives us the outer card.
        background: "white",
        borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
    },
    sectionHeader: {
        // Edge-to-edge — the header fills the available width. Horizontal
        // padding lines up with the field body below so labels and values
        // share the same gutter.
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 20px",
        background: "white",
    },
    sectionTitle: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        minWidth: 0,
    },
    fieldName: {
        fontSize: 14,
        fontWeight: 600,
        color: "#051729",
        whiteSpace: "nowrap" as const,
        overflow: "hidden" as const,
        textOverflow: "ellipsis" as const,
    },
    kindChip: {
        fontSize: 10,
        marginInlineEnd: 0,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    sectionBody: {
        // Generous horizontal padding so values aren't crowded against the
        // drawer edge. The body sits flush under the header — no extra
        // border or background; the field's own widget(s) carry whatever
        // chrome they need.
        padding: "0 20px 16px 20px",
        background: "white",
    },
    sectionBodyForm: {
        // Form view manages its own internal layout; drop the section's
        // horizontal padding so the form's leaf cards / nested rails fit
        // the parent container exactly.
        padding: "0 0 16px 0",
    },
    chatWrap: {
        // Give the production chat list room to breathe; ChatMessageList
        // ships with its own container chrome so we just provide vertical
        // gutter.
        display: "flex",
        flexDirection: "column" as const,
        gap: 8,
    },
}

export default ProposalV2DrillIn
