import {type ReactNode} from "react"

import {Switch} from "@agenta/ui/ui"

import {AutomationAgentField} from "./AutomationAgentField"
import {AutomationInstructionField} from "./AutomationInstructionField"
import {AutomationRunsWhenField} from "./AutomationRunsWhenField"
import {AutomationTitle} from "./AutomationTitle"
import {type AutomationCreateState} from "./useAutomationCreate"

/**
 * The field stack for an automation that does not exist yet.
 *
 * The same four questions the saved automation asks — what it is called, which agent, when, and
 * what it is told — so creating one and editing one are not two different screens to learn. What
 * differs is the footer, which is the host's (a screen ends in Cancel/Create, a drawer in its own
 * bar), and whether the agent is still a choice: the playground opens this already knowing.
 */
export const AutomationCreateBody = ({
    state,
    autoEditName = true,
    showAgentField = true,
    footer,
}: {
    state: AutomationCreateState
    /** Open on the name field. False where the name is seeded (a template). */
    autoEditName?: boolean
    /** False where the host already bound the agent — the playground's own panel. */
    showAgentField?: boolean
    footer?: ReactNode
}) => {
    const {draft, preview, agentName, generatedName} = state

    return (
        <>
            {/* The switch sits where the saved screen puts Test run — the title line's right
                end — so the same corner always carries the automation's own control. */}
            <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0 flex-1">
                    <AutomationTitle
                        name={draft.name}
                        description=""
                        onRename={state.setName}
                        autoEdit={autoEditName}
                        placeholder="Automation name"
                        fallback={generatedName}
                    />
                </div>
                <span className="flex shrink-0 items-center gap-[9px]">
                    <Switch
                        size="sm"
                        checked={draft.isActive}
                        onCheckedChange={state.setActive}
                        // Names the setting, not the pending action: `role="switch"` already
                        // announces the state, so a label that inverts reads "…switched off, on".
                        aria-label="Create this automation switched on"
                    />
                    <span className="text-[14px] text-foreground">
                        {draft.isActive ? "On" : "Off"}
                    </span>
                </span>
            </div>

            <div className="mt-[26px] flex flex-col gap-[22px]">
                {showAgentField ? (
                    <AutomationAgentField
                        agentId={draft.agentId}
                        agentName={agentName}
                        onSelectAgent={state.setAgent}
                    />
                ) : null}
                <AutomationRunsWhenField
                    automation={preview}
                    onChangeCron={state.setCron}
                    onChangeKind={state.setKind}
                    onSelectEvent={state.setEvent}
                />
                <AutomationInstructionField
                    agentId={draft.agentId}
                    inputsFields={draft.inputsFields}
                    onCommit={state.setInputs}
                />
            </div>

            {footer}
        </>
    )
}
