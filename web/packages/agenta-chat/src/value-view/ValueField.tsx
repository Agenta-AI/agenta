import {lazy, Suspense, useId, useMemo, useState} from "react"

import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import {detectValueShape, formatShapeNumber} from "@agenta/shared/utils"
import {ValueCell} from "@agenta/ui/cell-renderers"
import {Badge, Button, cn, Dialog, DialogContent, DialogTitle} from "@agenta/ui/ui"

import ChatMarkdown from "../components/ChatMarkdown"

import {CopyValueButton} from "./CopyValueButton"
import {FieldFold} from "./FieldFold"
import {MessagesValue} from "./MessagesValue"
import {ValueRows} from "./ValueRows"
import {useValueViewOptions} from "./ValueViewProvider"

const ValueFullView = lazy(() =>
    import("./ValueFullView").then((module) => ({default: module.ValueFullView})),
)

/** A list of words shows this many chips before "+N". */
const CHIPS_SHOWN = 10
/** A word longer than this makes a list one item per line instead of chips. */
const CHIP_MAX_CHARS = 40
/** A table of objects shows this many rows before "Show all N". */
const TABLE_ROWS_SHOWN = 5
/** A text longer than this does not fit a table cell, which cannot open. */
const TABLE_CELL_CHARS = 80

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/** A Markdown link, `[label](target)`: a cell draws only its label. */
const MARKDOWN_LINK = /\[[^\]]*\]\([^)\s]+\)/

/**
 * A table cell draws one line of plain text and cannot open, so it holds only short values: no
 * object, no list, no JSON text, no text longer than a cell, no link.
 */
const isCellValue = (value: unknown) => {
    if (typeof value === "object" && value !== null) return false
    if (typeof value !== "string") return true
    return (
        value.length <= TABLE_CELL_CHARS &&
        !value.includes("\n") &&
        !MARKDOWN_LINK.test(value) &&
        !detectValueShape(value).parsedFromText
    )
}

/** Text with aligned columns (a log, a table drawn with spaces) reads in monospace. */
const hasAlignedColumns = (text: string) => {
    const lines = text.split("\n")
    const aligned = lines.filter((line) => /\S(?: {2,}|\t)\S/.test(line)).length
    return aligned >= 3 && aligned * 4 >= lines.length
}

const scalarText = (value: unknown) =>
    typeof value === "number" ? formatShapeNumber(value) : String(value)

const ArrayScalars = ({items, unfolded}: {items: unknown[]; unfolded: boolean}) => {
    const [all, setAll] = useState(unfolded)
    const texts = items.map(scalarText)
    if (texts.some((text) => text.length > CHIP_MAX_CHARS)) {
        return (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {texts.map((text, index) => (
                    <li key={index} className="whitespace-pre-wrap break-words">
                        {text}
                    </li>
                ))}
            </ul>
        )
    }
    const shown = all ? texts : texts.slice(0, CHIPS_SHOWN)
    return (
        <div className="flex flex-wrap items-center gap-1">
            {shown.map((text, index) => (
                <span
                    key={index}
                    className="inline-flex h-5 items-center rounded-sm bg-secondary px-1.5 text-meta font-medium text-foreground"
                >
                    {text}
                </span>
            ))}
            {texts.length > shown.length ? (
                <Button type="button" variant="ghost" size="xs" onClick={() => setAll(true)}>
                    {/* A count, the same in every language. */}
                    {`+${texts.length - shown.length}`}
                </Button>
            ) : null}
        </div>
    )
}

const sharedKeys = (items: Record<string, unknown>[]): string[] | null => {
    const first = Object.keys(items[0] ?? {})
    const same = items.every((item) => {
        const keys = Object.keys(item)
        return keys.length === first.length && keys.every((key) => first.includes(key))
    })
    return same && first.length > 0 ? first : null
}

const ArrayObjects = ({
    items,
    depth,
    unfolded,
    stateKey,
}: {
    items: Record<string, unknown>[]
    depth: number
    unfolded: boolean
    stateKey: string
}) => {
    const t = useT(valueViewCatalog)
    const [all, setAll] = useState(unfolded)
    const keys = useMemo(() => {
        const shared = sharedKeys(items)
        // A nested value in a cell would read only as "N fields", with no way to open it.
        return shared && items.every((item) => shared.every((key) => isCellValue(item[key])))
            ? shared
            : null
    }, [items])
    if (!keys)
        return <ValueRows value={items} depth={depth} unfolded={unfolded} stateKey={stateKey} />
    const rows = all ? items : items.slice(0, TABLE_ROWS_SHOWN)
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <div className="min-w-0 overflow-x-auto rounded-md border border-solid border-border-muted">
                <table className="w-full border-collapse text-left text-body-sm">
                    <thead>
                        <tr className="bg-muted text-meta text-muted-foreground">
                            {keys.map((key) => (
                                <th key={key} scope="col" className="px-2 py-1.5 font-normal">
                                    {key}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((item, index) => (
                            <tr
                                key={index}
                                className="border-0 border-t border-solid border-border-muted"
                            >
                                {keys.map((key) => (
                                    <td key={key} className="max-w-60 px-2 py-1.5">
                                        <ValueCell value={item[key]} />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {items.length > rows.length ? (
                <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="self-start"
                    onClick={() => setAll(true)}
                >
                    {t("chat.valueView.showAllItems", {count: items.length})}
                </Button>
            ) : null}
        </div>
    )
}

export interface ValueBodyProps {
    value: unknown
    /** 0 for the field itself; more inside rows. */
    depth?: number
    /** Draw everything with no fold (the full view). */
    unfolded?: boolean
    /** Keys the open state of long chat turns; unique per field on the screen. */
    stateKey: string
    onOpenFullView?: () => void
}

/** One value drawn by its shape, at any depth of a field. */
export const ValueBody = ({
    value,
    depth = 0,
    unfolded = false,
    stateKey,
    onOpenFullView,
}: ValueBodyProps) => {
    const t = useT(valueViewCatalog)
    const {markdownClassName, markdownIcons} = useValueViewOptions()
    const detected = useMemo(() => detectValueShape(value), [value])
    const drawn = detected.value

    const body = (() => {
        switch (detected.shape) {
            case "empty":
                return (
                    <span className="text-muted-foreground">
                        {value === "" ? t("chat.valueView.emptyText") : "—"}
                    </span>
                )
            case "boolean":
                return <Badge variant={drawn ? "success" : "default"}>{String(drawn)}</Badge>
            case "number":
                return (
                    <span className="tabular-nums">
                        {formatShapeNumber(drawn as number | bigint)}
                    </span>
                )
            case "url":
                return (
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                        <a
                            href={drawn as string}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0 break-all text-link underline"
                        >
                            {drawn as string}
                        </a>
                        <CopyValueButton value={drawn} />
                    </span>
                )
            case "text-short":
                // Up to 12 lines is short text, but a field folds over 8.
                return (
                    <FieldFold
                        text={drawn as string}
                        unfolded={unfolded}
                        onOpenFullView={onOpenFullView}
                    >
                        <div className="whitespace-pre-wrap break-words">{drawn as string}</div>
                    </FieldFold>
                )
            case "text-long": {
                const text = drawn as string
                const mono = hasAlignedColumns(text)
                return (
                    <FieldFold text={text} unfolded={unfolded} onOpenFullView={onOpenFullView}>
                        <div
                            className={cn(
                                "whitespace-pre-wrap break-words",
                                mono &&
                                    "rounded-md border border-solid border-border-muted bg-background px-2.5 py-2 font-mono text-code",
                            )}
                        >
                            {text}
                        </div>
                    </FieldFold>
                )
            }
            case "markdown":
                return (
                    <FieldFold
                        text={drawn as string}
                        unfolded={unfolded}
                        onOpenFullView={onOpenFullView}
                    >
                        <ChatMarkdown
                            content={drawn as string}
                            baseClassName={markdownClassName}
                            icons={markdownIcons}
                        />
                    </FieldFold>
                )
            case "messages":
                return (
                    <MessagesValue
                        messages={drawn as unknown[]}
                        stateKey={stateKey}
                        unfolded={unfolded}
                    />
                )
            case "message":
                return <MessagesValue messages={[drawn]} stateKey={stateKey} unfolded={unfolded} />
            case "array-scalars":
                return <ArrayScalars items={drawn as unknown[]} unfolded={unfolded} />
            case "array-objects":
                return (
                    <ArrayObjects
                        items={drawn as Record<string, unknown>[]}
                        depth={depth}
                        unfolded={unfolded}
                        stateKey={stateKey}
                    />
                )
            case "object-flat":
            case "object-nested": {
                // A single wrapper key ({"output": {...}}) is dropped: its rows are the value.
                const keys = isRecord(drawn) ? Object.keys(drawn) : []
                const inner =
                    keys.length === 1 && depth === 0
                        ? (drawn as Record<string, unknown>)[keys[0]]
                        : null
                const rows =
                    isRecord(inner) && Object.keys(inner).length > 0
                        ? inner
                        : (drawn as Record<string, unknown> | unknown[])
                return (
                    <ValueRows value={rows} depth={depth} unfolded={unfolded} stateKey={stateKey} />
                )
            }
        }
    })()

    if (!detected.parsedFromText) return body
    return (
        <div className="flex min-w-0 flex-col gap-1">
            <span className="text-meta text-muted-foreground">
                {t("chat.valueView.parsedFromText")}
            </span>
            {body}
        </div>
    )
}

export interface ValueFieldProps {
    value: unknown
    /** The field's name: the title of its full view. */
    label?: string
    className?: string
}

/**
 * One stored value as a field in a panel, drawn by its shape and folded when large, with
 * "Open full view" for long text. The view around it draws the field's name and lays out
 * its fields.
 */
export const ValueField = ({value, label, className}: ValueFieldProps) => {
    const t = useT(valueViewCatalog)
    const stateKey = useId()
    const [fullView, setFullView] = useState(false)
    return (
        <div className={cn("min-w-0 text-body-sm", className)}>
            <ValueBody value={value} stateKey={stateKey} onOpenFullView={() => setFullView(true)} />
            {fullView ? (
                <Dialog open onOpenChange={setFullView}>
                    <DialogContent className="flex max-h-[85vh] w-full max-w-3xl flex-col">
                        <DialogTitle className="sr-only">
                            {label ?? t("chat.valueView.fullView")}
                        </DialogTitle>
                        <Suspense fallback={null}>
                            <ValueFullView value={value} label={label} className="min-h-0 flex-1" />
                        </Suspense>
                    </DialogContent>
                </Dialog>
            ) : null}
        </div>
    )
}
