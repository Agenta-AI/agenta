/** The Automations region's "Add automation" menu (F05 f2). */
import {useMemo} from "react"

import {
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
} from "@agenta/entities/gatewayTrigger"
import {useT} from "@agenta/i18n"
import agentOperationsCatalog from "@agenta/i18n/catalogs/entityUi.agentOperations"
import triggersCatalog from "@agenta/i18n/catalogs/entityUi.triggers"
import {Clock, Lightning} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {CreateWithAIAddMenu} from "../agentTemplate/CreateWithAIAddMenu"

import {useAgentTriggers} from "./useAgentTriggers"

/**
 * "Add automation" (F05 f2): "App trigger", "Scheduled trigger" and "Create with AI". The kind is
 * chosen here, so the form it opens has no switch between the two kinds. A new automation is
 * bound to the open agent. "Create with AI" puts the starter "I want an automation that" in the
 * composer and sends nothing.
 */
export function AddTriggerDropdown({
    entityId,
    onAdd,
}: {
    entityId: string | null
    /**
     * Opens the form of the chosen kind in the host (the panel opens it as a view), with the
     * references that bind the new automation to this agent. Absent, the form opens in the
     * automation drawer.
     */
    onAdd?: (
        kind: "schedule" | "subscription",
        references: Record<string, {id?: string; slug?: string}>,
    ) => void
}) {
    const t = useT(triggersCatalog, agentOperationsCatalog)
    const {defaultReferences, defaultBoundLabel} = useAgentTriggers(entityId)
    const openSubscriptionDrawer = useSetAtom(triggerSubscriptionDrawerAtom)
    const openScheduleDrawer = useSetAtom(triggerScheduleDrawerAtom)

    const manualItems = useMemo(() => {
        const draft = {
            defaultReferences,
            defaultBoundLabel,
            playgroundEntityId: entityId ?? undefined,
            fixedKind: true,
        }
        return [
            {
                key: "app",
                icon: <Lightning size={16} />,
                title: t("entityUi.triggers.appTrigger"),
                hint: t("entityUi.triggers.appTriggerSubtitle"),
                onSelect: () =>
                    onAdd
                        ? onAdd("subscription", defaultReferences)
                        : openSubscriptionDrawer(draft),
            },
            {
                key: "schedule",
                icon: <Clock size={16} />,
                title: t("entityUi.triggers.scheduledTrigger"),
                hint: t("entityUi.triggers.scheduledTriggerSubtitle"),
                onSelect: () =>
                    onAdd ? onAdd("schedule", defaultReferences) : openScheduleDrawer(draft),
            },
        ]
    }, [
        defaultBoundLabel,
        defaultReferences,
        entityId,
        onAdd,
        openScheduleDrawer,
        openSubscriptionDrawer,
        t,
    ])

    return (
        <CreateWithAIAddMenu
            label={t("entityUi.agentOperations.addAutomation")}
            starterPrompt={t("entityUi.agentOperations.automationStarter")}
            aiHint={t("entityUi.triggers.createWithAiSubtitle")}
            aiLast
            manualItems={manualItems}
        />
    )
}
