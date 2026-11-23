import {memo} from "react"

import {useT} from "@agenta/i18n"
import sessionFilterCatalog from "@agenta/i18n/catalogs/shell.sessionFilter"
import {sidebarSessionSearchOpenAtom} from "@agenta/navigation"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {MagnifyingGlass} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

/**
 * Opens the session search, from the Sessions group row.
 *
 * It sits beside the filter menu because the two answer the same question at different scales:
 * the filter narrows what the rail lists, this reaches past it. Same control as the filter's
 * trigger (a 24 px ghost square, radius 6, 14 px glyph in the secondary ink; 18 px on a phone),
 * 4 px apart, so the pair reads as one set of buttons.
 */
const SessionSearchButton = ({
    label,
    shortcut,
}: {
    /** What the button is called — the tooltip and the accessible name. A host whose search
     * reaches past sessions (the mobile palette) says so. */
    label?: string
    /** The chord that also opens it, already resolved for the platform (`["⌘", "K"]`), with
     * its `aria-keyshortcuts` form. Absent when the host binds none. */
    shortcut?: {faces: string[]; aria?: string}
}) => {
    const t = useT(sessionFilterCatalog)
    const setOpen = useSetAtom(sidebarSessionSearchOpenAtom)
    const name = label ?? t("shell.sessionFilter.searchSessions")
    return (
        <SimpleTooltip title={name} shortcut={shortcut?.faces}>
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={name}
                aria-keyshortcuts={shortcut?.aria}
                className="mr-0.5 size-6 rounded-md p-0 text-muted-foreground hover:text-foreground"
                onClick={(event) => {
                    // Off the group row's stretched link anchor, as the filter trigger keeps its own.
                    event.preventDefault()
                    event.stopPropagation()
                    setOpen(true)
                }}
            >
                <MagnifyingGlass className="size-3.5" />
            </Button>
        </SimpleTooltip>
    )
}

export default memo(SessionSearchButton)
