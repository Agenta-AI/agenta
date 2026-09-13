import {type TriggerDelivery} from "@agenta/entities/gatewayTrigger"

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
}: {
    delivery: TriggerDelivery
    selected: boolean
    onSelect: () => void
}) => {
    const label = runLabel(delivery)
    const time = runTimeOfDay(delivery)

    return (
        <button
            type="button"
            onClick={onSelect}
            aria-current={selected ? "true" : undefined}
            aria-label={`${label} — ${runOutcomeLabel(delivery)}${time ? `, ${time}` : ""}`}
            className={cn(
                "flex w-full items-center gap-[9px] rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left",
                "cursor-pointer transition-colors",
                selected ? "bg-accent" : "hover:bg-accent/60 active:bg-accent/60",
                FOCUS_RING,
            )}
        >
            <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full", runDotClass(delivery))}
            />
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{label}</span>
            {time ? <span className="shrink-0 text-xs text-muted-foreground">{time}</span> : null}
        </button>
    )
}
