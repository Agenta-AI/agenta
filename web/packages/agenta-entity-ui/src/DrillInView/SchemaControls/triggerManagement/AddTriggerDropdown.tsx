/** The Triggers section header's "+ Trigger" add dropdown. */
import {type ReactNode, useMemo} from "react"

import {
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
} from "@agenta/entities/gatewayTrigger"
import {createT, useT} from "@agenta/i18n"
import triggersCatalog from "@agenta/i18n/catalogs/entityUi.triggers"
import {Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {Clock, Lightning, Plus, Sparkle} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {AddItemMenu, type AddItemGroup} from "../../../drawers/shared/AddItemMenu"

import {useAgentTriggers} from "./useAgentTriggers"

const tNow = createT(triggersCatalog)

/**
 * The "+ Trigger" add affordance, rendered in the section header's `extra` slot. A
 * dropdown with: "Create with AI" (disabled placeholder), "App trigger" (opens the
 * catalog), and "Scheduled trigger" (opens the schedule create drawer, default-bound to
 * the current agent). Kept separate from the section body because the accordion renders
 * `extra` outside the section content.
 */
export function AddTriggerDropdown({
    entityId,
    trigger,
}: {
    entityId: string | null
    /** Custom trigger element (e.g. an inline text-link for an empty state). Defaults to a `+`. */
    trigger?: ReactNode
}) {
    const t = useT(triggersCatalog)
    const {defaultReferences, defaultBoundLabel} = useAgentTriggers(entityId)
    const openSubscriptionDrawer = useSetAtom(triggerSubscriptionDrawerAtom)
    const openScheduleDrawer = useSetAtom(triggerScheduleDrawerAtom)

    // Shares the tools add-menu's row treatment (AddItemMenu). A trigger is always a NEW trigger of
    // some kind, so the tools' "add existing / create new" split doesn't apply — one "Add new"
    // section (kept labelled for visual consistency with the tools popover) lists the trigger types.
    const groups: AddItemGroup[] = useMemo(
        () => [
            {
                label: tNow("entityUi.triggers.addNew"),
                items: [
                    {
                        key: "app",
                        icon: <Lightning size={17} />,
                        title: tNow("entityUi.triggers.appTrigger"),
                        subtitle: tNow("entityUi.triggers.appTriggerSubtitle"),
                        opensDrawer: true,
                        onSelect: () =>
                            openSubscriptionDrawer({
                                defaultReferences,
                                defaultBoundLabel,
                                playgroundEntityId: entityId ?? undefined,
                            }),
                    },
                    {
                        key: "schedule",
                        icon: <Clock size={17} />,
                        title: tNow("entityUi.triggers.scheduledTrigger"),
                        subtitle: tNow("entityUi.triggers.scheduledTriggerSubtitle"),
                        opensDrawer: true,
                        onSelect: () =>
                            openScheduleDrawer({
                                defaultReferences,
                                defaultBoundLabel,
                                playgroundEntityId: entityId ?? undefined,
                            }),
                    },
                    {
                        key: "ai",
                        icon: <Sparkle size={17} />,
                        title: tNow("entityUi.triggers.createWithAi"),
                        subtitle: tNow("entityUi.triggers.createWithAiSubtitle"),
                        disabled: true,
                        disabledHint: tNow("entityUi.triggers.comingSoon"),
                    },
                ],
            },
        ],
        [
            openSubscriptionDrawer,
            openScheduleDrawer,
            defaultReferences,
            defaultBoundLabel,
            entityId,
        ],
    )

    // A caller-supplied trigger (the empty-state text link) brings its own affordance.
    if (trigger)
        return (
            <AddItemMenu
                groups={groups}
                ariaLabel={t("entityUi.triggers.addTrigger")}
                trigger={trigger}
            />
        )

    // Tooltip + popover trigger compose by NESTING both `asChild` triggers on the same
    // button — a Radix Tooltip wrapped AROUND the popover trigger would swallow it
    // (PopoverTrigger's Slot would clone the Tooltip, not the button).
    return (
        <TooltipProvider>
            <Tooltip>
                <AddItemMenu
                    groups={groups}
                    ariaLabel={t("entityUi.triggers.addTrigger")}
                    trigger={
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label={t("entityUi.triggers.addTrigger")}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <Plus size={16} />
                            </Button>
                        </TooltipTrigger>
                    }
                />
                <TooltipContent>{t("entityUi.triggers.addTrigger")}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
