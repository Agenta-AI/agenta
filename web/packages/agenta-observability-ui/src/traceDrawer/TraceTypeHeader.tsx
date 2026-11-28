import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import spanCatalog from "@agenta/i18n/catalogs/observabilityUi.traceSpan"
import {CopyButton} from "@agenta/ui/components/presentational"
import {Badge, Segmented, SimpleTooltip, cn} from "@agenta/ui/ui"

import {isSpanRunning} from "./spanRunning"
import type {TraceTypeHeaderProps} from "./traceTypeHeaderTypes"

/**
 * The span header above the span body: the span name (red when it failed), its type, a status
 * badge when it failed or still runs, copy span id, and the Formatted / Raw switch.
 */
const TraceTypeHeader = ({activeTrace, error, mode, onModeChange}: TraceTypeHeaderProps) => {
    const t = useT(spanCatalog, drawerCatalog, valueViewCatalog)
    const failed = activeTrace?.status_code === "STATUS_CODE_ERROR"
    const running = isSpanRunning(activeTrace)
    const name = activeTrace?.span_name || (error ? t("observabilityUi.traceSpan.error") : "")

    return (
        // On a phone-width panel the switch wraps under the span name instead of squeezing it.
        <div className="box-border flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-0 border-b border-solid border-border-muted px-4 py-1.5">
            <div className="flex min-w-32 flex-1 items-center gap-2">
                <SimpleTooltip side="top" title={name}>
                    <span
                        className={cn("min-w-0 truncate text-title", failed && "text-destructive")}
                    >
                        {name}
                    </span>
                </SimpleTooltip>
                {activeTrace?.span_type ? (
                    <Badge className="shrink-0 font-mono">{activeTrace.span_type}</Badge>
                ) : null}
                {running ? (
                    <Badge variant="info" className="shrink-0">
                        {t("chat.valueView.running")}
                    </Badge>
                ) : failed ? (
                    <Badge variant="destructive" className="shrink-0">
                        {t("observabilityUi.traceDrawer.statusError")}
                    </Badge>
                ) : null}
                {activeTrace?.span_id ? (
                    <CopyButton
                        text={activeTrace.span_id}
                        icon
                        buttonText=""
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("observabilityUi.traceSpan.copySpanId")}
                    />
                ) : null}
            </div>
            {activeTrace && onModeChange ? (
                <Segmented
                    size="sm"
                    value={mode ?? "formatted"}
                    onChange={(next) => onModeChange(next as "formatted" | "raw")}
                    options={[
                        {value: "formatted", label: t("chat.valueView.formatted")},
                        {value: "raw", label: t("chat.valueView.raw")},
                    ]}
                />
            ) : null}
        </div>
    )
}

export default TraceTypeHeader
