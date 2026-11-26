/** The Automations region's "Add automation" menu (F05 f2), and its phone form (M10, M11). */
import {useMemo, useState} from "react"

import {
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
} from "@agenta/entities/gatewayTrigger"
import {createT, textVersionAtom, useT} from "@agenta/i18n"
import agentOperationsCatalog from "@agenta/i18n/catalogs/entityUi.agentOperations"
import triggersCatalog from "@agenta/i18n/catalogs/entityUi.triggers"
import {BottomSheetMenu, PhonePrimaryAction} from "@agenta/ui/phone"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {Clock, Lightning, Plus} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {useAgentTriggers} from "./useAgentTriggers"

const tNow = createT(triggersCatalog)

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
    const textVersion = useAtomValue(textVersionAtom)
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
                title: tNow("entityUi.triggers.appTrigger"),
                hint: tNow("entityUi.triggers.appTriggerSubtitle"),
                onSelect: () =>
                    onAdd
                        ? onAdd("subscription", defaultReferences)
                        : openSubscriptionDrawer(draft),
            },
            {
                key: "schedule",
                icon: <Clock size={16} />,
                title: tNow("entityUi.triggers.scheduledTrigger"),
                hint: tNow("entityUi.triggers.scheduledTriggerSubtitle"),
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
        textVersion,
    ])
}

/**
 * "Add automation" (F05 f2): a bordered button and its menu with "App trigger" and "Scheduled
 * trigger". The kind is chosen here, so the form it opens has no switch between the two kinds.
 */
export function AddTriggerDropdown({
    entityId,
    onAdd,
}: {
    entityId: string | null
    onAdd?: OnAddAutomation
}) {
    const t = useT(triggersCatalog, agentOperationsCatalog)
    const items = useManualAutomationItems(entityId, onAdd)

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="compact">
                    <Plus size={14} />
                    {t("entityUi.agentOperations.addAutomation")}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                className="w-[270px]"
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
                            className="mt-0.5 flex shrink-0 text-muted-foreground [&_svg]:size-3.5"
                        >
                            {item.icon}
                        </span>
                        <span className="flex min-w-0 flex-col">
                            <span className="text-label text-foreground">{item.title}</span>
                            <span className="text-meta text-muted-foreground">{item.hint}</span>
                        </span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

/**
 * "Add automation" on a phone (M10, M11): the full-width button at the bottom of the list, and
 * the bottom sheet with the same two entries and "Cancel". Render it as the last child of the
 * list's scrolling column.
 */
export function AddAutomationPhoneAction({
    entityId,
    onAdd,
}: {
    entityId: string | null
    onAdd?: OnAddAutomation
}) {
    const t = useT(triggersCatalog, agentOperationsCatalog)
    const manualItems = useManualAutomationItems(entityId, onAdd)
    const [open, setOpen] = useState(false)
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
                items={manualItems.map((item) => ({
                    key: item.key,
                    icon: item.icon,
                    label: item.title,
                    description: item.hint,
                    onSelect: item.onSelect,
                }))}
            />
        </>
    )
}
