import {useEffect, useState} from "react"

import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import editorCatalog from "@agenta/i18n/catalogs/testsets.testcaseEditor"
import {isPlainObject} from "@agenta/shared/utils"
import {Button} from "@agenta/ui/ui"
import {CaretDown} from "@phosphor-icons/react"

import {CodeErrorLine} from "./CodeErrorLine"
import {useCodeDraft} from "./CodeField"
import {NumberInput, TrueFalseSwitch} from "./ScalarFields"

type Record_ = Record<string, unknown>

const setAt = (value: Record_, path: string[], next: unknown): Record_ => {
    const [key, ...rest] = path
    return {...value, [key]: rest.length === 0 ? next : setAt(value[key] as Record_, rest, next)}
}

const INPUT =
    "-ml-2 block h-6.5 w-[calc(100%+8px)] rounded-md border border-transparent bg-transparent px-1.75 text-body text-foreground tabular-nums outline-none hover:border-border focus:border-border-strong focus:bg-background"

/** A list on one line, for the input. */
const oneLine = (value: unknown) => JSON.stringify(value)

/**
 * A list inside an object edits as JSON text with the code field's draft rules: the text
 * reaches the value when it parses, text that does not parse shows the error line, and the
 * list keeps its last valid value.
 */
const ListLeaf = ({
    label,
    value,
    onChange,
}: {
    label: string
    value: unknown
    onChange?: (next: unknown) => void
}) => {
    const {text, error, onTextChange} = useCodeDraft(
        value,
        "json",
        onChange ? (next) => onChange(next) : undefined,
        oneLine,
    )
    return (
        <span className="flex min-w-0 flex-col">
            <input
                aria-label={label}
                aria-invalid={error !== null}
                value={text}
                readOnly={!onChange}
                className={`${INPUT} font-mono text-meta ${error ? "!border-destructive" : ""}`}
                onChange={(event) => onTextChange(event.target.value)}
            />
            {error ? <CodeErrorLine error={error} format="json" /> : null}
        </span>
    )
}

/**
 * One value of a key row, with the editor of its type: the true / false switch, the number
 * input, or text. The text box keeps line breaks, so a text of several lines stays as it is.
 */
const Leaf = ({
    label,
    value,
    onChange,
}: {
    label: string
    value: unknown
    onChange?: (next: unknown) => void
}) => {
    if (Array.isArray(value)) return <ListLeaf label={label} value={value} onChange={onChange} />
    if (onChange && typeof value === "boolean")
        return <TrueFalseSwitch name={label} value={value} onChange={onChange} />
    if (onChange && typeof value === "number")
        return <NumberInput name={label} value={value} onChange={onChange} />
    return (
        <textarea
            aria-label={label}
            rows={1}
            value={value === null || value === undefined ? "" : String(value)}
            readOnly={!onChange}
            className={`${INPUT} h-auto min-h-6.5 resize-none py-0.75 [field-sizing:content]`}
            onChange={(event) => onChange?.(event.target.value)}
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
                if (isPlainObject(item)) {
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
                        <Leaf label={key} value={item} onChange={change} />
                    </div>
                )
            })}
        </>
    )
}

/**
 * An object as key rows: nested objects fold per key with their field count, a leaf has the
 * editor of its type, and "Add key" adds an empty key at the top level.
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
                if (!isPlainObject(child)) continue
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
