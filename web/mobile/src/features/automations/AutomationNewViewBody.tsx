import {AutomationCreateBody, useAutomationCreate} from "@agenta/automation-ui"
import {workflowMolecule} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import type {AutomationNewViewParams} from "./automationView"

/**
 * The body of "New automation": the create form of the chosen kind, bound to the open agent, with
 * no switch between kinds. "Create automation" is the view's Save; a press with something missing
 * creates nothing and marks the missing fields.
 */
const AutomationNewViewBody = ({params}: ViewProps<AutomationNewViewParams>) => {
    const t = useT(automationsEditorCatalog, automationsScreensCatalog)
    useViewTitle(t("automations.editor.newAutomation"))
    const agentName = useAtomValue(workflowMolecule.selectors.artifactName(params.revisionId))
    const state = useAutomationCreate({
        defaultKind: params.kind,
        // The draft needs the agent's own id, from the references the panel resolved.
        defaultAgentId: params.references.application?.id ?? null,
        defaultAgentName: agentName ?? undefined,
        // Without a resolved agent the person picks one, and the binding follows that pick.
        defaultReferences: params.references.application?.id ? params.references : undefined,
    })
    useViewForm({
        // An open form counts as edits: leaving it asks first.
        dirty: true,
        valid: true,
        save: async () => Boolean(await state.create()),
        leaveDescription: t("automations.screens.leaveMessage"),
        saveLabel: t("automations.screens.createAutomation"),
    })
    return (
        <div className="ag-scroll-no-bar h-full min-h-0 overflow-y-auto px-4 pb-6 pt-2">
            <AutomationCreateBody
                state={state}
                // The panel binds the agent; the field shows only when its id did not resolve.
                showAgentField={!params.references.application?.id}
                fixedKind
            />
        </div>
    )
}

export default AutomationNewViewBody
