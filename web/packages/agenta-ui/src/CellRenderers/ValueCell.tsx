/**
 * ValueCell: one stored value as one table cell, drawn by its shape (`detectValueShape`), or a
 * metric value drawn by its kind. Never taller than the row: one line, or up to three with
 * `lines={3}`. No markdown or chat code, so a table of many rows stays light.
 */

import {memo, useMemo, type ReactNode} from "react"

import {useT, type CatalogKey, type TranslationValues} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import {
    detectValueShape,
    formatShapeNumber,
    lineCount,
    readValueMessage,
    type DetectedValue,
} from "@agenta/shared/utils"
import {Check, Paperclip, X} from "@phosphor-icons/react"
import clsx from "clsx"

import {Badge} from "../components/ui/badge"

/** The kind of a metric, as `@agenta/entities` names it (`MetricKind`). */
export type ValueCellMetricKind = "binary" | "numeric" | "categorical" | "text"

export interface ValueCellProps {
    value: unknown
    /** Draw the value as a metric of this kind: Pass or Fail, a score, labels. */
    metricKind?: ValueCellMetricKind
    /** A step that is still running, or that failed: replaces the value. */
    state?: "pending" | "error"
    /** Compact draws a binary metric as an icon and a score as a number; Comfortable as a badge and a bar. */
    density?: "compact" | "comfortable"
    /** One line, or up to three lines of text. */
    lines?: 1 | 3
    className?: string
}

type T = (key: CatalogKey<typeof valueViewCatalog>, values?: TranslationValues) => string

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const Muted = ({children}: {children: ReactNode}) => (
    <span className="shrink-0 text-meta text-muted-foreground">{children}</span>
)

const Dash = () => <span className="text-muted-foreground">—</span>

/** A cell shows at most three lines, so it never needs more text than this. */
const CELL_CHARS = 600

const clip = (text: string) => (text.length > CELL_CHARS ? text.slice(0, CELL_CHARS) : text)

/** Markup removed: the first lines of a markdown text as plain text. */
const plainMarkdown = (text: string) =>
    clip(text)
        .split("\n")
        .map((line) =>
            line
                .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+[.)])\s+/, "")
                .replace(/\[([^[\]]*)\]\([^)]*\)/g, "$1")
                .replace(/(\*\*|__|`)/g, "")
                .trim(),
        )
        .filter((line) => line && !line.startsWith("```") && !/^\|?[\s:-]+\|/.test(line))
        .join(" ")

const firstLine = (text: string) => clip(text.trimStart()).split("\n", 1)[0] ?? ""

/** "host/path" of a URL, else the URL. */
const urlText = (url: string) => {
    try {
        const parsed = new URL(url)
        return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`
    } catch {
        return url
    }
}

const linesText = (count: number, t: T) =>
    t("chat.valueView.lines", {count, n: count.toLocaleString()})

const scalarText = (value: unknown) =>
    typeof value === "number" ? formatShapeNumber(value) : String(value)

/** The first values of a list as one line of text. */
const listText = (items: unknown[]) => clip(items.slice(0, 50).map(scalarText).join(", "))

/** The text of a message for a cell, with a muted lead: its role, the tool calls, or a result. */
function messageLead(message: unknown, t: T): {lead: string; text: string; files: number} {
    const read = readValueMessage(message)
    if (read.role === "tool")
        return {lead: t("chat.valueView.toolResult"), text: read.text, files: 0}
    if (!read.text && read.toolCalls.length > 0) {
        return {
            lead: t("chat.valueView.calledTools", {count: read.toolCalls.length}),
            text: read.toolCalls.map((call) => call.name).join(", "),
            files: 0,
        }
    }
    return {lead: read.role, text: read.text, files: read.attachments.length}
}

const MessageText = ({message, lead, t}: {message: unknown; lead?: string; t: T}) => {
    const line = messageLead(message, t)
    if (!line.text && line.files > 0) {
        return (
            <span className="inline-flex shrink-0 items-center gap-1 text-meta text-muted-foreground">
                <Paperclip size={12} aria-hidden />
                {t("chat.valueView.attachments", {count: line.files})}
            </span>
        )
    }
    return (
        <>
            <Muted>{lead ?? line.lead}</Muted>
            <Text>{clip(line.text)}</Text>
        </>
    )
}

const Text = ({children, mono = false}: {children: ReactNode; mono?: boolean}) => (
    <span
        className={clsx(
            "min-w-0 truncate group-data-[lines=3]/value-cell:line-clamp-3 group-data-[lines=3]/value-cell:whitespace-normal group-data-[lines=3]/value-cell:break-words",
            mono && "font-mono text-code",
        )}
    >
        {children}
    </span>
)

function ShapeContent({detected, t}: {detected: DetectedValue; t: T}) {
    const {shape, value} = detected
    switch (shape) {
        case "empty":
            return <Dash />
        case "boolean":
            return <Badge variant={value ? "success" : "default"}>{String(value)}</Badge>
        case "number":
            return (
                <span className="ml-auto tabular-nums">
                    {formatShapeNumber(value as number | bigint)}
                </span>
            )
        case "url":
            return (
                <a
                    href={value as string}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 truncate text-link underline"
                    onClick={(event) => event.stopPropagation()}
                >
                    {urlText(value as string)}
                </a>
            )
        case "text-short":
            return <Text>{clip(value as string)}</Text>
        case "text-long":
            return (
                <>
                    <Text>{firstLine(value as string)}</Text>
                    <Muted>{linesText(lineCount(value as string), t)}</Muted>
                </>
            )
        case "markdown":
            return <Text>{plainMarkdown(value as string)}</Text>
        case "messages": {
            const messages = value as unknown[]
            const lastUser = [...messages]
                .reverse()
                .find((message) => readValueMessage(message).role === "user")
            return (
                <MessageText
                    message={lastUser ?? messages[messages.length - 1]}
                    lead={t("chat.valueView.messages", {count: messages.length})}
                    t={t}
                />
            )
        }
        case "message":
            return <MessageText message={value} t={t} />
        case "object-flat":
            return (
                <Text mono>
                    {clip(
                        Object.entries(value as Record<string, unknown>)
                            .slice(0, 50)
                            .map(([key, item]) => `${key}: ${scalarText(item)}`)
                            .join(", "),
                    )}
                </Text>
            )
        case "array-scalars": {
            const items = value as unknown[]
            return (
                <>
                    <Text>{listText(items)}</Text>
                    <Muted>{t("chat.valueView.items", {count: items.length})}</Muted>
                </>
            )
        }
        case "array-objects":
            return <Muted>{t("chat.valueView.items", {count: (value as unknown[]).length})}</Muted>
        case "object-nested":
            return Array.isArray(value) ? (
                <Muted>{t("chat.valueView.items", {count: value.length})}</Muted>
            ) : (
                <Muted>
                    {t("chat.valueView.fields", {count: Object.keys(value as object).length})}
                </Muted>
            )
    }
}

/** The number a per-scenario metric holds: the value, or the mean of a one-row stat blob. */
const metricNumber = (value: unknown): number | null => {
    if (typeof value === "number") return value
    if (isRecord(value) && typeof value.mean === "number") return value.mean
    return null
}

function MetricContent({
    value,
    kind,
    detected,
    density,
    t,
}: {
    value: unknown
    kind: ValueCellMetricKind
    /** The shape of a `text` metric. */
    detected: DetectedValue | null
    density: "compact" | "comfortable"
    t: T
}) {
    if (value === undefined || value === null || value === "") return <Dash />
    if (kind === "binary" && typeof value === "boolean") {
        const word = t(value ? "chat.valueView.pass" : "chat.valueView.fail")
        if (density === "compact") {
            const Icon = value ? Check : X
            return (
                <span
                    role="img"
                    aria-label={word}
                    title={word}
                    className={clsx("inline-flex", value ? "text-success" : "text-destructive")}
                >
                    <Icon size={14} weight="bold" aria-hidden />
                </span>
            )
        }
        return <Badge variant={value ? "success" : "destructive"}>{word}</Badge>
    }
    if (kind === "numeric") {
        const number = metricNumber(value)
        if (number === null) return <Dash />
        const unit = number >= 0 && number <= 1
        const text = unit ? number.toFixed(2) : formatShapeNumber(number)
        if (density === "compact" || !unit) {
            return <span className="ml-auto font-medium tabular-nums">{text}</span>
        }
        return (
            <span className="ml-auto flex w-10 flex-col items-end gap-0.5">
                <span className="font-medium tabular-nums">{text}</span>
                <span className="relative h-0.5 w-full overflow-hidden rounded-sm bg-border-muted">
                    <span
                        className="absolute inset-y-0 left-0 bg-success"
                        style={{width: `${number * 100}%`}}
                    />
                </span>
            </span>
        )
    }
    if (kind === "categorical") {
        const labels = (Array.isArray(value) ? value : [value]).map(scalarText)
        if (labels.length === 0) return <Dash />
        return (
            <>
                <Badge className="min-w-0 truncate">{labels[0]}</Badge>
                {labels.length > 1 ? (
                    // A count, the same in every language.
                    <Muted>{`+${labels.length - 1}`}</Muted>
                ) : null}
            </>
        )
    }
    // `text`: a reason draws by its shape; a JSON output reads as a count of fields.
    if (!detected) return <Dash />
    if (detected.shape === "object-flat") {
        return (
            <Muted>
                {t("chat.valueView.fields", {count: Object.keys(detected.value as object).length})}
            </Muted>
        )
    }
    return <ShapeContent detected={detected} t={t} />
}

const ValueCell = memo(function ValueCell({
    value,
    metricKind,
    state,
    density = "comfortable",
    lines = 1,
    className,
}: ValueCellProps) {
    const t = useT(valueViewCatalog)
    // The parse of a large JSON text is not free: once per value, not once per render.
    const detected = useMemo(
        () => (state || (metricKind && metricKind !== "text") ? null : detectValueShape(value)),
        [value, metricKind, state],
    )
    let content: ReactNode
    if (state === "error") {
        content = <Badge variant="destructive">{t("chat.valueView.error")}</Badge>
    } else if (state === "pending") {
        content = (
            <>
                <Muted>{t("chat.valueView.running")}</Muted>
                <span aria-hidden className="h-2 w-[60px] shrink rounded-sm bg-selected" />
            </>
        )
    } else if (metricKind) {
        content = (
            <MetricContent
                value={value}
                kind={metricKind}
                detected={detected}
                density={density}
                t={t}
            />
        )
    } else if (detected) {
        content = (
            <>
                <ShapeContent detected={detected} t={t} />
                {detected.parsedFromText ? <Muted>{t("chat.valueView.parsed")}</Muted> : null}
            </>
        )
    }
    return (
        <span
            data-lines={lines}
            className={clsx(
                "group/value-cell flex w-full min-w-0 gap-1.5 overflow-hidden",
                lines === 1 ? "items-center whitespace-nowrap" : "items-start",
                density === "compact" ? "text-meta" : "text-body-sm",
                className,
            )}
        >
            {content}
        </span>
    )
})

export default ValueCell
