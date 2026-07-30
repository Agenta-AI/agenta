/** The Triggers section header's "+ Trigger" add dropdown. */
import {type ReactNode, useMemo} from "react"

import {
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
} from "@agenta/entities/gatewayTrigger"
import {Clock, Lightning, Plus, Sparkle} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useSetAtom} from "jotai"

import {AddItemMenu, type AddItemGroup} from "../../../drawers/shared/AddItemMenu"

import {useAgentTriggers} from "./useAgentTriggers"

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
    const {defaultReferences, defaultBoundLabel} = useAgentTriggers(entityId)
    const openSubscriptionDrawer = useSetAtom(triggerSubscriptionDrawerAtom)
    const openScheduleDrawer = useSetAtom(triggerScheduleDrawerAtom)

    // Shares the tools add-menu's row treatment (AddItemMenu). A trigger is always a NEW trigger of
    // some kind, so the tools' "add existing / create new" split doesn't apply — one "Add new"
    // section (kept labelled for visual consistency with the tools popover) lists the trigger types.
    const groups: AddItemGroup[] = useMemo(
        () => [
            {
                label: "Add new",
                items: [
                    {
                        key: "app",
                        icon: <Lightning size={17} />,
                        title: "App trigger",
                        subtitle: "React to an event from a connected app",
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
                        title: "Scheduled trigger",
                        subtitle: "Run on a recurring schedule",
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
                        title: "Create with AI",
                        subtitle: "Describe it and let AI set it up",
                        disabled: true,
                        disabledHint: "Coming soon",
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

    return (
        <AddItemMenu
            groups={groups}
            ariaLabel="Add trigger"
            trigger={
                trigger ?? (
                    <Tooltip title="Add trigger">
                        <Button
                            type="text"
                            icon={<Plus size={16} />}
                            aria-label="Add trigger"
                            onClick={(e) => e.stopPropagation()}
                        />
                    </Tooltip>
                )
            }
        />
    )
}
