import {useMemo, useState} from "react"

import {ScheduleBuilderPanel, useScheduleBuilder} from "@agenta/entity-ui/gatewayTrigger"
import {Button, selectTriggerVariants} from "@agenta/ui/ui"
import {CalendarBlank, Lightning} from "@phosphor-icons/react"
import {ChevronDown} from "lucide-react"

import {AutomationField} from "./AutomationField"
import {runsWhenLabel, type Automation, type AutomationKind} from "./automationModel"
import {cn} from "./lib/utils"
import {EventPickerPanel, type EventSelection} from "./pickers/EventPickerPanel"
import {PickerOverlay, usePickerIsWide} from "./pickers/PickerOverlay"

/** The two things an automation can run on, in the order the design shows them. */
const KINDS: {
    value: AutomationKind
    label: string
    /** A phone's half-width chip has room for two words, not four. */
    shortLabel: string
    icon: typeof CalendarBlank
}[] = [
    {value: "schedule", label: "On a schedule", shortLabel: "Schedule", icon: CalendarBlank},
    {value: "event", label: "When something happens", shortLabel: "Event", icon: Lightning},
]

/**
 * When the automation runs — ONE control, not two.
 *
 * The kind chips sit at the top of the overlay and the chosen kind's own panel sits under them,
 * because a schedule that can never become an event subscription is a control that only reports
 * the choice someone else made. Neither panel is reimplemented here: the schedule half is the
 * shared `ScheduleBuilderPanel` (the drawer's own cadence builder, minus its trigger), the event
 * half is `EventPickerPanel` (the subscription drawer's app/event chooser and filter form).
 */
export const AutomationRunsWhenField = ({
    automation,
    onChangeCron,
    onChangeKind,
    onSelectEvent,
    error,
}: {
    automation: Automation
    onChangeCron: (cron: string) => void
    /** Present ⇒ the kind is still the host's to change (a draft). Absent ⇒ the chips read only. */
    onChangeKind?: (kind: AutomationKind) => void
    /** Where a picked event goes — the host's draft, which saves it with the rest. */
    onSelectEvent: (selection: EventSelection) => void
    /** Set after a blocked create: this field is what is missing, and says so in red. */
    error?: string
}) => {
    const [open, setOpen] = useState(false)
    const isWide = usePickerIsWide()
    const schedule = useScheduleBuilder(automation.cron ?? "", onChangeCron)

    const isSchedule = automation.kind === "schedule"

    // The schedule panel prints its own "Next run …" line, so a running schedule needs no helper
    // here — repeating it just stacks the same sentence twice. Paused is the one thing the builder
    // can't know, and an event subscription has no next run to compute. An unusable expression
    // outranks both: the drawer's own `Field` says so and this line is the only place left to.
    const helper = useMemo(() => {
        if (isSchedule && !schedule.validation.valid) return schedule.validation.error
        if (!automation.isActive) return "Paused — it won't run until you switch it on."
        return isSchedule ? "" : "Runs each time this event arrives."
    }, [automation.isActive, isSchedule, schedule.validation])

    const Icon = isSchedule ? CalendarBlank : Lightning
    // While the popover is open the summary tracks the builder, not the saved row: a cron typed
    // in the Cron editor is not yet a saved `automation.cron`.
    const label = isSchedule ? schedule.summary : runsWhenLabel(automation)

    return (
        <AutomationField label="Runs when" helper={helper} error={error}>
            <PickerOverlay
                open={open}
                onOpenChange={setOpen}
                title="Runs when"
                trigger={
                    // The same geometry `AutomationAgentField`'s SelectTrigger has, so the two
                    // controls read as one stack rather than two sizes of field.
                    <button
                        type="button"
                        aria-invalid={error ? true : undefined}
                        className={cn(selectTriggerVariants(), "h-auto py-input-y")}
                    >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                            <Icon
                                aria-hidden
                                size={14}
                                className="text-muted-foreground shrink-0"
                            />
                            <span className="min-w-0 truncate">{label}</span>
                        </span>
                        <ChevronDown className="text-placeholder size-3 shrink-0" />
                    </button>
                }
            >
                {/* `flex-1` so the sheet's fixed height reaches the panel's own scroller. */}
                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex shrink-0 gap-1 p-2">
                        {KINDS.map(({value, label: kindLabel, shortLabel, icon: KindIcon}) => {
                            const active = value === automation.kind
                            return (
                                <Button
                                    key={value}
                                    type="button"
                                    size="sm"
                                    variant={active ? "default" : "outline"}
                                    aria-pressed={active}
                                    // A saved automation's kind is its entity type — two
                                    // endpoints, not a field — so only a draft can still switch.
                                    disabled={!onChangeKind && !active}
                                    title={
                                        onChangeKind
                                            ? undefined
                                            : "An automation's trigger type is fixed once it's created."
                                    }
                                    onClick={() => onChangeKind?.(value)}
                                    // The two modes are the picker's first choice, not a
                                    // toolbar's: a taller target reads as a decision rather
                                    // than a control tucked above the panel.
                                    className="h-8 min-w-0 flex-1 font-normal"
                                >
                                    <KindIcon aria-hidden size={14} />
                                    <span className="min-w-0 truncate">
                                        {isWide ? kindLabel : shortLabel}
                                    </span>
                                </Button>
                            )
                        })}
                    </div>

                    {isSchedule ? (
                        <div className="min-h-0 overflow-y-auto p-4">
                            <ScheduleBuilderPanel
                                value={automation.cron ?? ""}
                                controls={schedule}
                            />
                        </div>
                    ) : (
                        <EventPickerPanel
                            automation={automation}
                            open={open}
                            onClose={() => setOpen(false)}
                            onSelectEvent={onSelectEvent}
                        />
                    )}
                </div>
            </PickerOverlay>
        </AutomationField>
    )
}
