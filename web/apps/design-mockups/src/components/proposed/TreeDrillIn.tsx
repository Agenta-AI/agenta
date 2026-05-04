/**
 * TreeDrillIn — alternative paradigm to ProposedDrillIn (card-stack).
 *
 * Two-pane: compact tree on the left (every key/index with TypeChip), detail
 * editor on the right (form/json/yaml for objects, scalar widget for
 * primitives, chat cards for messages-shaped arrays). Picking the root shows
 * the whole-testcase form; picking `outputs.coordinates.lat` shows just that
 * scalar editor.
 *
 * Surfaced 2026-05-04 by alternative-design exploration. The agent's verdict
 * was that this is the strongest non-card paradigm, with five of eight
 * fixtures benefiting (02/03/06/07/08), and the threshold-fallback hybrid
 * (use card-stack below ~6 leaves OR depth ≥2 OR contains messages) is the
 * real shipping shape rather than pure two-pane.
 *
 * Keyboard: ↑/↓ moves the selection across visible nodes; →/← expands or
 * collapses the focused node; Enter focuses the right-pane editor.
 */

import {useCallback, useMemo, useRef, useState} from "react"
import type {KeyboardEvent} from "react"

import {CaretDown, CaretRight, Copy} from "@phosphor-icons/react"
import {Button, Input, InputNumber, Select, Switch, Tooltip} from "antd"

import {TypeChip, type ChipVariant} from "@/mockups/components/proposed/TypeChip"
import {ChipConversionPopover} from "@/mockups/components/proposed/ChipConversionPopover"

interface TreeDrillInProps {
    data: Record<string, unknown>
    rootTitle?: string
    /** Detect literal-dotted-key collisions and surface chips on the tree row. */
    detectDotKeyCollisions?: boolean
    /** Expand all nodes by default (gap-03 behavior). */
    autoExpand?: boolean
    /** When false, primitive editors render as plain text. Default true. */
    editable?: boolean
}

type Path = (string | number)[]

interface Node {
    key: string // dot-joined path; "" for root
    label: string
    path: Path
    value: unknown
    chips: ChipVariant[]
    children?: Node[]
}

function classifyVariant(v: unknown): ChipVariant {
    if (v === null) return "null"
    if (Array.isArray(v)) {
        const isMessages =
            v.length > 0 &&
            v.every((x) => x && typeof x === "object" && "role" in (x as object))
        return isMessages ? "messages" : "json-array"
    }
    if (typeof v === "object") return "json-object"
    if (typeof v === "number") return "number"
    if (typeof v === "boolean") return "boolean"
    return "string"
}

function setAtPath(root: unknown, path: Path, next: unknown): unknown {
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

function buildTree(
    value: unknown,
    label: string,
    path: Path,
    rootChips: Map<string, ChipVariant[]>,
): Node {
    const variant = classifyVariant(value)
    const chips: ChipVariant[] = [variant]
    if (path.length === 1) {
        const extra = rootChips.get(String(path[0]))
        if (extra) chips.push(...extra)
    }
    const key = path.join(".")
    const node: Node = {key, label, path, value, chips}
    if (variant === "json-object") {
        node.children = Object.entries(value as object).map(([k, v]) =>
            buildTree(v, k, [...path, k], rootChips),
        )
    } else if (variant === "json-array") {
        node.children = (value as unknown[]).map((v, i) =>
            buildTree(v, `[${i}]`, [...path, i], rootChips),
        )
    } else if (variant === "messages") {
        node.children = (value as unknown[]).map((v, i) => {
            const role = (v as {role?: string})?.role ?? "?"
            return buildTree(v, `[${i}] ${role}`, [...path, i], rootChips)
        })
    }
    return node
}

function flattenVisible(root: Node, expanded: Set<string>): Node[] {
    const acc: Node[] = []
    const walk = (n: Node) => {
        acc.push(n)
        if (n.children?.length && expanded.has(n.key)) {
            n.children.forEach(walk)
        }
    }
    walk(root)
    return acc
}

function findNode(root: Node, key: string): Node {
    if (root.key === key) return root
    if (!root.children) return root
    for (const c of root.children) {
        const f = findNodeOrNull(c, key)
        if (f) return f
    }
    return root
}

function findNodeOrNull(node: Node, key: string): Node | null {
    if (node.key === key) return node
    if (!node.children) return null
    for (const c of node.children) {
        const f = findNodeOrNull(c, key)
        if (f) return f
    }
    return null
}

function toYaml(value: unknown, indent = 0): string {
    const pad = "  ".repeat(indent)
    if (value === null) return `${pad}null`
    if (typeof value === "string") {
        return /[:#\n]/.test(value)
            ? `${pad}"${value.replace(/"/g, '\\"')}"`
            : `${pad}${value}`
    }
    if (typeof value === "number" || typeof value === "boolean") return `${pad}${String(value)}`
    if (Array.isArray(value)) {
        if (value.length === 0) return `${pad}[]`
        return value
            .map((item) => {
                if (item !== null && typeof item === "object") {
                    const inner = toYaml(item, indent + 1)
                    const [first, ...rest] = inner.split("\n")
                    return `${pad}- ${first.trimStart()}${rest.length ? "\n" + rest.join("\n") : ""}`
                }
                return `${pad}- ${toYaml(item, 0).trimStart()}`
            })
            .join("\n")
    }
    if (typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
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

function TreeRow({
    node,
    depth,
    selectedKey,
    expanded,
    onSelect,
    onToggle,
}: {
    node: Node
    depth: number
    selectedKey: string
    expanded: Set<string>
    onSelect: (k: string) => void
    onToggle: (k: string) => void
}) {
    const isOpen = expanded.has(node.key)
    const isSelected = selectedKey === node.key
    const hasChildren = !!node.children?.length
    const variant = node.chips[0]
    const extraChips = node.chips.slice(1)
    return (
        <>
            <div
                role="treeitem"
                tabIndex={isSelected ? 0 : -1}
                aria-selected={isSelected}
                aria-expanded={hasChildren ? isOpen : undefined}
                onClick={() => onSelect(node.key)}
                style={{
                    ...rowStyles.row,
                    ...(isSelected ? rowStyles.rowSelected : null),
                    paddingLeft: 6 + depth * 14,
                }}
            >
                {hasChildren ? (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation()
                            onToggle(node.key)
                        }}
                        style={rowStyles.caret}
                        aria-label={isOpen ? "Collapse" : "Expand"}
                    >
                        {isOpen ? <CaretDown size={12} /> : <CaretRight size={12} />}
                    </button>
                ) : (
                    <span style={{width: 12}} />
                )}
                <span style={rowStyles.label} title={node.label}>
                    {node.label}
                </span>
                <TypeChip variant={variant} />
                {extraChips.map((c, i) => (
                    <TypeChip key={`${c}-${i}`} variant={c} />
                ))}
                {hasChildren ? (
                    <span style={rowStyles.count}>
                        {node.children!.length}
                    </span>
                ) : null}
            </div>
            {isOpen &&
                node.children?.map((c) => (
                    <TreeRow
                        key={c.key}
                        node={c}
                        depth={depth + 1}
                        selectedKey={selectedKey}
                        expanded={expanded}
                        onSelect={onSelect}
                        onToggle={onToggle}
                    />
                ))}
        </>
    )
}

function Detail({
    node,
    editable,
    onChange,
}: {
    node: Node
    editable: boolean
    onChange: (path: Path, next: unknown) => void
}) {
    const [view, setView] = useState<"form" | "json" | "yaml">("form")
    const variant = node.chips[0]
    const value = node.value

    if (variant === "string") {
        return (
            <DetailFrame node={node} variant={variant} editable={editable} onChange={onChange}>
                {editable ? (
                    <Input.TextArea
                        value={value as string}
                        onChange={(e) => onChange(node.path, e.target.value)}
                        autoSize={{minRows: 1, maxRows: 12}}
                    />
                ) : (
                    <pre style={detailStyles.pre}>{value as string}</pre>
                )}
            </DetailFrame>
        )
    }
    if (variant === "number") {
        return (
            <DetailFrame node={node} variant={variant} editable={editable} onChange={onChange}>
                {editable ? (
                    <InputNumber
                        value={value as number}
                        onChange={(v) => onChange(node.path, v ?? 0)}
                        style={{width: "100%"}}
                    />
                ) : (
                    <pre style={detailStyles.pre}>{String(value)}</pre>
                )}
            </DetailFrame>
        )
    }
    if (variant === "boolean") {
        return (
            <DetailFrame node={node} variant={variant} editable={editable} onChange={onChange}>
                <div style={detailStyles.booleanRow}>
                    <Switch
                        checked={value as boolean}
                        disabled={!editable}
                        onChange={(c) => onChange(node.path, c)}
                    />
                    <span style={detailStyles.leafText}>{String(value)}</span>
                </div>
            </DetailFrame>
        )
    }
    if (variant === "null") {
        return (
            <DetailFrame node={node} variant={variant} editable={editable} onChange={onChange}>
                <span style={{...detailStyles.leafText, color: "rgba(5, 23, 41, 0.4)"}}>
                    null
                </span>
            </DetailFrame>
        )
    }

    // Object / array / messages — render with a Form / JSON / YAML view-mode toggle.
    return (
        <DetailFrame
            node={node}
            variant={variant}
            editable={editable}
            onChange={onChange}
            toolbar={
                <Select
                    size="small"
                    value={view}
                    onChange={(v) => setView(v as typeof view)}
                    options={[
                        {value: "form", label: "Form"},
                        {value: "json", label: "JSON"},
                        {value: "yaml", label: "YAML"},
                    ]}
                    style={{minWidth: 96}}
                    popupMatchSelectWidth={false}
                />
            }
        >
            {view === "json" && (
                <pre style={detailStyles.pre}>{JSON.stringify(value, null, 2)}</pre>
            )}
            {view === "yaml" && <pre style={detailStyles.pre}>{toYaml(value)}</pre>}
            {view === "form" && variant === "messages" && (
                <div style={detailStyles.messagesBody}>
                    {(value as unknown[]).map((m, i) => {
                        const msg = m as {role?: string; content?: string; tool_calls?: unknown[]}
                        return (
                            <div key={i} style={detailStyles.messageCard}>
                                <div style={detailStyles.messageRole}>{msg.role ?? "?"}</div>
                                {msg.content !== undefined && (
                                    <div style={detailStyles.messageContent}>
                                        {String(msg.content) || (
                                            <em style={{color: "rgba(5,23,41,0.45)"}}>
                                                (empty content)
                                            </em>
                                        )}
                                    </div>
                                )}
                                {Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0 && (
                                    <div style={detailStyles.toolCallsBlock}>
                                        <div style={detailStyles.toolCallsHeader}>
                                            <TypeChip variant="tool" />
                                            <span style={detailStyles.count}>
                                                {msg.tool_calls.length} call
                                                {msg.tool_calls.length === 1 ? "" : "s"}
                                            </span>
                                        </div>
                                        {msg.tool_calls.map((tc, j) => {
                                            const call = tc as {
                                                id?: string
                                                function?: {name?: string; arguments?: string}
                                            }
                                            let parsed: unknown = call.function?.arguments
                                            if (typeof call.function?.arguments === "string") {
                                                try {
                                                    parsed = JSON.parse(call.function.arguments)
                                                } catch {
                                                    parsed = call.function.arguments
                                                }
                                            }
                                            return (
                                                <div key={j} style={detailStyles.toolCallCard}>
                                                    <strong>{call.function?.name ?? "?"}</strong>
                                                    <pre style={detailStyles.toolCallArgs}>
                                                        {JSON.stringify(parsed, null, 2)}
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
            {view === "form" && variant !== "messages" && (
                <div style={detailStyles.subtreeHint}>
                    Pick a child in the tree to edit it. The Form view at this depth is
                    for navigation; <code>JSON</code> / <code>YAML</code> swap to a
                    serialized view of this whole subtree.
                </div>
            )}
        </DetailFrame>
    )
}

function DetailFrame({
    node,
    variant,
    toolbar,
    children,
    editable,
    onChange,
}: {
    node: Node
    variant: ChipVariant
    toolbar?: React.ReactNode
    children: React.ReactNode
    editable: boolean
    onChange: (path: Path, next: unknown) => void
}) {
    const breadcrumb = node.path.length === 0 ? "(root)" : node.path.join(" › ")
    return (
        <div style={detailStyles.frame}>
            <header style={detailStyles.header}>
                <div style={detailStyles.headerLeft}>
                    <span style={detailStyles.breadcrumb}>{breadcrumb}</span>
                    <ChipConversionPopover
                        variant={variant}
                        value={node.value}
                        editable={editable && node.path.length > 0}
                        onConvert={(next) => onChange(node.path, next)}
                    >
                        <TypeChip
                            variant={variant}
                            onClick={
                                editable && node.path.length > 0
                                    ? () => {}
                                    : undefined
                            }
                        />
                    </ChipConversionPopover>
                </div>
                <div style={detailStyles.headerRight}>
                    {toolbar}
                    <Tooltip title="Copy">
                        <Button
                            type="text"
                            size="small"
                            icon={<Copy size={12} />}
                            style={{padding: "0 4px"}}
                        />
                    </Tooltip>
                </div>
            </header>
            <div style={detailStyles.body}>{children}</div>
        </div>
    )
}

export function TreeDrillIn({
    data,
    rootTitle = "Testcase",
    detectDotKeyCollisions = false,
    autoExpand = true,
    editable = true,
}: TreeDrillInProps) {
    const [draft, setDraft] = useState<Record<string, unknown>>(data)

    // Reset draft when source data identity changes
    const dataKey = useMemo(() => JSON.stringify(data), [data])
    const lastKeyRef = useRef(dataKey)
    if (lastKeyRef.current !== dataKey) {
        lastKeyRef.current = dataKey
        setDraft(data)
    }

    const handleChange = useCallback(
        (path: Path, next: unknown) =>
            setDraft((prev) => setAtPath(prev, path, next) as Record<string, unknown>),
        [],
    )

    // Per-root-key collision chips
    const rootChips = useMemo(() => {
        const map = new Map<string, ChipVariant[]>()
        if (!detectDotKeyCollisions) return map
        const keys = Object.keys(draft)
        const dotted = keys.filter((k) => k.includes("."))
        for (const d of dotted) {
            const head = d.split(".")[0]
            if (head in draft && typeof draft[head] === "object" && draft[head] !== null) {
                map.set(d, ["dotted-key", "collision"])
                map.set(head, ["collision"])
            } else {
                map.set(d, ["dotted-key"])
            }
        }
        return map
    }, [draft, detectDotKeyCollisions])

    const root: Node = useMemo(
        () => ({
            key: "",
            label: rootTitle,
            path: [],
            value: draft,
            chips: ["json-object"],
            children: Object.entries(draft).map(([k, v]) =>
                buildTree(v, k, [k], rootChips),
            ),
        }),
        [draft, rootTitle, rootChips],
    )

    const allKeys = useMemo(() => {
        const acc: string[] = []
        const walk = (n: Node) => {
            acc.push(n.key)
            n.children?.forEach(walk)
        }
        walk(root)
        return acc
    }, [root])

    const [expanded, setExpanded] = useState<Set<string>>(
        () => new Set(autoExpand ? allKeys : [""]),
    )
    const [selected, setSelected] = useState<string>("")

    const toggle = useCallback(
        (k: string) =>
            setExpanded((prev) => {
                const next = new Set(prev)
                if (next.has(k)) next.delete(k)
                else next.add(k)
                return next
            }),
        [],
    )

    const visible = useMemo(() => flattenVisible(root, expanded), [root, expanded])
    const selectedNode = findNode(root, selected)

    const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
        const idx = visible.findIndex((n) => n.key === selected)
        if (e.key === "ArrowDown") {
            const next = visible[Math.min(idx + 1, visible.length - 1)]
            if (next) setSelected(next.key)
            e.preventDefault()
        } else if (e.key === "ArrowUp") {
            const next = visible[Math.max(idx - 1, 0)]
            if (next) setSelected(next.key)
            e.preventDefault()
        } else if (e.key === "ArrowRight") {
            if (!expanded.has(selected)) toggle(selected)
            e.preventDefault()
        } else if (e.key === "ArrowLeft") {
            if (expanded.has(selected)) toggle(selected)
            e.preventDefault()
        }
    }

    return (
        <div style={shellStyles.shell}>
            <div
                role="tree"
                tabIndex={0}
                onKeyDown={onKey}
                style={shellStyles.tree}
                aria-label={`${rootTitle} tree`}
            >
                <TreeRow
                    node={root}
                    depth={0}
                    selectedKey={selected}
                    expanded={expanded}
                    onSelect={setSelected}
                    onToggle={toggle}
                />
                <div style={shellStyles.kbHint}>↑/↓ move · →/← expand · click selects</div>
            </div>
            <div style={shellStyles.detail}>
                <Detail node={selectedNode} editable={editable} onChange={handleChange} />
            </div>
        </div>
    )
}

const shellStyles = {
    shell: {
        display: "grid",
        gridTemplateColumns: "240px 1fr",
        gap: 12,
        fontSize: 12,
        color: "#051729",
        height: "100%",
        minHeight: 360,
    },
    tree: {
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
        background: "white",
        padding: 6,
        overflowY: "auto" as const,
        outline: "none",
    },
    detail: {
        minWidth: 0,
        display: "flex",
        flexDirection: "column" as const,
    },
    kbHint: {
        fontSize: 10,
        color: "rgba(5, 23, 41, 0.5)",
        padding: "8px 4px 0",
        borderTop: "1px dashed rgba(5, 23, 41, 0.08)",
        marginTop: 6,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
}

const rowStyles = {
    row: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 6px",
        cursor: "pointer",
        borderRadius: 4,
        whiteSpace: "nowrap" as const,
        overflow: "hidden" as const,
    },
    rowSelected: {
        background: "#e6f4ff",
    },
    caret: {
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: 0,
        display: "inline-flex",
        alignItems: "center",
        color: "rgba(5, 23, 41, 0.65)",
    },
    label: {
        fontWeight: 500,
        color: "#051729",
        flex: 1,
        minWidth: 0,
        overflow: "hidden" as const,
        textOverflow: "ellipsis" as const,
    },
    count: {
        fontSize: 10,
        color: "rgba(5, 23, 41, 0.5)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
}

const detailStyles = {
    frame: {
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
        background: "white",
        display: "flex",
        flexDirection: "column" as const,
        height: "100%",
        minHeight: 360,
        overflow: "hidden" as const,
    },
    header: {
        padding: "8px 12px",
        background: "#FAFAFA",
        borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between" as const,
        gap: 8,
    },
    headerLeft: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flex: 1,
        minWidth: 0,
    },
    headerRight: {
        display: "flex",
        alignItems: "center",
        gap: 6,
    },
    breadcrumb: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.65)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        whiteSpace: "nowrap" as const,
        overflow: "hidden" as const,
        textOverflow: "ellipsis" as const,
        minWidth: 0,
    },
    body: {
        padding: 12,
        overflowY: "auto" as const,
        flex: 1,
    },
    pre: {
        margin: 0,
        padding: 10,
        background: "#fafafa",
        borderRadius: 6,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 11,
        lineHeight: 1.6,
        color: "#051729",
        whiteSpace: "pre-wrap" as const,
        wordBreak: "break-word" as const,
    },
    leafText: {
        fontSize: 12,
        color: "#051729",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    booleanRow: {
        display: "flex",
        alignItems: "center",
        gap: 10,
    },
    subtreeHint: {
        padding: 12,
        background: "#fafafa",
        borderRadius: 6,
        color: "rgba(5, 23, 41, 0.6)",
        fontSize: 12,
        lineHeight: 1.5,
    },
    messagesBody: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 8,
    },
    messageCard: {
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 6,
        padding: 10,
        background: "white",
    },
    messageRole: {
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        color: "#722ed1",
        marginBottom: 6,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    messageContent: {
        fontSize: 12,
        lineHeight: 1.5,
        color: "#051729",
        whiteSpace: "pre-wrap" as const,
    },
    toolCallsBlock: {
        marginTop: 10,
        padding: 8,
        background: "#fafafa",
        borderRadius: 6,
    },
    toolCallsHeader: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 6,
    },
    toolCallCard: {
        background: "white",
        borderRadius: 4,
        padding: 8,
        border: "1px solid rgba(5, 23, 41, 0.06)",
        marginTop: 4,
    },
    toolCallArgs: {
        margin: "6px 0 0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 11,
        lineHeight: 1.5,
        color: "#051729",
        whiteSpace: "pre-wrap" as const,
        wordBreak: "break-word" as const,
    },
    count: {
        fontSize: 10,
        color: "rgba(5, 23, 41, 0.55)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
}

export default TreeDrillIn
