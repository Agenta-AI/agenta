import {type ReactNode} from "react"

import {type TriggerDelivery} from "@agenta/entities/gatewayTrigger"
import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import automationsModelCatalog from "@agenta/i18n/catalogs/automations.model"
import automationsRunHistoryCatalog from "@agenta/i18n/catalogs/automations.runHistory"
import {Button, IconTile, SimpleTooltip} from "@agenta/ui/ui"
import {ArrowSquareOut, CaretLeft, Play} from "@phosphor-icons/react"

import {AutomationRunStatusBadge} from "./AutomationRunStatusBadge"
import {runDuration, runError, runLabel, runSessionId, runWhenLabel} from "./runModel"
import {AutomationRunNoConversation} from "./states/AutomationRunStates"

/**
 * One run, opened: what it was and when, over the conversation it produced.
 *
 * The header states the run so the pane is readable on its own — on a narrow frame it replaces
 * the list entirely, and a transcript with no heading gives no way back and no way to tell which
 * run is on screen. `onBack` is supplied only in that narrow case; from the split layout the
 * list is still visible and an extra back arrow would point at nothing.
 *
 * The transcript is a slot: it is the app's own chat surface (composer, streaming, session
 * state), which is the one part of this pane a package cannot own. `renderConversation` is
 * called only when the run actually produced a session.
 */
export const AutomationRunPane = ({
    delivery,
    renderConversation,
    sessionHref,
    onBack,
}: {
    delivery: TriggerDelivery
    /** The run's transcript, given its session — the host's chat surface. */
    renderConversation: (sessionId: string) => ReactNode
    /** The run's session page; given, an icon opens it in a new tab. */
    sessionHref?: (sessionId: string) => string
    /** Narrow layout with no host back (the page) — the pane owns the way back to the list. */
    onBack?: () => void
    /** Unused: the kit sizes the icon buttons on a phone. */
    phone?: boolean
}) => {
    const t = useT(automationsEditorCatalog, automationsModelCatalog, automationsRunHistoryCatalog)
    const sessionId = runSessionId(delivery)
    const label = runLabel(delivery)
    // The same day-and-time vocabulary the rows speak, so the header names the row you picked.
    const when = runWhenLabel(delivery)
    // No duration field on a delivery — see `runDuration`. When it cannot be derived the clause
    // is dropped rather than printed as zero.
    const took = runDuration(delivery)
    const meta = [when, took ? t("automations.editor.took", {duration: took}) : ""]
        .filter(Boolean)
        .join(" · ")

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* One line: the run's Mark and name, its status, when and how long, and open. */}
            <div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-border-muted px-4 pb-3 pt-4">
                {onBack ? (
                    <SimpleTooltip title={t("automations.editor.backToRunList")}>
                        <Button
                            variant="ghost"
                            size="icon-compact"
                            className="-ml-1.5"
                            onClick={onBack}
                            aria-label={t("automations.editor.backToRunList")}
                        >
                            <CaretLeft aria-hidden />
                        </Button>
                    </SimpleTooltip>
                ) : null}
                <IconTile size={24} aria-hidden>
                    <Play />
                </IconTile>
                <span className="shrink-0 truncate text-label font-semibold leading-5 text-foreground">
                    {label}
                </span>
                <AutomationRunStatusBadge delivery={delivery} />
                {meta ? (
                    <span className="min-w-0 flex-1 truncate text-meta tabular-nums text-muted-foreground">
                        {meta}
                    </span>
                ) : (
                    <span className="flex-1" />
                )}
                {sessionId && sessionHref ? (
                    <SimpleTooltip title={t("automations.runHistory.openRunInNewTab")}>
                        <Button
                            asChild
                            variant="ghost"
                            size="icon-compact"
                            className="-mr-1.5"
                            aria-label={t("automations.runHistory.openRunInNewTab")}
                        >
                            <a href={sessionHref(sessionId)} target="_blank" rel="noopener noreferrer">
                                <ArrowSquareOut aria-hidden />
                            </a>
                        </Button>
                    </SimpleTooltip>
                ) : null}
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
                {sessionId ? (
                    renderConversation(sessionId)
                ) : (
                    <AutomationRunNoConversation reason={runError(delivery)} />
                )}
            </div>
        </div>
    )
}
