import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import automationsPanelCatalog from "@agenta/i18n/catalogs/automations.panel"
import {ItemViewTitle} from "@agenta/ui/ui"

import {AutomationActiveSwitch} from "./AutomationActiveSwitch"
import {AutomationAgentField} from "./AutomationAgentField"
import {AutomationFailureBanner} from "./AutomationFailureBanner"
import {AutomationInstructionField} from "./AutomationInstructionField"
import {AutomationKindTile} from "./AutomationKindTile"
import {AutomationMetaRow} from "./AutomationMetaRow"
import type {Automation} from "./automationModel"
import {AutomationRunPersonNotice} from "./AutomationRunPersonNotice"
import {AutomationRunsSection, AutomationViewSection} from "./AutomationRunsSection"
import {AutomationRunsWhenField} from "./AutomationRunsWhenField"
import {AutomationSaveBar} from "./AutomationSaveBar"
import {AutomationTitle, useAutomationTitleEditable} from "./AutomationTitle"
import type {EventSelection} from "./pickers/EventPickerPanel"

/**
 * One automation (F05 f5), read top to bottom: what it is and whether it is on, then two groups.
 * "Runs" is what happened and what will happen, with "Run now" in its title; "Settings" is what
 * the user can change, with "Discard" and "Save". A failed last run is the red dot on "Last
 * run", not a banner. Where there is no run history to open (the drawer), the banner stays.
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
    onOpenRunHistory,
    className,
    hideSaveBar = false,
    failureReason = null,
    dirty,
    saving,
    onRename,
    onSelectAgent,
    onChangeCron,
    onSelectEvent,
    onChangeInputs,
    includeEvent,
    onChangeIncludeEvent,
    onToggle,
    onDiscard,
    onSave,
    actions,
    runNow,
    panel = false,
    headless = false,
}: {
    /** The saved row — the identity half of the screen. */
    automation: Automation
    /** The saved row with the unsaved config written over it — what the fields render. */
    preview: Automation
    agentName: string | null
    /**
     * Opens the run history over this screen; with a run id, that run open. Absent on a surface
     * that has nowhere to put it (the drawer), which hides the "Runs" group.
     */
    onOpenRunHistory?: (runId?: string) => void
    /**
     * The frame this body sits in. Defaults to the page column a screen wants; a drawer passes
     * its own, because the drawer already owns the gutters.
     */
    className?: string
    /** The host renders the save bar itself — a drawer puts it in its own footer. */
    hideSaveBar?: boolean
    failureReason?: string | null
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
    /** Event automations only — the draft's include-event option. */
    includeEvent: boolean
    onChangeIncludeEvent: (next: boolean) => void
    onToggle: (next: boolean) => Promise<void>
    onDiscard: () => void
    onSave: () => void
    /** The actions menu — on the title's line, not the page header. */
    actions?: ReactNode
    /** The Run now control: in the "Runs" title, or by the name where there is no "Runs" group. */
    runNow?: ReactNode
    /**
     * The pane's shape: the item title (24px Mark, 13/600 name, "On" and the switch), the facts
     * under it, and no Agent field (the pane opens over the agent that runs it).
     */
    panel?: boolean
    /** The page frame draws the name, the switch line and the menu; the body starts at its sections. */
    headless?: boolean
}) => {
    const t = useT(automationsPanelCatalog)
    const tEditor = useT(automationsEditorCatalog)
    const nameField = useAutomationTitleEditable({name: automation.name, onRename})
    // With the "Runs" group, Run now sits in its title rather than by the name.
    const grouped = Boolean(onOpenRunHistory)
    const titleRun = grouped ? null : runNow
    const fields = (
        <div className={`flex flex-col ${panel ? "gap-4" : "gap-6"}`}>
            {panel ? null : (
                <AutomationAgentField
                    agentId={preview.agentId}
                    agentName={agentName}
                    onSelectAgent={onSelectAgent}
                />
            )}
            <AutomationRunsWhenField
                automation={preview}
                onChangeCron={onChangeCron}
                onSelectEvent={onSelectEvent}
            />
            <AutomationInstructionField
                agentId={preview.agentId}
                inputsFields={preview.raw.data?.inputs_fields}
                onCommit={onChangeInputs}
                kind={preview.kind}
                connectionId={preview.connectionId}
                eventKey={preview.eventKey}
                includeEvent={includeEvent}
                onChangeIncludeEvent={onChangeIncludeEvent}
                automation={automation}
            />
        </div>
    )
    const header = panel ? (
        <ItemViewTitle
            mark={<AutomationKindTile kind={automation.kind} />}
            title={automation.name}
            editable={nameField}
            actions={
                <>
                    {titleRun}
                    {actions}
                    <span aria-hidden className="text-meta text-muted-foreground">
                        {automation.isActive
                            ? tEditor("automations.editor.on")
                            : tEditor("automations.editor.off")}
                    </span>
                    <AutomationActiveSwitch
                        active={automation.isActive}
                        onToggle={onToggle}
                        label={false}
                    />
                </>
            }
            description={
                <>
                    {automation.description ? (
                        <p className="m-0 mb-1 text-body text-muted-foreground">
                            {automation.description}
                        </p>
                    ) : null}
                    <AutomationMetaRow
                        active={automation.isActive}
                        agentName={agentName}
                        updatedAt={automation.updatedAt}
                        onToggle={onToggle}
                        factsOnly
                    />
                </>
            }
        />
    ) : (
        <>
            <div className="flex min-w-0 items-start gap-2">
                <AutomationTitle
                    name={automation.name}
                    description={automation.description}
                    onRename={onRename}
                />
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    {/* Run now sits by the name from lg up; on a phone it drops to the meta line
                    beside the switch, where the row has the room. */}
                    {titleRun ? <span className="hidden lg:flex">{titleRun}</span> : null}
                    {actions}
                </span>
            </div>
            <AutomationMetaRow
                active={automation.isActive}
                agentName={agentName}
                updatedAt={automation.updatedAt}
                onToggle={onToggle}
                trailing={titleRun ? <span className="lg:hidden">{titleRun}</span> : null}
            />
        </>
    )

    return (
        <div
            className={
                // On a phone 8px of top room (the header gives back 4px) keeps the name and the
                // actions menu, the first row, from losing their 44px tap areas to the scroll clip.
                className ??
                "mx-auto box-border flex w-full max-w-content-md flex-col px-4 pb-16 pt-1 sm:px-8"
            }
        >
            {headless ? null : header}
            {onOpenRunHistory ? (
                <div
                    className={`flex flex-col ${panel ? "mt-4 gap-4" : headless ? "gap-6" : "mt-6 gap-6"}`}
                >
                    <AutomationRunsSection
                        automation={automation}
                        runNow={runNow}
                        onOpenRunHistory={onOpenRunHistory}
                    />
                    <AutomationViewSection title={t("automations.panel.settings")}>
                        {fields}
                    </AutomationViewSection>
                </div>
            ) : (
                <>
                    <AutomationFailureBanner reason={failureReason} />
                    <div className={headless ? undefined : "mt-6"}>{fields}</div>
                </>
            )}
            {/* Next to the save it is about: right above the bar, or last in a drawer whose
            footer holds the bar. */}
            <AutomationRunPersonNotice
                automation={automation}
                draftAgentId={preview.agentId}
                dirty={dirty}
            />
            {/* Last on the page: the bar commits the whole screen, so it reads as the end of the
            form rather than a divider halfway down it. */}
            {hideSaveBar ? null : (
                <AutomationSaveBar
                    dirty={dirty}
                    saving={saving}
                    onDiscard={onDiscard}
                    onSave={onSave}
                />
            )}
        </div>
    )
}
