import {AccordionTreePanel} from "@agenta/observability-ui/traceDrawer"

interface TraceSpanPanelProps {
    title?: string
    spanDataOverride?: unknown
    viewModePreset?: "default" | "message"
    defaultCollapsed?: boolean
    [key: string]: unknown
}

/** Trace drawer drill-in slot on `/m`: one accordion panel for one slice of the span. */
export const TraceSpanPanel = ({
    title,
    spanDataOverride,
    viewModePreset = "default",
    defaultCollapsed = false,
}: TraceSpanPanelProps) => (
    <AccordionTreePanel
        label={title ?? "data"}
        value={(spanDataOverride ?? {}) as Record<string, unknown> | string | unknown[]}
        enableFormatSwitcher
        viewModePreset={viewModePreset}
        defaultCollapsed={defaultCollapsed}
    />
)
