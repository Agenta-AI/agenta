import {useCallback} from "react"

import {sidebarSessionSearchOpenAtom, sidebarSessionSearchQueryAtom} from "@agenta/navigation"
import {CommandPalette} from "@agenta/navigation-ui"
import {useAtom} from "jotai"
import {useRouter} from "next/router"

import {useCommandPaletteGroups} from "./useCommandPaletteGroups"

/**
 * The palette, mounted ONCE per screen (in the app shell): the rail and the drawer both render
 * the nav, and each would otherwise mount its own dialog over the same open atom. The rail's
 * search button and ⌘K open it; the drawer closes itself when it does.
 */
export const MobileCommandPalette = ({projectURL}: {projectURL: string}) => {
    const router = useRouter()
    const [open, setOpen] = useAtom(sidebarSessionSearchOpenAtom)
    const [query, setQuery] = useAtom(sidebarSessionSearchQueryAtom)
    const {groups, loading} = useCommandPaletteGroups(projectURL, query)

    const onOpenChange = useCallback(
        (next: boolean) => {
            setOpen(next)
            // Cleared on close, so a reopen starts empty rather than on the last search.
            if (!next) setQuery("")
        },
        [setOpen, setQuery],
    )
    const onNavigate = useCallback((href: string) => void router.push(href), [router])

    return (
        <CommandPalette
            open={open}
            onOpenChange={onOpenChange}
            query={query}
            onQueryChange={setQuery}
            groups={groups}
            loading={loading}
            onNavigate={onNavigate}
            shortcut
        />
    )
}
