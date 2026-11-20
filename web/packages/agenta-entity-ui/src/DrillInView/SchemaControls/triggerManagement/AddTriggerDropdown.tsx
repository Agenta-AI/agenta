/** The Automations region's "Add automation" menu (F05 f2). */
import {useCallback, useRef, type ReactNode} from "react"

import {
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
} from "@agenta/entities/gatewayTrigger"
import {useT} from "@agenta/i18n"
import agentOperationsCatalog from "@agenta/i18n/catalogs/entityUi.agentOperations"
import triggersCatalog from "@agenta/i18n/catalogs/entityUi.triggers"
import {composerPrefillRequestAtom} from "@agenta/shared/state"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {Clock, Lightning, Sparkle} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {SectionAddButton} from "../agentTemplate/SectionAddButton"

import {useAgentTriggers} from "./useAgentTriggers"

/** One row: an icon tile, a name, a one-line hint. Same shape as the other add menus. */
function MenuRow({
    icon,
    title,
    hint,
    onSelect,
}: {
    icon: ReactNode
    title: string
    hint: string
    onSelect: () => void
}) {
    return (
        <DropdownMenuItem onSelect={onSelect} className="gap-2.5 py-1.5">
            <span
                aria-hidden
                className="box-border flex size-8 flex-none items-center justify-center rounded-lg border border-solid border-border text-colorText"
            >
                {icon}
            </span>
            <span className="flex min-w-0 flex-col">
                <span className="text-sm text-colorText">{title}</span>
                <span className="truncate text-xs text-colorTextTertiary">{hint}</span>
            </span>
        </DropdownMenuItem>
    )
}

/**
 * "Add automation": "App trigger", "Scheduled trigger" and "Create with AI". The kind is chosen
 * here, so the form it opens has no switch between the two kinds. A new automation is bound to
 * the open agent. "Create with AI" puts the starter "I want an automation that" in the composer
 * and sends nothing.
 */
export type AutomationAddKind = "schedule" | "event"

export function AddTriggerDropdown({
    entityId,
    trigger,
    onAdd,
}: {
    entityId: string | null
    /** Custom trigger element. Defaults to the region's "+" button. */
    trigger?: ReactNode
    /**
     * Opens the form of the chosen kind in the host (the panel opens it as a view), with the
     * references that bind the new automation to this agent. Absent, the form opens in the
     * automation drawer.
     */
    onAdd?: (
        kind: AutomationAddKind,
        references: Record<string, {id?: string; slug?: string}>,
    ) => void
}) {
    const t = useT(triggersCatalog, agentOperationsCatalog)
    const {defaultReferences, defaultBoundLabel} = useAgentTriggers(entityId)
    const openSubscriptionDrawer = useSetAtom(triggerSubscriptionDrawerAtom)
    const openScheduleDrawer = useSetAtom(triggerScheduleDrawerAtom)
    const requestPrefill = useSetAtom(composerPrefillRequestAtom)
    // The menu gives focus back to its trigger as it closes. After "Create with AI" the composer
    // keeps it, so the caret the starter placed stays.
    const choseAIRef = useRef(false)

    const draft = {
        defaultReferences,
        defaultBoundLabel,
        playgroundEntityId: entityId ?? undefined,
        fixedKind: true,
    }
    const createWithAI = useCallback(() => {
        choseAIRef.current = true
        requestPrefill({
            id: Date.now(),
            text: t("entityUi.agentOperations.automationStarter"),
        })
    }, [requestPrefill, t])

    const label = t("entityUi.agentOperations.addAutomation")
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                {trigger ?? <SectionAddButton label={label} />}
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                className="w-64"
                onCloseAutoFocus={(event) => {
                    if (!choseAIRef.current) return
                    choseAIRef.current = false
                    event.preventDefault()
                }}
            >
                <MenuRow
                    icon={<Lightning size={16} />}
                    title={t("entityUi.triggers.appTrigger")}
                    hint={t("entityUi.triggers.appTriggerSubtitle")}
                    onSelect={() =>
                        onAdd
                            ? onAdd("event", defaultReferences ?? {})
                            : openSubscriptionDrawer(draft)
                    }
                />
                <MenuRow
                    icon={<Clock size={16} />}
                    title={t("entityUi.triggers.scheduledTrigger")}
                    hint={t("entityUi.triggers.scheduledTriggerSubtitle")}
                    onSelect={() =>
                        onAdd
                            ? onAdd("schedule", defaultReferences ?? {})
                            : openScheduleDrawer(draft)
                    }
                />
                <MenuRow
                    icon={<Sparkle size={16} />}
                    title={t("entityUi.triggers.createWithAi")}
                    hint={t("entityUi.triggers.createWithAiSubtitle")}
                    onSelect={createWithAI}
                />
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
