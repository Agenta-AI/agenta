import {useCallback, useState} from "react"

import {Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"

import {AgentsQuickPanel} from "./AgentsQuickPanel"

/** The Agents row's "+": opens the agents flyout with its top-left corner under the button. */
export const AgentsNavAction = ({base}: {base: string}) => {
    const [open, setOpen] = useState(false)
    const close = useCallback(() => setOpen(false), [])

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                {/* Same geometry and tokens as the session headings' "+". */}
                <button
                    type="button"
                    aria-label="New agent or open an agent"
                    title="New agent or open an agent"
                    className="text-colorTextTertiary hover:bg-colorFillTertiary hover:text-colorText flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0"
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
                <AgentsQuickPanel base={base} onDone={close} />
            </PopoverContent>
        </Popover>
    )
}
