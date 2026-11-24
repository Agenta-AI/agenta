import {useCallback, useState} from "react"

import {useT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"

import {AgentsQuickPanel} from "./AgentsQuickPanel"

/** The Agents row's "+": opens the agents flyout with its top-left corner under the button. */
export const AgentsNavAction = ({base}: {base: string}) => {
    const t = useT(navigationCatalog)
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const close = useCallback(() => setOpen(false), [])

    return (
        // Outside clicks and Escape wait out a create; `close` (navigation, a pick) does not.
        <Popover
            open={open}
            onOpenChange={(next) => {
                if (next || !busy) setOpen(next)
            }}
        >
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={t("navigation.items.newAgentOrOpen")}
                    title={t("navigation.items.newAgentOrOpen")}
                    className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent p-0"
                >
                    <Plus size={12} />
                </button>
            </PopoverTrigger>
            <PopoverContent
                side="bottom"
                align="start"
                sideOffset={4}
                collisionPadding={8}
                className="flex w-[280px] flex-col gap-0 p-0"
                // The panel takes the caret itself, a frame late.
                onOpenAutoFocus={(event) => event.preventDefault()}
            >
                <AgentsQuickPanel base={base} onDone={close} onBusyChange={setBusy} />
            </PopoverContent>
        </Popover>
    )
}
