import {useId, useState} from "react"

import {FieldFold, ValueField, ValueViewProvider, type ValueViewMode} from "@agenta/chat/value-view"
import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import spanCatalog from "@agenta/i18n/catalogs/observabilityUi.traceSpan"
import {AccordionTreePanel} from "@agenta/observability-ui/traceDrawer"
import {detectValueShape, getStringOrJson, unwrapWrapperKey} from "@agenta/shared/utils"
import {CopyButton} from "@agenta/ui/components/presentational"
import {Button, CollapseCaret, Segmented, SkeletonBlock, cn} from "@agenta/ui/ui"
import {XCircleIcon} from "@phosphor-icons/react"

import {chatProseClassName, markdownIcons} from "@/features/chat/AssistantMarkdown"

/** The span sections the drawer's overview draws through this slot. */
type SpanSection = "inputs" | "outputs" | "parameters" | "internals" | "exception"

interface TraceSpanPanelProps {
    title?: string
    /** Set by the trace view: the section drawn by shape. Without it, the code panel. */
    section?: SpanSection
    spanDataOverride?: unknown
    viewModePreset?: "default" | "message"
    defaultCollapsed?: boolean
    /** The span has no end time yet: an empty output is still coming. */
    running?: boolean
    /**
     * Set when the trace view's span header owns the Formatted / Raw switch. Without it (the
     * annotation queue) the section has its own switch, and Raw keeps JSON / YAML and search.
     */
    mode?: ValueViewMode
    [key: string]: unknown
}

const SECTION_TITLES = {
    inputs: "observabilityUi.traceSpan.sectionInput",
    outputs: "observabilityUi.traceSpan.sectionOutput",
    parameters: "observabilityUi.traceSpan.sectionParameters",
    internals: "observabilityUi.traceSpan.sectionInternals",
    exception: "observabilityUi.traceSpan.exception",
} as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const text = (value: unknown) => (typeof value === "string" ? value : "")

/** The span's "exception" event: its type, its message, and the stack folded. */
const ExceptionBody = ({event}: {event: unknown}) => {
    const t = useT(spanCatalog)
    const attributes = isRecord(event) && isRecord(event.attributes) ? event.attributes : {}
    const type = text(attributes["exception.type"]) || t("observabilityUi.traceSpan.exception")
    const message = text(attributes["exception.message"])
    const stack = text(attributes["exception.stacktrace"])
    return (
        <div className="flex flex-col gap-2 rounded-md border border-solid border-destructive/30 bg-destructive/10 p-3">
            <span className="inline-flex items-center gap-1.5 text-label text-destructive">
                <XCircleIcon size={14} />
                {type}
            </span>
            {message ? <div className="whitespace-pre-wrap break-words">{message}</div> : null}
            {stack ? (
                <FieldFold text={stack}>
                    <pre className="m-0 overflow-x-auto whitespace-pre rounded-md bg-background px-3 py-2 font-mono text-code-sm">
                        {stack}
                    </pre>
                </FieldFold>
            ) : null}
        </div>
    )
}

/** An output not there yet: the running line and a skeleton. */
const RunningOutput = () => {
    const t = useT(spanCatalog)
    return (
        <div className="flex flex-col gap-2" aria-busy>
            <span className="inline-flex items-center gap-1.5 text-meta text-muted-foreground">
                <span aria-hidden className="size-1.5 animate-pulse rounded-round bg-info" />
                {t("observabilityUi.traceSpan.waitingForOutput")}
            </span>
            <SkeletonBlock className="w-120 max-w-full" />
            <SkeletonBlock className="w-100 max-w-full" />
            <SkeletonBlock className="w-70 max-w-full" />
        </div>
    )
}

/**
 * One section of the span body (Input, Output, Parameters, Internals, Exception): a title that
 * folds it, copy, and the value drawn by its shape.
 */
const SpanSectionPanel = ({
    section,
    value,
    defaultCollapsed,
    running,
    ownSwitch,
}: {
    section: SpanSection
    value: unknown
    defaultCollapsed: boolean
    running: boolean
    ownSwitch: boolean
}) => {
    const t = useT(spanCatalog, valueViewCatalog)
    const [open, setOpen] = useState(!defaultCollapsed)
    const [mode, setMode] = useState<ValueViewMode>("formatted")
    const regionId = useId()
    const title = t(SECTION_TITLES[section])
    const empty = detectValueShape(value).shape === "empty"

    const body =
        ownSwitch && mode === "raw" && !empty ? (
            <AccordionTreePanel
                label={title}
                value={value as Record<string, unknown> | string | unknown[]}
                enableFormatSwitcher
                enableSearch
                rawOnly
            />
        ) : section === "exception" ? (
            <ExceptionBody event={value} />
        ) : section === "outputs" && empty ? (
            running ? (
                <RunningOutput />
            ) : (
                <span className="text-body-sm text-muted-foreground">
                    {t("chat.valueView.noOutput")}
                </span>
            )
        ) : (
            // A single wrapper key ({"inputs": {...}}) is dropped: its rows are the section.
            <ValueField value={unwrapWrapperKey(value)} label={title} />
        )

    return (
        <section
            className="border-0 border-b border-solid border-border-muted pb-3"
            data-testid={`span-section-${section}`}
        >
            <div className="flex min-h-9 items-center gap-2">
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-expanded={open}
                    aria-controls={regionId}
                    className={cn(
                        "h-auto justify-start gap-1.5 px-0 text-label hover:bg-transparent aria-expanded:bg-transparent",
                        section === "exception" ? "text-destructive" : "text-foreground",
                    )}
                    onClick={() => setOpen((next) => !next)}
                >
                    <CollapseCaret open={open} />
                    {title}
                </Button>
                <span className="flex-1" />
                {ownSwitch && !empty ? (
                    <Segmented
                        size="sm"
                        value={mode}
                        onChange={(next) => setMode(next as ValueViewMode)}
                        options={[
                            {value: "formatted", label: t("chat.valueView.formatted")},
                            {value: "raw", label: t("chat.valueView.raw")},
                        ]}
                    />
                ) : null}
                {empty ? null : (
                    <CopyButton
                        text={getStringOrJson(value)}
                        icon
                        buttonText=""
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("chat.valueView.copyValue")}
                    />
                )}
            </div>
            {open ? (
                <div id={regionId} className="pl-4.5">
                    {body}
                </div>
            ) : null}
        </section>
    )
}

/**
 * Trace drawer drill-in slot on `/m`. In the trace view (`section` set) it draws one section of
 * the span by the shape of its value; other callers (the session drawer) get the code panel.
 */
export const TraceSpanPanel = ({
    title,
    section,
    spanDataOverride,
    viewModePreset = "default",
    defaultCollapsed = false,
    running = false,
    mode,
}: TraceSpanPanelProps) => {
    if (section) {
        return (
            <ValueViewProvider markdownClassName={chatProseClassName} markdownIcons={markdownIcons}>
                <SpanSectionPanel
                    section={section}
                    value={spanDataOverride}
                    defaultCollapsed={defaultCollapsed}
                    running={running}
                    ownSwitch={mode === undefined}
                />
            </ValueViewProvider>
        )
    }
    return (
        <AccordionTreePanel
            label={title ?? "data"}
            value={(spanDataOverride ?? {}) as Record<string, unknown> | string | unknown[]}
            enableFormatSwitcher
            enableSearch
            viewModePreset={viewModePreset}
            defaultCollapsed={defaultCollapsed}
        />
    )
}

export default TraceSpanPanel
