/**
 * ProductionPlaygroundShell — visual replica of the live Agenta playground.
 *
 * Pins the design conversation to what the user actually sees today: variant
 * selector with revision tag and "Last modified" badge, prompt template card
 * with role-dropdown message cards, generations panel with variable-input
 * rows (blue mono label + hover-revealed action icons) and a response card.
 *
 * Static visual replica — no business logic, no state. The mockup pages
 * compose this shell with custom inputs/messages/output/testcaseBody to
 * exercise specific design proposals.
 */

import {useLayoutEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {
    CaretDown,
    CaretUpDown,
    Cloud,
    Copy,
    Database,
    DotsThreeVertical,
    Files,
    Flask,
    Lightning,
    ListBullets,
    MagicWand,
    MinusCircle,
    Plus,
    Play,
    Sparkle,
    TestTube,
    TreeStructure,
} from "@phosphor-icons/react"
import {Dropdown, Popover} from "antd"

interface PromptMessage {
    role: "System" | "User" | "Assistant" | "Tool"
    /**
     * Either a plain string (with `{{var}}` tokens detected and highlighted)
     * or a ReactNode for rich rendering (e.g. invalid-variable tooltips).
     */
    body: string | ReactNode
}

type VariableType = "string" | "number" | "boolean" | "object" | "array"
type VariableFormat = "string" | "markdown" | "json" | "yaml" | "form"

interface VariableInput {
    name: string
    value?: unknown
    /** Override the inferred top-level type. */
    type?: VariableType
    /** Initial format selection. Defaults to "form" for object/array, "string" otherwise. */
    format?: VariableFormat
}

interface OutputDescriptor {
    /** The displayed assistant response. */
    body?: ReactNode
    /** Score chips shown in the response footer. */
    metrics?: {label: string; value: string; tone?: "ok" | "warn"}[]
    /** Latency in ms, formatted as "N ms" / "N.NN s". */
    latencyMs?: number
    /** Token count chip. */
    tokens?: number
    /** Model label. */
    model?: string
}

interface ProductionPlaygroundShellProps {
    promptVariantLabel?: string
    promptVariantStatus?: "Draft" | "Last modified" | "Latest"
    modelLabel?: string
    promptSyntax?: "Curly" | "Mustache" | "JSONPath"
    outputType?: "Text" | "JSON" | "Markdown"
    messages?: PromptMessage[]
    /**
     * Lifted-state callback for prompt-template message edits. When the
     * page passes both `messages` and `onMessagesChange`, the prompt
     * template runs in controlled mode — body edits in any card flow up
     * here, so the page can derive referenced variables and feed them
     * into the execution-item drill-in.
     */
    onMessagesChange?: (next: PromptMessage[]) => void
    /**
     * Variables list shown in the per-message "+ Variable" popover.
     * Defaults to a canonical set when omitted.
     */
    promptVariables?: string[]
    testcaseLabel?: string
    inputs?: VariableInput[]
    /** Optional override for the body of the testcase row. */
    testcaseBody?: ReactNode
    /**
     * Extra controls injected into the testcase header, between the testcase
     * chip on the left and the existing right-side actions (TreeStructure /
     * Copy / Remove / Run). Use this to surface scoped controls — e.g. when
     * the testcaseBody is a ProposedDrillIn with `hideRootHeader`, the page
     * passes the drill-in's view-mode + collapse-all + copy buttons here so
     * they sit inline with the chrome instead of as an orphaned second row.
     */
    testcaseExtras?: ReactNode
    /** Optional output card rendered after the inputs. */
    output?: OutputDescriptor
    showAddTestcase?: boolean
    /** Hide the page-level top bar (Playground / +Compare). */
    hideTopBar?: boolean
}

interface ProductionPromptTemplateProps {
    modelLabel?: string
    promptSyntax?: "Curly" | "Mustache" | "JSONPath"
    outputType?: "Text" | "JSON" | "Markdown"
    messages?: PromptMessage[]
    /**
     * Controlled mode for message edits. When provided, body changes in any
     * card dispatch via this callback so the parent page can derive
     * referenced variables, drive the execution item, etc. Without this,
     * each MessageCard maintains its own internal state (uncontrolled).
     */
    onMessagesChange?: (next: PromptMessage[]) => void
    /** Optional banner rendered above the message cards (gap-08). */
    banner?: ReactNode
    /**
     * Available variable names a user can insert via the per-message
     * "+ Variable" popover. Defaults to a small canonical set so the
     * mockup feels useful without requiring callers to wire it up.
     */
    variables?: string[]
}

const DEFAULT_VARIABLES = [
    "country",
    "messages",
    "geo",
    "languages",
    "iso_code",
    "input",
    "expected",
    "metadata",
]

const TEMPLATE_TOKEN_RE = /\{\{([^}]+)\}\}/g

function renderTemplate(body: string): React.ReactNode[] {
    const parts: React.ReactNode[] = []
    let last = 0
    let m: RegExpExecArray | null
    while ((m = TEMPLATE_TOKEN_RE.exec(body))) {
        if (m.index > last) parts.push(body.slice(last, m.index))
        parts.push(
            <span key={m.index} style={styles.token}>
                {m[0]}
            </span>,
        )
        last = m.index + m[0].length
    }
    if (last < body.length) parts.push(body.slice(last))
    return parts
}

/**
 * Inline `{{var}}` token — same blue chip the production playground uses for
 * recognized variable references. Use inside a message body ReactNode.
 */
export function ValidVariable({children}: {children: ReactNode}) {
    return <span style={styles.token}>{children}</span>
}

/**
 * Inline `{{var}}` token in error state, with a red-bordered tooltip below.
 * Use inside a message body ReactNode for gap-08 Proposed rendering.
 */
export function InvalidVariable({variable, children}: {variable: string; children: ReactNode}) {
    return (
        <span style={styles.invalidToken}>
            {children}
            <span style={styles.invalidTooltip}>
                <span style={styles.invalidTooltipTitle}>
                    Variable <code>{variable}</code> is not defined in your dataset. You may
                    encounter unexpected results.
                </span>
                <span style={styles.invalidTooltipActions}>
                    <button type="button" style={styles.invalidTooltipAction}>
                        Remove variable
                    </button>
                </span>
            </span>
        </span>
    )
}

/**
 * Variable-insert popover content. Lists available variable names; clicking
 * one calls `onPick` which inserts `{{name}}` at the cursor in the parent
 * MessageCard's textarea.
 */
function VariablePicker({
    variables,
    onPick,
}: {
    variables: string[]
    onPick: (name: string) => void
}) {
    return (
        <div className="flex flex-col gap-0.5 min-w-[180px] max-h-[280px] overflow-auto">
            <div className="text-[11px] uppercase tracking-wide text-[rgba(5,23,41,0.55)] px-2 py-1">
                Insert variable
            </div>
            {variables.map((name) => (
                <button
                    key={name}
                    type="button"
                    onClick={() => onPick(name)}
                    className="text-left px-2 py-1 rounded hover:bg-[rgba(22,119,255,0.08)] border-none bg-transparent cursor-pointer"
                    style={{
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                        fontSize: 12,
                        color: "#1677FF",
                    }}
                >
                    {`{{${name}}}`}
                </button>
            ))}
        </div>
    )
}

/**
 * Body → HTML with `{{var}}` tokens wrapped in styled spans. Tokens are
 * marked `contenteditable="false"` so the browser treats them as atomic —
 * the cursor can sit before / after them but not inside, which avoids the
 * "user types in the middle of a token and breaks the regex match" failure.
 */
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
}

function bodyToHtml(body: string): string {
    if (!body) return ""
    let html = ""
    let last = 0
    const re = new RegExp(TEMPLATE_TOKEN_RE.source, "g")
    let m: RegExpExecArray | null
    while ((m = re.exec(body))) {
        if (m.index > last) html += escapeHtml(body.slice(last, m.index))
        html += `<span class="msg-token" contenteditable="false" data-token="${escapeHtml(m[1])}">${escapeHtml(m[0])}</span>`
        last = m.index + m[0].length
    }
    if (last < body.length) html += escapeHtml(body.slice(last))
    return html
}

/** Char-offset of the caret inside an editable element. */
function getCaretOffset(el: HTMLElement): number {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return 0
    const range = sel.getRangeAt(0)
    if (!el.contains(range.endContainer)) return 0
    const pre = range.cloneRange()
    pre.selectNodeContents(el)
    pre.setEnd(range.endContainer, range.endOffset)
    return pre.toString().length
}

/** Place the caret at the given char-offset inside an editable element. */
function setCaretOffset(el: HTMLElement, offset: number): void {
    let remaining = offset
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node: Node | null = walker.nextNode()
    while (node) {
        const len = node.textContent?.length ?? 0
        if (remaining <= len) {
            const range = document.createRange()
            range.setStart(node, remaining)
            range.collapse(true)
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(range)
            return
        }
        remaining -= len
        node = walker.nextNode()
    }
    // Fallback: place at end
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
}

/**
 * Production message card — role header + always-editable contenteditable
 * body. `{{var}}` tokens render as styled inline spans (atomic via
 * `contenteditable="false"`), so they stay visible AND non-breakable while
 * the user types around them. The "+ Variable" popover inserts a token at
 * the caret. Body state can be lifted to the parent via `body` +
 * `onBodyChange`; otherwise internal state is used.
 */
function MessageCard({
    msg,
    variables,
    body: controlledBody,
    onBodyChange,
}: {
    msg: PromptMessage
    variables: string[]
    body?: string
    onBodyChange?: (next: string) => void
}) {
    const initial = typeof msg.body === "string" ? msg.body : ""
    const [internalBody, setInternalBody] = useState(initial)
    const body = controlledBody ?? internalBody
    const setBody = (next: string) => {
        if (controlledBody === undefined) setInternalBody(next)
        onBodyChange?.(next)
    }

    const ref = useRef<HTMLDivElement>(null)
    // Caret offset to restore after a programmatic rerender (variable
    // insertion or re-tokenization on user typing). Always restored to
    // wherever the caret was before the re-render, so users don't jump
    // when typing turns `{{name}}` into a chip span.
    const restoreOffsetRef = useRef<number | null>(null)

    // Always keep the DOM in sync with `bodyToHtml(body)`. When the user
    // types `{{var}}`, the input handler updates `body` → this effect
    // re-renders the DOM with the new token chip and restores the caret
    // to the same character offset. The expected-HTML check avoids
    // unnecessary innerHTML writes when nothing changed.
    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        const expected = bodyToHtml(body)
        if (el.innerHTML === expected) return
        const wasFocused = document.activeElement === el
        const liveOffset = wasFocused ? getCaretOffset(el) : null
        el.innerHTML = expected
        if (wasFocused) {
            const explicit = restoreOffsetRef.current
            restoreOffsetRef.current = null
            setCaretOffset(el, explicit ?? liveOffset ?? body.length)
        }
    }, [body])

    const onInput = () => {
        const el = ref.current
        if (!el) return
        // textContent gives us the canonical body — token spans contribute
        // their literal `{{name}}` text, plain segments contribute as-is.
        setBody(el.textContent ?? "")
    }

    const insertVariable = (name: string) => {
        const token = `{{${name}}}`
        const el = ref.current
        let next: string
        let cursorAfter: number
        if (el && document.activeElement === el) {
            const offset = getCaretOffset(el)
            next = body.slice(0, offset) + token + body.slice(offset)
            cursorAfter = offset + token.length
        } else {
            const sep = !body || body.endsWith(" ") || body.endsWith("\n") ? "" : " "
            next = body + sep + token
            cursorAfter = next.length
        }
        restoreOffsetRef.current = cursorAfter
        setBody(next)
    }

    return (
        <div className="group/msg relative flex flex-col rounded-lg border border-solid border-[#BDC7D1] bg-white overflow-hidden">
            <header className="flex items-center justify-between gap-2 px-3 pt-2 pb-1.5">
                <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[13px] font-medium capitalize px-1.5 py-0.5 rounded hover:bg-[rgba(0,0,0,0.04)] border-none bg-transparent cursor-pointer"
                >
                    {msg.role.toLowerCase()}
                    <CaretUpDown size={12} className="opacity-60" />
                </button>
                <div className="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                    <Popover
                        trigger="click"
                        placement="bottomLeft"
                        content={<VariablePicker variables={variables} onPick={insertVariable} />}
                    >
                        <button type="button" style={styles.iconBtn} title="Insert variable">
                            <Plus size={14} />
                        </button>
                    </Popover>
                    <button type="button" style={styles.iconBtn} title="Copy">
                        <Copy size={14} />
                    </button>
                    <button type="button" style={styles.iconBtn} title="Remove">
                        <MinusCircle size={14} />
                    </button>
                </div>
            </header>
            <div
                ref={ref}
                contentEditable
                suppressContentEditableWarning
                onInput={onInput}
                className="px-3 pb-3 pt-0 text-[13px] leading-[1.55] text-[#051729] outline-none whitespace-pre-wrap break-words cursor-text"
                style={{minHeight: 24, fontFamily: "inherit"}}
            />
        </div>
    )
}

/**
 * Production Prompt Template card — the inner content of the playground's
 * left panel. Reused by gap-08 so Today and Proposed render the *same* prompt
 * surface; Proposed only adds the banner + invalid-token tooltip on top.
 */
export function ProductionPromptTemplate({
    modelLabel = "gpt-4o-mini",
    promptSyntax = "Curly",
    outputType = "Text",
    messages = [
        {role: "System", body: "You are an expert in geography."},
        {
            role: "User",
            body: "What is the capital of {{country}} ?",
        },
    ],
    banner,
    variables = DEFAULT_VARIABLES,
    onMessagesChange,
}: ProductionPromptTemplateProps) {
    return (
        <div className="flex flex-col gap-2.5 px-3.5 py-3 bg-white">
            <header className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5">
                    <CaretDown size={10} className="text-[rgba(5,23,41,0.55)]" />
                    <span className="text-[13px] font-semibold text-[#051729]">Prompt</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <button type="button" style={styles.iconBtn} title="Suggest">
                        <MagicWand size={14} />
                    </button>
                    <button
                        type="button"
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-solid border-[rgba(5,23,41,0.12)] rounded-md text-[12px] cursor-pointer hover:bg-[rgba(5,23,41,0.02)]"
                    >
                        <Sparkle size={12} className="text-[#1677FF]" />
                        {modelLabel}
                        <CaretDown size={10} className="opacity-60" />
                    </button>
                </span>
            </header>

            {banner ? <div style={styles.banner}>{banner}</div> : null}

            <div className="flex flex-col gap-2">
                {messages.map((msg, i) => (
                    <MessageCard
                        key={i}
                        msg={msg}
                        variables={variables}
                        body={
                            onMessagesChange && typeof msg.body === "string"
                                ? msg.body
                                : undefined
                        }
                        onBodyChange={
                            onMessagesChange
                                ? (next) => {
                                      const updated = messages.map((m, j) =>
                                          j === i ? {...m, body: next} : m,
                                      )
                                      onMessagesChange(updated)
                                  }
                                : undefined
                        }
                    />
                ))}
            </div>

            <footer className="flex items-center flex-wrap gap-1.5 mt-1">
                <button
                    type="button"
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-solid border-[rgba(5,23,41,0.12)] rounded-md text-[12px] cursor-pointer hover:bg-[rgba(5,23,41,0.02)]"
                >
                    <Plus size={12} /> Message
                </button>
                <button
                    type="button"
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-solid border-[rgba(5,23,41,0.12)] rounded-md text-[12px] cursor-pointer hover:bg-[rgba(5,23,41,0.02)]"
                >
                    <Plus size={12} /> Tool
                </button>
                <span className="ml-auto inline-flex items-center gap-1.5">
                    <button
                        type="button"
                        className="inline-flex items-center gap-1 px-2 py-1 bg-transparent border-none rounded text-[12px] text-[rgba(5,23,41,0.65)] cursor-pointer hover:bg-[rgba(0,0,0,0.04)]"
                    >
                        Output: {outputType}
                        <CaretDown size={10} />
                    </button>
                    <button
                        type="button"
                        className="inline-flex items-center gap-1 px-2 py-1 bg-transparent border-none rounded text-[12px] text-[rgba(5,23,41,0.65)] cursor-pointer hover:bg-[rgba(0,0,0,0.04)]"
                    >
                        Syntax: {promptSyntax}
                        <CaretDown size={10} />
                    </button>
                </span>
            </footer>
        </div>
    )
}

function inferType(value: unknown): VariableType {
    if (Array.isArray(value)) return "array"
    if (value === null || value === undefined) return "string"
    if (typeof value === "number") return "number"
    if (typeof value === "boolean") return "boolean"
    if (typeof value === "object") return "object"
    return "string"
}

function isJsonFirst(type: VariableType): boolean {
    return type === "object" || type === "array"
}

function defaultFormatFor(type: VariableType): VariableFormat {
    return isJsonFirst(type) ? "form" : "string"
}

const FORMAT_LABELS: Record<VariableFormat, string> = {
    string: "String",
    markdown: "Markdown",
    json: "JSON",
    yaml: "YAML",
    form: "Form",
}

function getFormatOptions(type: VariableType): VariableFormat[] {
    // All variables: json + yaml. Non-json-first add string + markdown.
    // Json-first (object/array) add form.
    return isJsonFirst(type) ? ["form", "json", "yaml"] : ["string", "markdown", "json", "yaml"]
}

/** Type chip — production-ish small uppercase tag shown next to the variable name. */
function TypeChip({type}: {type: VariableType}) {
    return (
        <span
            className="text-[10px] leading-[16px] uppercase tracking-wide px-1.5 rounded font-mono"
            style={{
                background: "rgba(5,23,41,0.06)",
                color: "rgba(5,23,41,0.65)",
            }}
        >
            {type}
        </span>
    )
}

/** Render an unknown value as YAML. Naive — enough for static mockup. */
function toYaml(value: unknown, indent = 0): string {
    const pad = "  ".repeat(indent)
    if (value === null || value === undefined) return `${pad}~`
    if (typeof value === "string") {
        if (value.includes("\n")) {
            return `|\n${value
                .split("\n")
                .map((l) => `${pad}  ${l}`)
                .join("\n")}`
        }
        return value
    }
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    if (Array.isArray(value)) {
        if (value.length === 0) return "[]"
        return value
            .map((v) => {
                const rendered = toYaml(v, indent + 1)
                if (rendered.includes("\n")) return `${pad}-\n${rendered}`
                return `${pad}- ${rendered}`
            })
            .join("\n")
    }
    if (typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
        if (entries.length === 0) return "{}"
        return entries
            .map(([k, v]) => {
                const rendered = toYaml(v, indent + 1)
                if (rendered.includes("\n")) return `${pad}${k}:\n${rendered}`
                return `${pad}${k}: ${rendered}`
            })
            .join("\n")
    }
    return String(value)
}

/**
 * Recursive form view — rail-based pattern from solutions-drill-in
 * (`ProposalV2FormView`). Each field has a bold label on top and a body
 * below; nested objects/arrays render their children behind a thin 2px
 * gray vertical rail instead of another card. Drops the card-inside-card
 * pattern that the original FormRow used.
 */
function FormView({obj, depth = 0}: {obj: Record<string, unknown>; depth?: number}) {
    const entries = Object.entries(obj)
    if (entries.length === 0) {
        return (
            <span className="text-[12px] italic" style={{color: "#9ca3af"}}>
                (empty object)
            </span>
        )
    }
    return (
        <div className="flex flex-col" style={{gap: depth === 0 ? 16 : 12}}>
            {entries.map(([k, v]) => (
                <FormField key={k} label={k} value={v} depth={depth} />
            ))}
        </div>
    )
}

function FormArray({arr, depth = 0}: {arr: unknown[]; depth?: number}) {
    if (arr.length === 0) {
        return (
            <span className="text-[12px] italic" style={{color: "#9ca3af"}}>
                (empty list)
            </span>
        )
    }
    return (
        <div className="flex flex-col" style={{gap: 12}}>
            {arr.map((item, i) => (
                <FormField key={i} label={String(i)} value={item} depth={depth + 1} />
            ))}
        </div>
    )
}

function FormField({label, value, depth}: {label: string; value: unknown; depth: number}) {
    const subType = inferType(value)
    const labelSize = depth === 0 ? "text-[13px]" : "text-[12px]"
    return (
        <div className="flex flex-col gap-1.5">
            <label
                className={`${labelSize} font-semibold flex items-center gap-1.5`}
                style={{color: "#1f2937"}}
            >
                <span className="font-mono">{label}</span>
                <TypeChip type={subType} />
            </label>
            <FormFieldBody value={value} depth={depth} subType={subType} />
        </div>
    )
}

function FormFieldBody({
    value,
    depth,
    subType,
}: {
    value: unknown
    depth: number
    subType: VariableType
}) {
    if (subType === "object") {
        return (
            <div className="ml-1 pl-4" style={{borderLeft: "2px solid #e5e7eb"}}>
                <FormView obj={value as Record<string, unknown>} depth={depth + 1} />
            </div>
        )
    }
    if (subType === "array") {
        return (
            <div className="ml-1 pl-4" style={{borderLeft: "2px solid #e5e7eb"}}>
                <FormArray arr={value as unknown[]} depth={depth} />
            </div>
        )
    }
    if (subType === "boolean") {
        return (
            <span
                className="inline-flex items-center text-[12px] px-2 py-0.5 rounded font-mono w-fit"
                style={{
                    background: value ? "#f6ffed" : "rgba(5,23,41,0.04)",
                    color: value ? "#389e0d" : "rgba(5,23,41,0.55)",
                    border: `1px solid ${value ? "#b7eb8f" : "rgba(5,23,41,0.08)"}`,
                }}
            >
                {String(value)}
            </span>
        )
    }
    if (subType === "number") {
        return (
            <span className="text-[13px] font-mono" style={{color: "#051729"}}>
                {String(value)}
            </span>
        )
    }
    // string (or null / primitive)
    const display = renderPrimitive(value)
    return (
        <div
            className="text-[13px] leading-[1.5] whitespace-pre-wrap break-words rounded-md px-2.5 py-1.5"
            style={{
                color: display === "Enter a value" ? "rgba(5,23,41,0.35)" : "#051729",
                background: "white",
                border: "1px solid #e5e7eb",
            }}
        >
            {display}
        </div>
    )
}

function renderPrimitive(value: unknown): string {
    if (value === undefined || value === "") return "Enter a value"
    if (value === null) return "null"
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return JSON.stringify(value, null, 2)
}

/** Body renderer — switches representation based on selected format. */
function VariableBody({
    value,
    format,
    type,
}: {
    value: unknown
    format: VariableFormat
    type: VariableType
}) {
    if (value === undefined || value === "") {
        return (
            <div className="text-[13px]" style={{color: "rgba(5,23,41,0.35)", minHeight: 18}}>
                Enter a value
            </div>
        )
    }
    if (format === "string") {
        return (
            <div
                className="text-[13px] leading-[1.5] whitespace-pre-wrap break-words"
                style={{color: "#051729"}}
            >
                {renderPrimitive(value)}
            </div>
        )
    }
    if (format === "markdown") {
        return (
            <div
                className="text-[13px] leading-[1.55] whitespace-pre-wrap break-words"
                style={{color: "#051729", fontStyle: "italic"}}
                title="Markdown preview"
            >
                {renderPrimitive(value)}
            </div>
        )
    }
    if (format === "json") {
        return (
            <pre
                className="text-[12px] leading-[1.45] whitespace-pre-wrap break-words font-mono m-0"
                style={{color: "#051729"}}
            >
                {JSON.stringify(value, null, 2)}
            </pre>
        )
    }
    if (format === "yaml") {
        return (
            <pre
                className="text-[12px] leading-[1.45] whitespace-pre-wrap break-words font-mono m-0"
                style={{color: "#051729"}}
            >
                {toYaml(value)}
            </pre>
        )
    }
    // form
    if (type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
        return <FormView obj={value as Record<string, unknown>} />
    }
    if (type === "array" && Array.isArray(value)) {
        return <FormArray arr={value} depth={-1} />
    }
    return (
        <div
            className="text-[13px] leading-[1.5] whitespace-pre-wrap break-words"
            style={{color: "#051729"}}
        >
            {renderPrimitive(value)}
        </div>
    )
}

/**
 * Variable input row — production look. Blue monospace label, type chip, and
 * a format dropdown (String / Markdown / JSON / YAML / Form) replacing the
 * old markdown-toggle icon. The Database (pick from testset) and Copy icons
 * remain hover-revealed.
 */
function VariableInputRow({input}: {input: VariableInput}) {
    const inferredType = useMemo<VariableType>(
        () => input.type ?? inferType(input.value),
        [input.type, input.value],
    )
    const [format, setFormat] = useState<VariableFormat>(
        input.format ?? defaultFormatFor(inferredType),
    )
    const options = useMemo(() => getFormatOptions(inferredType), [inferredType])
    // Keep the selection valid if the type changes the available options.
    const safeFormat = options.includes(format) ? format : defaultFormatFor(inferredType)

    return (
        <div className="group/item relative flex flex-col gap-1.5 p-[11px] rounded-lg border border-solid border-[#BDC7D1] bg-white">
            <div className="w-full flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-[12px] leading-[20px] font-medium text-[#1677FF] truncate">
                        {input.name}
                    </span>
                    <TypeChip type={inferredType} />
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                    <div className="flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity">
                        <button type="button" style={styles.iconBtn} title="Pick from testset">
                            <Database size={14} />
                        </button>
                        <button type="button" style={styles.iconBtn} title="Copy">
                            <Copy size={14} />
                        </button>
                    </div>
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: options.map((opt) => ({
                                key: opt,
                                label: FORMAT_LABELS[opt],
                            })),
                            selectedKeys: [safeFormat],
                            onClick: ({key}) => setFormat(key as VariableFormat),
                        }}
                    >
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 text-[12px] px-1.5 py-0.5 rounded hover:bg-[rgba(0,0,0,0.04)] border-none bg-transparent cursor-pointer"
                            style={{color: "rgba(5,23,41,0.65)"}}
                        >
                            {FORMAT_LABELS[safeFormat]}
                            <CaretUpDown size={12} className="opacity-60" />
                        </button>
                    </Dropdown>
                </div>
            </div>
            <VariableBody value={input.value} format={safeFormat} type={inferredType} />
        </div>
    )
}

/**
 * Output card — production NodeResultCard look: name + version + status
 * header, body with response text, and a footer row with latency / tokens /
 * model chips. Score chips render inline with the header.
 */
function OutputCard({output, variantLabel}: {output: OutputDescriptor; variantLabel: string}) {
    return (
        <div className="flex flex-col gap-2 pt-3 border-0 border-t border-solid border-[rgba(5,23,41,0.06)]">
            <header className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1.5 min-w-0">
                    <span className="text-[13px] font-semibold text-[#051729] truncate">
                        {variantLabel}
                    </span>
                    <span
                        className="text-[11px] px-1.5 rounded"
                        style={{
                            background: "rgba(5,23,41,0.06)",
                            color: "rgba(5,23,41,0.65)",
                        }}
                    >
                        v2
                    </span>
                </div>
                <div className="inline-flex items-center gap-1">
                    {(output.metrics ?? []).map((m) => (
                        <span
                            key={m.label}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px]"
                            style={{
                                background: m.tone === "warn" ? "#fff7e6" : "#f6ffed",
                                color: m.tone === "warn" ? "#d46b08" : "#389e0d",
                                border:
                                    m.tone === "warn" ? "1px solid #ffd591" : "1px solid #b7eb8f",
                            }}
                        >
                            {m.label} {m.value}
                        </span>
                    ))}
                </div>
            </header>
            <div className="text-[13px] leading-[1.55] text-[#051729] whitespace-pre-wrap">
                {output.body}
            </div>
            <footer className="flex items-center gap-2 mt-1">
                {output.latencyMs !== undefined ? (
                    <span style={styles.metaChip}>
                        <Lightning size={11} />
                        {output.latencyMs >= 1000
                            ? `${(output.latencyMs / 1000).toFixed(2)} s`
                            : `${output.latencyMs} ms`}
                    </span>
                ) : null}
                {output.tokens !== undefined ? (
                    <span style={styles.metaChip}>{output.tokens} tokens</span>
                ) : null}
                {output.model ? <span style={styles.metaChip}>{output.model}</span> : null}
            </footer>
        </div>
    )
}

export function ProductionPlaygroundShell({
    promptVariantLabel = "default",
    promptVariantStatus = "Last modified",
    modelLabel = "gpt-4o-mini",
    promptSyntax = "Curly",
    outputType = "Text",
    messages = [
        {role: "System", body: "You are an expert in geography."},
        {
            role: "User",
            body: "What is the capital of {{country}} ?",
        },
    ],
    onMessagesChange,
    promptVariables,
    testcaseLabel = "testcase 1",
    inputs = [{name: "country"}, {name: "messages"}],
    testcaseBody,
    testcaseExtras,
    output,
    showAddTestcase = true,
    hideTopBar,
}: ProductionPlaygroundShellProps) {
    const statusTone = promptVariantStatus === "Draft" ? "draft" : "latest"
    return (
        <div style={styles.shell}>
            {!hideTopBar ? (
                <header style={styles.topBar}>
                    <h1 style={styles.title}>Playground</h1>
                    <div style={styles.topActions}>
                        <button type="button" style={styles.linkAction}>
                            <Flask size={14} className="text-[rgba(5,23,41,0.55)]" />
                            New Evaluation
                        </button>
                        <button type="button" style={styles.dropdown}>
                            <TestTube size={12} />
                            Evaluator
                            <CaretDown size={10} />
                        </button>
                        <button type="button" style={styles.dropdown}>
                            <Database size={12} />
                            Test set
                            <CaretDown size={10} />
                        </button>
                        <button type="button" style={styles.compareAction}>
                            <Plus size={12} />
                            Compare
                        </button>
                    </div>
                </header>
            ) : null}

            <div style={styles.split}>
                {/* LEFT panel — Prompt template config */}
                <section style={styles.leftPanel}>
                    <header style={styles.panelHeader}>
                        <div className="flex items-center gap-2 grow min-w-0 overflow-hidden">
                            <button
                                type="button"
                                className="inline-flex items-center justify-between gap-1 px-2 py-1 bg-white border border-solid border-[rgba(5,23,41,0.12)] rounded-md text-[12px] cursor-pointer min-w-[110px]"
                                title="Switch variant"
                            >
                                <span className="truncate">{promptVariantLabel}</span>
                                <CaretDown size={10} className="opacity-60" />
                            </button>
                            <span
                                className="text-[11px] px-1.5 py-px rounded"
                                style={{
                                    background: "rgba(5,23,41,0.06)",
                                    color: "rgba(5,23,41,0.65)",
                                }}
                            >
                                v2
                            </span>
                            <span
                                className="text-[11px] px-2 py-px rounded"
                                style={
                                    statusTone === "draft"
                                        ? {background: "#fff7e6", color: "#d46b08"}
                                        : {background: "#E6F4FF", color: "#1677FF"}
                                }
                            >
                                {promptVariantStatus}
                            </span>
                        </div>
                        <div className="inline-flex items-center gap-1.5 shrink-0">
                            <button
                                type="button"
                                className="inline-flex items-center gap-1 px-2 py-1 bg-transparent border-none rounded text-[12px] cursor-pointer hover:bg-[rgba(0,0,0,0.04)]"
                                title="View mode"
                            >
                                Form
                                <CaretDown size={10} />
                            </button>
                            <button type="button" style={styles.iconBtn} title="Deploy">
                                <Cloud size={14} />
                            </button>
                            <button
                                type="button"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium cursor-pointer border-none"
                                style={{background: "#051729", color: "white"}}
                            >
                                Commit
                            </button>
                            <button type="button" style={styles.iconBtn} title="More">
                                <DotsThreeVertical size={14} />
                            </button>
                        </div>
                    </header>

                    <ProductionPromptTemplate
                        modelLabel={modelLabel}
                        promptSyntax={promptSyntax}
                        outputType={outputType}
                        messages={messages}
                        onMessagesChange={onMessagesChange}
                        variables={promptVariables}
                    />
                </section>

                {/* RIGHT panel — Generations */}
                <section style={styles.rightPanel}>
                    <header style={styles.panelHeader}>
                        <div className="inline-flex items-center gap-2">
                            <ListBullets size={14} className="text-[rgba(5,23,41,0.55)]" />
                            <span className="text-[14px] font-semibold text-[#051729]">
                                Generations
                            </span>
                        </div>
                        <div className="inline-flex items-center gap-1.5">
                            <button
                                type="button"
                                className="inline-flex items-center gap-1 px-2 py-1 bg-transparent border-none rounded text-[12px] text-[rgba(5,23,41,0.65)] cursor-pointer hover:bg-[rgba(0,0,0,0.04)]"
                            >
                                Clear
                            </button>
                            <button
                                type="button"
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-medium cursor-pointer border-none"
                                style={{background: "#051729", color: "white"}}
                            >
                                <Play size={12} weight="fill" />
                                Run all
                            </button>
                        </div>
                    </header>

                    <div className="flex flex-col gap-2.5 px-3.5 py-3">
                        <div className="flex flex-col gap-2 rounded-lg border border-solid border-[rgba(5,23,41,0.06)] bg-white p-3">
                            <header className="flex items-center justify-between gap-2">
                                <span className="inline-flex items-center gap-1.5 min-w-0">
                                    <CaretDown size={10} className="text-[rgba(5,23,41,0.55)]" />
                                    <span
                                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[12px]"
                                        style={{
                                            background: "rgba(5,23,41,0.04)",
                                            border: "1px solid rgba(5,23,41,0.08)",
                                        }}
                                    >
                                        <Database size={12} className="opacity-60" />
                                        {testcaseLabel}
                                    </span>
                                </span>
                                <div className="inline-flex items-center gap-0.5">
                                    {testcaseExtras ? (
                                        <span className="inline-flex items-center gap-1 mr-2 pr-2 border-0 border-r border-solid border-[rgba(5,23,41,0.08)]">
                                            {testcaseExtras}
                                        </span>
                                    ) : null}
                                    <button type="button" style={styles.iconBtn} title="Open">
                                        <TreeStructure size={14} />
                                    </button>
                                    <button type="button" style={styles.iconBtn} title="Duplicate">
                                        <Files size={14} />
                                    </button>
                                    <button type="button" style={styles.iconBtn} title="Remove">
                                        <MinusCircle size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        className="inline-flex items-center gap-1 px-2.5 py-1 ml-1 rounded-md text-[12px] font-medium cursor-pointer border-none"
                                        style={{background: "#051729", color: "white"}}
                                    >
                                        <Play size={11} weight="fill" />
                                        Run
                                    </button>
                                </div>
                            </header>

                            {testcaseBody ?? (
                                <div className="flex flex-col gap-2">
                                    {inputs.map((input) => (
                                        <VariableInputRow key={input.name} input={input} />
                                    ))}
                                </div>
                            )}

                            {output ? (
                                <OutputCard output={output} variantLabel={promptVariantLabel} />
                            ) : null}
                        </div>

                        {showAddTestcase ? (
                            <button
                                type="button"
                                className="inline-flex items-center gap-1.5 self-start px-3 py-1.5 bg-white rounded-md text-[12px] cursor-pointer hover:bg-[rgba(5,23,41,0.02)]"
                                style={{
                                    border: "1px solid rgba(5,23,41,0.12)",
                                    color: "#051729",
                                }}
                            >
                                <Plus size={12} />
                                Test case
                            </button>
                        ) : null}
                    </div>
                </section>
            </div>
        </div>
    )
}

const styles = {
    shell: {
        display: "flex",
        flexDirection: "column" as const,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
        overflow: "hidden" as const,
        fontSize: 13,
        color: "#051729",
    },
    topBar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between" as const,
        padding: "10px 16px",
        background: "white",
        borderBottom: "1px solid rgba(5, 23, 41, 0.08)",
    },
    title: {
        fontSize: 16,
        fontWeight: 700,
        margin: 0,
        color: "#051729",
    },
    topActions: {
        display: "flex",
        alignItems: "center",
        gap: 6,
    },
    linkAction: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        fontSize: 13,
        color: "#051729",
        padding: "4px 8px",
    },
    dropdown: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.12)",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 12,
        color: "#051729",
        padding: "4px 10px",
    },
    compareAction: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.12)",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 500,
        color: "#051729",
        padding: "4px 12px",
    },
    split: {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        gap: 0,
        background: "#f5f7fa",
    },
    leftPanel: {
        display: "flex",
        flexDirection: "column" as const,
        borderRight: "1px solid rgba(5, 23, 41, 0.08)",
        background: "white",
        minWidth: 0,
    },
    rightPanel: {
        display: "flex",
        flexDirection: "column" as const,
        background: "white",
        minWidth: 0,
    },
    panelHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between" as const,
        padding: "8px 12px",
        borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
        background: "white",
        gap: 8,
        height: 48,
        boxSizing: "border-box" as const,
    },
    iconBtn: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center" as const,
        width: 26,
        height: 26,
        background: "transparent",
        border: "1px solid transparent",
        borderRadius: 6,
        cursor: "pointer",
        color: "rgba(5, 23, 41, 0.55)",
    },
    banner: {
        padding: "8px 12px",
        background: "#f0f9ff",
        border: "1px solid rgba(22, 119, 255, 0.25)",
        borderRadius: 6,
        fontSize: 12,
        color: "#0958d9",
        lineHeight: 1.5,
    },
    invalidToken: {
        position: "relative" as const,
        display: "inline-block",
        padding: "0 6px",
        background: "rgba(207, 19, 34, 0.06)",
        color: "#cf1322",
        borderRadius: 3,
        border: "1px dashed #cf1322",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12,
    },
    invalidTooltip: {
        position: "absolute" as const,
        top: "calc(100% + 6px)",
        left: 0,
        zIndex: 2,
        minWidth: 280,
        maxWidth: 360,
        padding: 10,
        background: "white",
        border: "1px solid #cf1322",
        borderRadius: 6,
        boxShadow: "0 4px 12px rgba(207, 19, 34, 0.12)",
        display: "flex",
        flexDirection: "column" as const,
        gap: 8,
        whiteSpace: "normal" as const,
        textAlign: "left" as const,
        color: "#051729",
        fontFamily: "inherit",
    },
    invalidTooltipTitle: {
        fontSize: 12,
        lineHeight: 1.5,
    },
    invalidTooltipActions: {
        display: "flex",
        gap: 8,
    },
    invalidTooltipAction: {
        fontSize: 11,
        fontWeight: 500,
        padding: "3px 10px",
        borderRadius: 4,
        background: "white",
        color: "#cf1322",
        border: "1px solid #cf1322",
        cursor: "pointer" as const,
    },
    token: {
        display: "inline-block",
        padding: "0 6px",
        background: "#e6f4ff",
        color: "#1677ff",
        borderRadius: 3,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12,
    },
    metaChip: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        background: "rgba(5, 23, 41, 0.04)",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 4,
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.65)",
    },
}
