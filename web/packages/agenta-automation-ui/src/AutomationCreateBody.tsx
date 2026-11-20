import {type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import {Switch} from "@agenta/ui/ui"

import {AutomationAgentField} from "./AutomationAgentField"
import {AutomationInstructionField} from "./AutomationInstructionField"
import {generatedAutomationLabel} from "./automationModel"
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
    fixedKind = false,
    footer,
}: {
    state: AutomationCreateState
    /** Open on the name field. False where the name is seeded (a template). */
    autoEditName?: boolean
    /** False where the host already bound the agent — the playground's own panel. */
    showAgentField?: boolean
    /** The kind was chosen before the form opened ("Add automation"), so it offers no switch. */
    fixedKind?: boolean
    footer?: ReactNode
}) => {
    const t = useT(automationsEditorCatalog)
    const {draft, preview, agentName, errors} = state

    return (
        <>
            {/* The switch sits where the saved screen puts Run now — the title line's right
                end — so the same corner always carries the automation's own control. */}
            <div className={`flex min-w-0 items-center ${fixedKind ? "gap-2" : "gap-3"}`}>
                <div className="min-w-0 flex-1">
                    <AutomationTitle
                        name={draft.name}
                        description=""
                        onRename={state.setName}
                        autoEdit={autoEditName}
                        placeholder={t("automations.editor.namePlaceholder")}
                        fallback={generatedAutomationLabel(
                            preview,
                            agentName,
                            t("automations.editor.untitledAutomation"),
                        )}
                        compact={fixedKind}
                    />
                </div>
                {/* The panel form puts "On" before the switch, at every width (F05 f3). */}
                <span
                    className={`shrink-0 items-center ${
                        fixedKind ? "flex gap-2" : "hidden gap-[9px] lg:flex"
                    }`}
                >
                    {fixedKind ? (
                        <span className="text-xs text-muted-foreground">
                            {draft.isActive
                                ? t("automations.editor.on")
                                : t("automations.editor.off")}
                        </span>
                    ) : null}
                    <Switch
                        size="sm"
                        checked={draft.isActive}
                        onCheckedChange={state.setActive}
                        // Names the setting, not the pending action: `role="switch"` already
                        // announces the state, so a label that inverts reads "…switched off, on".
                        aria-label={t("automations.editor.createSwitchedOnAria")}
                    />
                    {fixedKind ? null : (
                        <span className="text-[14px] text-foreground">
                            {draft.isActive
                                ? t("automations.editor.on")
                                : t("automations.editor.off")}
                        </span>
                    )}
                </span>
            </div>

            <div className={`flex flex-col ${fixedKind ? "mt-3 gap-3" : "mt-[26px] gap-[22px]"}`}>
                {showAgentField ? (
                    <AutomationAgentField
                        agentId={draft.agentId}
                        agentName={agentName}
                        onSelectAgent={state.setAgent}
                        error={errors.agent}
                    />
                ) : null}
                <AutomationRunsWhenField
                    automation={preview}
                    onChangeCron={state.setCron}
                    onChangeKind={fixedKind ? undefined : state.setKind}
                    inline={fixedKind}
                    onSelectEvent={state.setEvent}
                    error={errors.runsWhen}
                />
                <AutomationInstructionField
                    agentId={draft.agentId}
                    inputsFields={draft.inputsFields}
                    onCommit={state.setInputs}
                    kind={draft.kind}
                    connectionId={draft.connectionId}
                    eventKey={draft.eventKey}
                    includeEvent={draft.includeEvent}
                    onChangeIncludeEvent={state.setIncludeEvent}
                    // Nothing is created yet, so there is no delivery: the preview shows labels.
                    automation={null}
                    error={errors.instruction}
                />
            </div>

            {footer}
        </>
    )
}
