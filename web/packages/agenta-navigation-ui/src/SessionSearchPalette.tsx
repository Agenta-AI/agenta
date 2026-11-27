import {memo, useCallback, type MouseEvent} from "react"

import {useT} from "@agenta/i18n"
import sessionFilterCatalog from "@agenta/i18n/catalogs/shell.sessionFilter"
import {
    SESSIONS_SIDEBAR_KEY,
    SIDEBAR_ENTITIES,
    sidebarSessionSearchLoadingAtom,
    sidebarSessionSearchOpenAtom,
    sidebarSessionSearchQueryAtom,
    sidebarSessionSearchResultsAtom,
} from "@agenta/navigation"
import {SkeletonRows} from "@agenta/ui/composed"
import {CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList} from "@agenta/ui/ui"
import {useAtom, useAtomValue} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

const NOTE_CLASS = "m-0 px-2 py-3 text-label text-muted-foreground"

/**
 * Search the project's sessions from the rail.
 *
 * The rail lists what you are working on now; this reaches the ones it does not. Rows are built
 * from the same registry entry the rail renders, so a hit carries the glyph, the link and the
 * open behaviour of the row it stands for.
 */
const SessionSearchPalette = ({projectURL}: {projectURL: string}) => {
    const router = useRouter()
    const t = useT(sessionFilterCatalog)
    const [open, setOpen] = useAtom(sidebarSessionSearchOpenAtom)
    const [query, setQuery] = useAtom(sidebarSessionSearchQueryAtom)
    const results = useAtomValue(sidebarSessionSearchResultsAtom)
    const loading = useAtomValue(sidebarSessionSearchLoadingAtom)

    const handleOpenChange = useCallback(
        (next: boolean) => {
            setOpen(next)
            // Cleared on close, so reopening never shows the last search's hits.
            if (!next) setQuery("")
        },
        [setOpen, setQuery],
    )

    // The registry is not a fixed set, and this renders outside the shell's error boundary.
    const entity = SIDEBAR_ENTITIES[SESSIONS_SIDEBAR_KEY]
    if (!entity) return null

    const typed = query.trim().length > 0

    return (
        <CommandDialog
            open={open}
            onOpenChange={handleOpenChange}
            title={t("shell.sessionFilter.searchSessions")}
            description={t("shell.sessionFilter.searchDescription")}
            // The host already matched the hits on the server.
            shouldFilter={false}
            // Opens at once: it is used many times an hour (MICRO-04).
            instant
        >
            <CommandInput
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder={t("shell.sessionFilter.searchSessions")}
            />
            <CommandList>
                {!typed ? (
                    <p className={NOTE_CLASS}>{t("shell.sessionFilter.searchHint")}</p>
                ) : loading ? (
                    <SkeletonRows count={3} className="gap-0.5 p-1" rowClassName="h-8" />
                ) : results.length === 0 ? (
                    <p className={NOTE_CLASS}>{t("shell.sessionFilter.noSessionsMatch")}</p>
                ) : (
                    <CommandGroup>
                        {results.map((ref) => {
                            const href = entity.childLink(ref, projectURL)
                            const go = () => {
                                entity.getOnClick?.(ref)?.()
                                handleOpenChange(false)
                            }
                            return (
                                <CommandItem
                                    key={ref.sessionId}
                                    value={ref.sessionId}
                                    // Enter and a plain click open the session here.
                                    onSelect={() => {
                                        go()
                                        void router.push(href)
                                    }}
                                >
                                    {/* The anchor keeps middle-click and ctrl+click for a new tab. */}
                                    <Link
                                        href={href}
                                        className="flex min-w-0 flex-1 items-center gap-2 !text-inherit no-underline"
                                        onClick={(event: MouseEvent) => {
                                            if (
                                                event.metaKey ||
                                                event.ctrlKey ||
                                                event.shiftKey ||
                                                event.altKey
                                            ) {
                                                event.stopPropagation()
                                                go()
                                                return
                                            }
                                            event.preventDefault()
                                        }}
                                    >
                                        <span className="flex shrink-0 items-center">
                                            {entity.getIcon?.(ref)}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate">
                                            {entity.getLabel(ref)}
                                        </span>
                                        {ref.agentName ? (
                                            <span className="max-w-[40%] shrink-0 truncate text-meta text-muted-foreground">
                                                {ref.agentName}
                                            </span>
                                        ) : null}
                                    </Link>
                                </CommandItem>
                            )
                        })}
                    </CommandGroup>
                )}
            </CommandList>
        </CommandDialog>
    )
}

export default memo(SessionSearchPalette)
