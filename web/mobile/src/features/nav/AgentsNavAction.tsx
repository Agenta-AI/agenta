import {useCallback, useContext, useState} from "react"

import {useT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {SidebarLayoutContext} from "@agenta/navigation-ui"
import {BottomSheet} from "@agenta/ui/phone"
import {Button, Popover, PopoverContent, PopoverTrigger, SimpleTooltip} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"

import {AgentsQuickPanel} from "./AgentsQuickPanel"

/** The Agents row's "+": opens the agents flyout under the button; a bottom sheet on a phone. */
export const AgentsNavAction = ({base}: {base: string}) => {
    const t = useT(navigationCatalog)
    const phone = useContext(SidebarLayoutContext) === "phone"
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const close = useCallback(() => setOpen(false), [])
    // Outside clicks and Escape wait out a create; `close` (navigation, a pick) does not.
    const onOpenChange = (next: boolean) => {
        if (next || !busy) setOpen(next)
    }
    const label = t("navigation.items.newAgentOrOpen")
    const trigger = (
        <Button type="button" variant="ghost" size="icon-xs" aria-label={label}>
            <Plus />
        </Button>
    )
    const panel = <AgentsQuickPanel base={base} onDone={close} onBusyChange={setBusy} />

    if (phone)
        return (
            <BottomSheet
                open={open}
                onOpenChange={onOpenChange}
                title={t("navigation.items.agents")}
                trigger={trigger}
            >
                {panel}
            </BottomSheet>
        )

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <SimpleTooltip title={label}>
                <span className="inline-flex">
                    <PopoverTrigger asChild>{trigger}</PopoverTrigger>
                </span>
            </SimpleTooltip>
            <PopoverContent
                side="bottom"
                align="start"
                sideOffset={4}
                collisionPadding={8}
                className="flex w-popover-md flex-col gap-0 p-0"
                // The panel takes the caret itself, a frame late.
                onOpenAutoFocus={(event) => event.preventDefault()}
            >
                {panel}
            </PopoverContent>
        </Popover>
    )
}
