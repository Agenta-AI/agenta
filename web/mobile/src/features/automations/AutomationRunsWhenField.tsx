import {useMemo} from "react"

import {ScheduleBuilderField} from "@agenta/entity-ui/gatewayTrigger"
import {CaretDown} from "@phosphor-icons/react"

import {Button} from "@/components/ui/button"

import {AutomationField} from "./AutomationField"
import {runsWhenLabel, type Automation} from "./automationModel"
import {EventPicker} from "./pickers/EventPicker"

/**
 * When the automation runs.
 *
 * A schedule gets the shared `ScheduleBuilderField` — its collapsed row and cadence popover ARE
 * this control, so there are no cadence chips of our own to drift from the drawer's. An event
 * subscription gets the same treatment one level up: the button opens `EventPicker`, which is the
 * subscription drawer's own app/event chooser and filter form in a popover or sheet.
 */
export const AutomationRunsWhenField = ({
    automation,
    onChangeCron,
}: {
    automation: Automation
    onChangeCron: (cron: string) => void
}) => {
    // ScheduleBuilderField prints its own "Next run …" line, so a running schedule needs no
    // helper here — repeating it just stacks the same sentence twice. Paused is the one thing the
    // builder can't know, and an event subscription has no next run to compute.
    const helper = useMemo(() => {
        if (!automation.isActive) return "Paused — it won't run until you switch it on."
        return automation.kind === "schedule" ? "" : "It runs each time this event arrives."
    }, [automation.isActive, automation.kind])

    return (
        <AutomationField label="Runs when" helper={helper}>
            {automation.kind === "schedule" ? (
                <ScheduleBuilderField value={automation.cron ?? ""} onChange={onChangeCron} />
            ) : (
                <EventPicker
                    automation={automation}
                    trigger={
                        <Button
                            type="button"
                            variant="outline"
                            className="h-10 w-full justify-between font-normal"
                        >
                            <span className="min-w-0 truncate">{runsWhenLabel(automation)}</span>
                            <CaretDown
                                aria-hidden
                                size={14}
                                className="text-muted-foreground shrink-0"
                            />
                        </Button>
                    }
                />
            )}
        </AutomationField>
    )
}
