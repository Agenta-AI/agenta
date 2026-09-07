import {CaretDown, Robot} from "@phosphor-icons/react"

import {Button} from "@/components/ui/button"

import {AutomationField} from "./AutomationField"
import type {Automation} from "./automationModel"
import {AgentPicker} from "./pickers/AgentPicker"

/**
 * Which agent the automation runs.
 *
 * The button is the whole control: given the automation it IS the picker's trigger and rebinding
 * saves in place. Without it — the callers that only know the agent's name — it falls back to
 * `onOpenAgentPicker`, and with neither it reads as a bound fact rather than offering a dead tap
 * target.
 */
export const AutomationAgentField = ({
    agentName,
    automation,
    onOpenAgentPicker,
}: {
    agentName: string | null
    /** The automation being edited. Present ⇒ the field picks and saves the agent itself. */
    automation?: Automation
    onOpenAgentPicker?: () => void
}) => {
    const control = (
        <Button
            type="button"
            variant="outline"
            disabled={!automation && !onOpenAgentPicker}
            // When the picker wraps this, the overlay supplies the open handler instead.
            onClick={automation ? undefined : onOpenAgentPicker}
            // Not dimmed while there is nothing to open: the bound agent is still a fact to read.
            className="h-10 w-full justify-between font-normal disabled:opacity-100"
        >
            <span className="flex min-w-0 items-center gap-2">
                <Robot aria-hidden size={16} className="text-muted-foreground shrink-0" />
                <span className="min-w-0 truncate">{agentName ?? "Pick an agent"}</span>
            </span>
            <CaretDown aria-hidden size={14} className="text-muted-foreground shrink-0" />
        </Button>
    )

    return (
        <AutomationField
            label="Agent"
            helper="This agent does the work, with the tools it already has."
        >
            {automation ? <AgentPicker automation={automation} trigger={control} /> : control}
        </AutomationField>
    )
}
