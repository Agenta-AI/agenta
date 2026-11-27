import {useEffect, useState} from "react"

import {inferPrimitiveFromText} from "@agenta/entity-ui/testcase"
import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import editorCatalog from "@agenta/i18n/catalogs/testsets.testcaseEditor"
import {Button} from "@agenta/ui/ui"
import {CaretDown} from "@phosphor-icons/react"

type Record_ = Record<string, unknown>

const isRecord = (value: unknown): value is Record_ =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const setAt = (value: Record_, path: string[], next: unknown): Record_ => {
    const [key, ...rest] = path
    return {...value, [key]: rest.length === 0 ? next : setAt(value[key] as Record_, rest, next)}
}

/** A leaf keeps its type: a number or a boolean stays one while it reads as one. */
const leafFromText = (text: string, before: unknown) =>
    typeof before === "number" || typeof before === "boolean" ? inferPrimitiveFromText(text) : text

const INPUT =
    "-ml-2 block h-6.5 w-[calc(100%+8px)] rounded-md border border-transparent bg-transparent px-1.75 text-body text-foreground tabular-nums outline-none hover:border-border focus:border-border-strong focus:bg-background"

/** A list inside an object edits as JSON text; the text reaches the value when it parses. */
const ListLeaf = ({
    label,
    value,
    onChange,
}: {
    label: string
    value: unknown
    onChange?: (next: unknown) => void
}) => {
    const [text, setText] = useState(() => JSON.stringify(value))
    useEffect(() => {
        setText((current) => {
            try {
                if (JSON.stringify(JSON.parse(current)) === JSON.stringify(value)) return current
            } catch {
                // Typed text that does not parse stays while the value is unchanged.
            }
            return JSON.stringify(value)
        })
    }, [value])
    return (
        <input
            aria-label={label}
            value={text}
            readOnly={!onChange}
            className={`${INPUT} font-mono text-meta`}
            onChange={(event) => {
                setText(event.target.value)
                try {
                    onChange?.(JSON.parse(event.target.value))
                } catch {
                    // Not valid yet: the value keeps its last valid list.
                }
            }}
        />
    )
}

interface RowsProps {
    value: Record_
    path: string[]
    depth: number
    folded: Set<string>
    onToggle: (key: string) => void
    onChange?: (path: string[], next: unknown) => void
}

const Rows = ({value, path, depth, folded, onToggle, onChange}: RowsProps) => {
    const tv = useT(valueViewCatalog)
    return (
        <>
            {Object.entries(value).map(([key, item]) => {
                const itemPath = [...path, key]
                const id = itemPath.join("\u0000")
                const indent = {gridTemplateColumns: `${depth * 12}px 140px minmax(0, 1fr)`}
                if (isRecord(item)) {
                    const isFolded = folded.has(id)
                    const count = Object.keys(item).length
                    return (
                        <div key={id} role="group" aria-label={key}>
                            <div
                                className="grid min-h-8 items-center gap-2 border-b border-border-muted"
                                style={indent}
                            >
                                <span />
                                <span className="inline-flex min-w-0 items-center gap-1 font-mono text-meta text-muted-foreground">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label={key}
                                        aria-expanded={!isFolded}
                                        className="-ml-1 text-muted-foreground"
                                        onClick={() => onToggle(id)}
                                    >
                                        <CaretDown
                                            size={10}
                                            aria-hidden
                                            className={isFolded ? "-rotate-90" : undefined}
                                        />
                                    </Button>
                                    <span className="truncate">{key}</span>
                                </span>
                                <span className="text-meta text-muted-foreground">
                                    {tv("chat.valueView.fields", {count})}
                                </span>
                            </div>
                            {isFolded ? null : (
                                <Rows
                                    value={item}
                                    path={itemPath}
                                    depth={depth + 1}
                                    folded={folded}
                                    onToggle={onToggle}
                                    onChange={onChange}
                                />
                            )}
                        </div>
                    )
                }
                const change = onChange ? (next: unknown) => onChange(itemPath, next) : undefined
                return (
                    <div
                        key={id}
                        className="grid min-h-8 items-center gap-2 border-b border-border-muted"
                        style={indent}
                    >
                        <span />
                        <span
                            className="truncate font-mono text-meta text-muted-foreground"
                            title={key}
                        >
                            {key}
                        </span>
                        {Array.isArray(item) ? (
                            <ListLeaf label={key} value={item} onChange={change} />
                        ) : (
                            <input
                                aria-label={key}
                                value={item === null || item === undefined ? "" : String(item)}
                                readOnly={!change}
                                className={`${INPUT} ${typeof item === "number" ? "text-right" : ""}`}
                                onChange={(event) =>
                                    change?.(leafFromText(event.target.value, item))
                                }
                            />
                        )}
                    </div>
                )
            })}
        </>
    )
}

/**
 * An object as key rows: nested objects fold per key with their field count, a leaf is an inline
 * input that keeps its type, and "Add key" adds an empty key at the top level.
 */
export const KeyRowsField = ({
    value,
    collapseSignal,
    onChange,
}: {
    value: Record_
    collapseSignal: number
    onChange?: (next: Record_) => void
}) => {
    const t = useT(editorCatalog)
    const [folded, setFolded] = useState<Set<string>>(new Set())
    const [adding, setAdding] = useState(false)
    // "Collapse all" folds every nested object.
    useEffect(() => {
        if (collapseSignal === 0) return
        const all = new Set<string>()
        const walk = (item: Record_, path: string[]) => {
            for (const [key, child] of Object.entries(item)) {
                if (!isRecord(child)) continue
                all.add([...path, key].join("\u0000"))
                walk(child, [...path, key])
            }
        }
        walk(value, [])
        setFolded(all)
        // Only a new signal folds; a value change keeps what the user opened.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collapseSignal])

    const toggle = (id: string) =>
        setFolded((current) => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })

    return (
        <div className="flex flex-col">
            <div className="border-t border-border-muted">
                <Rows
                    value={value}
                    path={[]}
                    depth={0}
                    folded={folded}
                    onToggle={toggle}
                    onChange={
                        onChange ? (path, next) => onChange(setAt(value, path, next)) : undefined
                    }
                />
            </div>
            {onChange ? (
                <div className="mt-1.5 flex items-center gap-1">
                    {adding ? (
                        <input
                            autoFocus
                            aria-label={t("testsets.testcaseEditor.newKey")}
                            placeholder={t("testsets.testcaseEditor.newKey")}
                            className="h-6 w-45 rounded-sm border border-border-strong bg-background px-1.5 font-mono text-meta outline-none"
                            onBlur={() => setAdding(false)}
                            onKeyDown={(event) => {
                                if (event.key === "Escape") setAdding(false)
                                if (event.key !== "Enter") return
                                const key = event.currentTarget.value.trim()
                                if (!key || Object.hasOwn(value, key)) return
                                onChange({...value, [key]: ""})
                                setAdding(false)
                            }}
                        />
                    ) : (
                        <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            className="border-dashed text-muted-foreground"
                            onClick={() => setAdding(true)}
                        >
                            + {t("testsets.testcaseEditor.addKey")}
                        </Button>
                    )}
                </div>
            ) : null}
        </div>
    )
}
