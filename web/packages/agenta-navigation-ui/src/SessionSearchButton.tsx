import {memo} from "react"

import {useT} from "@agenta/i18n"
import sessionFilterCatalog from "@agenta/i18n/catalogs/shell.sessionFilter"
import {sidebarSessionSearchOpenAtom} from "@agenta/navigation"
import {SimpleTooltip} from "@agenta/ui/composed"
import {Button} from "@agenta/ui/ui"
import {MagnifyingGlass} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

/**
 * Opens the session search, from the Sessions group row.
 *
 * It sits beside the filter menu because the two answer the same question at different scales:
 * the filter narrows what the rail lists, this reaches past it. Same control as the filter's
 * trigger (the kit's icon-xs ghost button), so the pair reads as one set of buttons.
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
                size="icon-xs"
                aria-label={name}
                aria-keyshortcuts={shortcut?.aria}
                className="text-muted-foreground hover:text-foreground"
                onClick={(event) => {
                    // Off the group row's stretched link anchor, as the filter trigger keeps its own.
                    event.preventDefault()
                    event.stopPropagation()
                    setOpen(true)
                }}
            >
                <MagnifyingGlass />
            </Button>
        </SimpleTooltip>
    )
}

export default memo(SessionSearchButton)
