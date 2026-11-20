/** The Automations region's "Add automation" menu (F05 f2), and its phone form (M10, M11). */
import {useCallback, useMemo, useRef, useState} from "react"

import {
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
} from "@agenta/entities/gatewayTrigger"
import {useT} from "@agenta/i18n"
import agentOperationsCatalog from "@agenta/i18n/catalogs/entityUi.agentOperations"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import triggersCatalog from "@agenta/i18n/catalogs/entityUi.triggers"
import {composerPrefillRequestAtom} from "@agenta/shared/state"
import {BottomSheetMenu, PhonePrimaryAction} from "@agenta/ui/phone"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {Clock, Lightning, Plus, Sparkle} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {useAgentTriggers} from "./useAgentTriggers"

/**
 * Opens the form of the chosen kind in the host (the panel opens it as a view), with the
 * references that bind the new automation to this agent. Absent, the form opens in the automation
 * drawer.
 */
type OnAddAutomation = (
    kind: "schedule" | "subscription",
    references: Record<string, {id?: string; slug?: string}>,
) => void

/** "App trigger" and "Scheduled trigger", each opening its form with the kind fixed. */
function useManualAutomationItems(entityId: string | null, onAdd?: OnAddAutomation) {
    const t = useT(triggersCatalog)
    const {defaultReferences, defaultBoundLabel} = useAgentTriggers(entityId)
    const openSubscriptionDrawer = useSetAtom(triggerSubscriptionDrawerAtom)
    const openScheduleDrawer = useSetAtom(triggerScheduleDrawerAtom)

    return useMemo(() => {
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
}

/**
 * "Add automation" (F05 f2): the bordered button at the top right of the list, and its menu with
 * "App trigger", "Scheduled trigger" and "Create with AI". The kind is chosen here, so the form it
 * opens has no switch between the two kinds. A new automation is bound to the open agent.
 * "Create with AI" puts the starter "I want an automation that" in the composer and sends nothing.
 */
export function AddTriggerDropdown({
    entityId,
    onAdd,
}: {
    entityId: string | null
    onAdd?: OnAddAutomation
}) {
    const t = useT(triggersCatalog, agentOperationsCatalog, configItemsCatalog)
    const manualItems = useManualAutomationItems(entityId, onAdd)
    const requestPrefill = useSetAtom(composerPrefillRequestAtom)
    const starter = t("entityUi.agentOperations.automationStarter")
    // The menu gives focus back to its button as it closes; after "Create with AI" the composer
    // keeps it, or the caret the starter just placed is lost.
    const choseAI = useRef(false)
    const items = [
        ...manualItems,
        {
            key: "ai",
            icon: <Sparkle size={14} />,
            title: t("entityUi.configItems.createWithAi"),
            hint: t("entityUi.triggers.createWithAiSubtitle"),
            onSelect: () => {
                choseAI.current = true
                requestPrefill({id: Date.now(), text: starter})
            },
        },
    ]

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="font-normal">
                    <Plus size={14} />
                    {t("entityUi.agentOperations.addAutomation")}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                className="w-[270px]"
                onCloseAutoFocus={(event) => {
                    if (!choseAI.current) return
                    choseAI.current = false
                    event.preventDefault()
                }}
            >
                {items.map((item) => (
                    // A plain icon and a hint that wraps to a second line rather than being cut.
                    <DropdownMenuItem
                        key={item.key}
                        onSelect={item.onSelect}
                        className="items-start gap-2 p-2"
                    >
                        <span
                            aria-hidden
                            className="mt-0.5 flex shrink-0 text-colorTextSecondary [&_svg]:size-3.5"
                        >
                            {item.icon}
                        </span>
                        <span className="flex min-w-0 flex-col">
                            <span className="text-[13px] text-colorText">{item.title}</span>
                            <span className="text-xs text-colorTextTertiary">{item.hint}</span>
                        </span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

/**
 * "Add automation" on a phone (M10, M11): the full-width button at the bottom of the list, and
 * the bottom sheet with the same three entries and "Cancel". Render it as the last child of the
 * list's scrolling column.
 */
export function AddAutomationPhoneAction({
    entityId,
    onAdd,
}: {
    entityId: string | null
    onAdd?: OnAddAutomation
}) {
    const t = useT(triggersCatalog, agentOperationsCatalog, configItemsCatalog)
    const manualItems = useManualAutomationItems(entityId, onAdd)
    const requestPrefill = useSetAtom(composerPrefillRequestAtom)
    const [open, setOpen] = useState(false)
    const starter = t("entityUi.agentOperations.automationStarter")
    const createWithAI = useCallback(
        () => requestPrefill({id: Date.now(), text: starter}),
        [requestPrefill, starter],
    )
    const label = t("entityUi.agentOperations.addAutomation")

    return (
        <>
            <PhonePrimaryAction icon={<Plus size={14} />} onClick={() => setOpen(true)}>
                {label}
            </PhonePrimaryAction>
            <BottomSheetMenu
                open={open}
                onOpenChange={setOpen}
                title={label}
                items={[
                    ...manualItems.map((item) => ({
                        key: item.key,
                        icon: item.icon,
                        label: item.title,
                        description: item.hint,
                        onSelect: item.onSelect,
                    })),
                    {
                        key: "ai",
                        icon: <Sparkle size={16} />,
                        label: t("entityUi.configItems.createWithAi"),
                        description: t("entityUi.triggers.createWithAiSubtitle"),
                        onSelect: createWithAI,
                    },
                ]}
            />
        </>
    )
}
