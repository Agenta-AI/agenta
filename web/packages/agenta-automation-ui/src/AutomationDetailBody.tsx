import type {ReactNode} from "react"

import {AutomationAgentField} from "./AutomationAgentField"
import {AutomationFailureBanner} from "./AutomationFailureBanner"
import {AutomationInstructionField} from "./AutomationInstructionField"
import {AutomationMetaRow} from "./AutomationMetaRow"
import type {Automation} from "./automationModel"
import {AutomationRunHistoryCard} from "./AutomationRunHistoryCard"
import {AutomationRunsWhenField} from "./AutomationRunsWhenField"
import {AutomationSaveBar} from "./AutomationSaveBar"
import {AutomationTitle} from "./AutomationTitle"
import type {EventSelection} from "./pickers/EventPickerPanel"

/**
 * One automation, read top to bottom: what it is, whether it is on, what is wrong, the three
 * things you can change, and the way through to its runs.
 *
 * The three config fields are ONE edit: they read the draft (`preview`) rather than the saved row,
 * and leave together through the footer. The name and the switch are not part of that edit and
 * still save on the spot — they state what the row IS, and holding them hostage to a Save button
 * would make switching an automation off a two-step act.
 *
 * The column has no `gap`: each block owns the space above it, because the rhythm is uneven by
 * design (4px under the meta row, 26px above the fields, 30px above the footer and the run-history
 * card) and a single gap cannot express that.
 */
export const AutomationDetailBody = ({
    automation,
    preview,
    agentName,
    runsHref,
    className,
    hideSaveBar = false,
    failureReason = null,
    runHistoryCaption = "",
    dirty,
    saving,
    onRename,
    onSelectAgent,
    onChangeCron,
    onSelectEvent,
    onChangeInputs,
    onToggle,
    onDiscard,
    onSave,
    actions,
}: {
    /** The saved row — the identity half of the screen. */
    automation: Automation
    /** The saved row with the unsaved config written over it — what the fields render. */
    preview: Automation
    agentName: string | null
    /**
     * Where the run history lives. Null on a surface that has no route for it (a drawer opened
     * over the agent that owns the runs), which hides the card rather than linking nowhere.
     */
    runsHref: string | null
    /**
     * The frame this body sits in. Defaults to the page column a screen wants; a drawer passes
     * its own, because the drawer already owns the gutters.
     */
    className?: string
    /** The host renders the save bar itself — a drawer puts it in its own footer. */
    hideSaveBar?: boolean
    failureReason?: string | null
    runHistoryCaption?: string
    /** The draft differs from what is saved, so the footer has something to offer. */
    dirty: boolean
    saving: boolean
    onRename: (name: string) => Promise<boolean>
    /**
     * Absent ⇒ the agent reads as a bound fact. The playground opens this over the agent that
     * owns it, where rebinding would move the automation off the agent on screen.
     */
    onSelectAgent?: (agentId: string) => void
    onChangeCron: (cron: string) => void
    onSelectEvent: (selection: EventSelection) => void
    onChangeInputs: (inputs: Record<string, unknown>) => void
    onToggle: (next: boolean) => Promise<void>
    onDiscard: () => void
    onSave: () => void
    /** Test run and the actions menu — on the title's line, not the page header. */
    actions?: ReactNode
}) => (
    <div className={className ?? "mx-auto flex w-full max-w-[760px] flex-col px-8 pb-[70px]"}>
        <div className="flex min-w-0 items-start gap-2">
            <AutomationTitle
                name={automation.name}
                description={automation.description}
                onRename={onRename}
            />
            {actions ? (
                <span className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</span>
            ) : null}
        </div>
        <AutomationMetaRow
            active={automation.isActive}
            agentName={agentName}
            updatedAt={automation.updatedAt}
            onToggle={onToggle}
        />
        <AutomationFailureBanner reason={failureReason} />
        <div className="mt-[26px] flex flex-col gap-[22px]">
            <AutomationAgentField
                agentId={preview.agentId}
                agentName={agentName}
                onSelectAgent={onSelectAgent}
            />
            <AutomationRunsWhenField
                automation={preview}
                onChangeCron={onChangeCron}
                onSelectEvent={onSelectEvent}
            />
            <AutomationInstructionField
                agentId={preview.agentId}
                inputsFields={preview.raw.data?.inputs_fields}
                onCommit={onChangeInputs}
            />
        </div>
        {runsHref ? <AutomationRunHistoryCard href={runsHref} caption={runHistoryCaption} /> : null}
        {/* Last on the page: the bar commits the whole screen, so it reads as the end of the
            form rather than a divider halfway down it. */}
        {dirty && !hideSaveBar ? (
            <AutomationSaveBar saving={saving} onDiscard={onDiscard} onSave={onSave} />
        ) : null}
    </div>
)
