import {memo} from "react"

import {sidebarSessionSearchOpenAtom} from "@agenta/navigation"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {MagnifyingGlass} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

/**
 * Opens the session search, from the Sessions group row.
 *
 * It sits beside the filter menu because the two answer the same question at different scales:
 * the filter narrows what the rail lists, this reaches past it. Same control as the filter's
 * trigger — a 22px ghost square — so the pair reads as one set of buttons.
 */
const SessionSearchButton = ({
    label = "Search sessions",
    shortcut,
}: {
    /** What the button is called — the tooltip and the accessible name. A host whose search
     * reaches past sessions (the mobile palette) says so. */
    label?: string
    /** The chord that also opens it, already resolved for the platform (`["⌘", "K"]`), with
     * its `aria-keyshortcuts` form. Absent when the host binds none. */
    shortcut?: {faces: string[]; aria?: string}
}) => {
    const setOpen = useSetAtom(sidebarSessionSearchOpenAtom)
    return (
        <SimpleTooltip title={label} shortcut={shortcut?.faces}>
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={label}
                aria-keyshortcuts={shortcut?.aria}
                className="size-[22px] p-0 text-colorTextTertiary hover:text-colorText"
                onClick={(event) => {
                    // Off the group row's stretched link anchor, as the filter trigger keeps its own.
                    event.preventDefault()
                    event.stopPropagation()
                    setOpen(true)
                }}
            >
                <MagnifyingGlass size={12} />
            </Button>
        </SimpleTooltip>
    )
}

export default memo(SessionSearchButton)
