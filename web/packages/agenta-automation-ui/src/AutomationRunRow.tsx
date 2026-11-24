import {type TriggerDelivery} from "@agenta/entities/gatewayTrigger"
import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import automationsModelCatalog from "@agenta/i18n/catalogs/automations.model"

import {deliveryOutcome} from "./automationModel"
import {FOCUS_RING} from "./lib/interactive"
import {cn} from "./lib/utils"
import {runDotClass, runLabel, runOutcomeLabel, runTimeOfDay} from "./runModel"

/**
 * One run in the history list: whether it worked, what it was, and at what time.
 *
 * Borderless on purpose — the day heading above already divides the list, and a rule under every
 * row would draw a second grid on top of that one. Selection and hover are a fill instead.
 *
 * A button rather than a link — selecting a run swaps the pane beside the list, it does not
 * navigate. The dot is the only thing carrying the outcome visually, so the outcome is also in
 * the row's accessible name; colour alone never states it.
 */
export const AutomationRunRow = ({
    delivery,
    selected,
    onSelect,
    phone = false,
}: {
    delivery: TriggerDelivery
    selected: boolean
    onSelect: () => void
    /** Phone: the row is at least 44 px high. */
    phone?: boolean
}) => {
    const t = useT(automationsEditorCatalog, automationsModelCatalog)
    const label = runLabel(delivery)
    const outcome = runOutcomeLabel(delivery)
    const time = runTimeOfDay(delivery)
    // A skipped run says why on the row: the dot alone reads as one more run in flight.
    const skipped = deliveryOutcome(delivery) === "skipped"

    return (
        <button
            type="button"
            onClick={onSelect}
            aria-current={selected ? "true" : undefined}
            aria-label={
                time
                    ? t("automations.editor.runRowAriaTime", {label, outcome, time})
                    : t("automations.editor.runRowAria", {label, outcome})
            }
            className={cn(
                "box-border flex min-h-row-dense w-full items-center gap-2 rounded-md border-0 bg-transparent px-2.5 py-1 text-left",
                "cursor-pointer transition-colors",
                selected ? "bg-selected" : "hover:bg-accent active:bg-accent",
                FOCUS_RING,
            )}
        >
            <span aria-hidden className={cn("size-2 shrink-0 rounded-round", runDotClass(delivery))} />
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-label text-foreground">{label}</span>
                {skipped ? (
                    <span className="truncate text-meta text-muted-foreground">{outcome}</span>
                ) : null}
            </span>
            {time ? (
                <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
                    {time}
                </span>
            ) : null}
        </button>
    )
}
