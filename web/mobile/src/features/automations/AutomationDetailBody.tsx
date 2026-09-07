import {AutomationAgentField} from "./AutomationAgentField"
import {AutomationFailureBanner} from "./AutomationFailureBanner"
import {AutomationInstructionField} from "./AutomationInstructionField"
import {AutomationMetaRow} from "./AutomationMetaRow"
import type {Automation} from "./automationModel"
import {AutomationRunHistoryCard} from "./AutomationRunHistoryCard"
import {AutomationRunsWhenField} from "./AutomationRunsWhenField"
import {AutomationTitle} from "./AutomationTitle"

/**
 * One automation, read top to bottom: what it is, whether it is on, what is wrong, the three
 * things you can change, and the way through to its runs.
 *
 * Every edit here saves on its own — there is no Save button, because none of these fields is
 * part of a form the others depend on.
 *
 * The column has no `gap`: each block owns the space above it, because the rhythm is uneven by
 * design (4px under the meta row, 26px above the fields, 30px above the run-history card) and a
 * single gap cannot express that.
 */
export const AutomationDetailBody = ({
    automation,
    agentName,
    runsHref,
    failureReason = null,
    runHistoryCaption = "",
    onOpenAgentPicker,
    onRename,
    onChangeCron,
    onChangeInputs,
    onToggle,
}: {
    automation: Automation
    agentName: string | null
    runsHref: string
    failureReason?: string | null
    runHistoryCaption?: string
    onOpenAgentPicker?: () => void
    onRename: (name: string) => Promise<boolean>
    onChangeCron: (cron: string) => void
    onChangeInputs: (inputs: Record<string, unknown>) => void
    onToggle: (next: boolean) => Promise<void>
}) => (
    <div className="mx-auto flex w-full max-w-[760px] flex-col px-8 pb-[70px]">
        <AutomationTitle
            name={automation.name}
            description={automation.description}
            onRename={onRename}
        />
        <AutomationMetaRow
            active={automation.isActive}
            agentName={agentName}
            updatedAt={automation.updatedAt}
            onToggle={onToggle}
        />
        <AutomationFailureBanner reason={failureReason} />
        <div className="mt-[26px] flex flex-col gap-[22px]">
            <AutomationAgentField
                automation={automation}
                agentName={agentName}
                onOpenAgentPicker={onOpenAgentPicker}
            />
            <AutomationRunsWhenField automation={automation} onChangeCron={onChangeCron} />
            <AutomationInstructionField
                automationId={automation.id}
                agentId={automation.agentId}
                inputsFields={automation.raw.data?.inputs_fields}
                onCommit={onChangeInputs}
            />
        </div>
        <AutomationRunHistoryCard href={runsHref} caption={runHistoryCaption} />
    </div>
)
