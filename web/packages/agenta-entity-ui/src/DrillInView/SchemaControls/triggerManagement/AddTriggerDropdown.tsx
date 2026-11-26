/** The Automations region's "Add automation" button, and its phone form (M10). */
import {triggerScheduleDrawerAtom} from "@agenta/entities/gatewayTrigger"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import agentOperationsCatalog from "@agenta/i18n/catalogs/entityUi.agentOperations"
import {PhonePrimaryAction} from "@agenta/ui/phone"
import {Button} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {useAgentTriggers} from "./useAgentTriggers"

/**
 * Opens the form of the chosen kind in the host (the panel opens it as a view), with the
 * references that bind the new automation to this agent. Absent, the form opens in the automation
 * drawer.
 */
export type OnAddAutomation = (
    kind: "schedule" | "subscription",
    references: Record<string, {id?: string; slug?: string}>,
) => void

/**
 * Opens the new-automation form. It opens as a schedule and the form offers the switch to an
 * app trigger, so nothing is chosen before it opens.
 */
export function useAddAutomation(entityId: string | null, onAdd?: OnAddAutomation) {
    const {defaultReferences, defaultBoundLabel} = useAgentTriggers(entityId)
    const openScheduleDrawer = useSetAtom(triggerScheduleDrawerAtom)
    return () =>
        onAdd
            ? onAdd("schedule", defaultReferences)
            : openScheduleDrawer({
                  defaultReferences,
                  defaultBoundLabel,
                  playgroundEntityId: entityId ?? undefined,
              })
}

/** "Add automation": a bordered button that opens the new-automation form. */
export function AddTriggerDropdown({
    entityId,
    onAdd,
    quiet = false,
}: {
    entityId: string | null
    onAdd?: OnAddAutomation
    /** A quiet "Add" beside a heading that already says "Automations" (the panel's list). */
    quiet?: boolean
}) {
    const t = useT(agentOperationsCatalog, commonCatalog)
    const add = useAddAutomation(entityId, onAdd)
    return quiet ? (
        <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={t("entityUi.agentOperations.addAutomation")}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={add}
        >
            <Plus size={14} />
            {t("common.add")}
        </Button>
    ) : (
        <Button type="button" variant="outline" size="compact" onClick={add}>
            <Plus size={14} />
            {t("entityUi.agentOperations.addAutomation")}
        </Button>
    )
}

/**
 * "Add automation" on a phone (M10): the full-width button at the bottom of the list. Render it
 * as the last child of the list's scrolling column.
 */
export function AddAutomationPhoneAction({
    entityId,
    onAdd,
}: {
    entityId: string | null
    onAdd?: OnAddAutomation
}) {
    const t = useT(agentOperationsCatalog)
    const add = useAddAutomation(entityId, onAdd)
    return (
        <PhonePrimaryAction icon={<Plus size={14} />} onClick={add}>
            {t("entityUi.agentOperations.addAutomation")}
        </PhonePrimaryAction>
    )
}
