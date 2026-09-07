import {CaretDown, Robot} from "@phosphor-icons/react"

import {Button} from "@/components/ui/button"

import {AutomationField} from "./AutomationField"

/**
 * Which agent the automation runs.
 *
 * The button is the whole control — picking a different agent opens a sheet, which W4 builds;
 * without `onOpenAgentPicker` this reads as a bound fact rather than offering a dead tap target.
 */
export const AutomationAgentField = ({
    agentName,
    onOpenAgentPicker,
}: {
    agentName: string | null
    onOpenAgentPicker?: () => void
}) => (
    <AutomationField
        label="Agent"
        helper="This agent does the work, with the tools it already has."
    >
        <Button
            type="button"
            variant="outline"
            disabled={!onOpenAgentPicker}
            onClick={onOpenAgentPicker}
            // Not dimmed while the picker is unwired: the bound agent is still a fact to read.
            className="h-10 w-full justify-between font-normal disabled:opacity-100"
        >
            <span className="flex min-w-0 items-center gap-2">
                <Robot aria-hidden size={16} className="text-muted-foreground shrink-0" />
                <span className="min-w-0 truncate">{agentName ?? "Pick an agent"}</span>
            </span>
            <CaretDown aria-hidden size={14} className="text-muted-foreground shrink-0" />
        </Button>
    </AutomationField>
)
