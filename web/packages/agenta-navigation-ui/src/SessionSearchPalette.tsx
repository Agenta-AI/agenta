import {memo, useCallback, type ReactNode} from "react"

import {
    SESSIONS_SIDEBAR_KEY,
    SIDEBAR_ENTITIES,
    sidebarSessionSearchLoadingAtom,
    sidebarSessionSearchOpenAtom,
    sidebarSessionSearchQueryAtom,
    sidebarSessionSearchResultsAtom,
} from "@agenta/navigation"
import {Dialog, DialogContent, DialogTitle, Input} from "@agenta/ui/ui"
import {MagnifyingGlass} from "@phosphor-icons/react"
import {useAtom, useAtomValue} from "jotai"
import Link from "next/link"

const Hint = ({children}: {children: ReactNode}) => (
    <span className="rounded border border-solid border-colorBorderSecondary px-1.5 py-0.5 font-mono text-[11px] leading-none text-colorTextTertiary">
        {children}
    </span>
)

/**
 * Search the project's sessions from the rail.
 *
 * The rail lists what you are working on now; this reaches the ones it does not. Rows are built
 * from the same registry entry the rail renders, so a hit carries the glyph, the link and the
 * open behaviour of the row it stands for.
 */
const SessionSearchPalette = ({projectURL}: {projectURL: string}) => {
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

    // The registry is not a fixed set — Agents was removed from it — and this renders inside the
    // rail's footer slot, OUTSIDE the shell's error boundary. Absent means no palette, not a
    // crashed rail.
    const entity = SIDEBAR_ENTITIES[SESSIONS_SIDEBAR_KEY]
    if (!entity) return null

    const typed = query.trim().length > 0

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                showCloseButton={false}
                // self-start over the positioner's centring: a palette belongs under the pointer
                // that opened it, not in the middle of the screen.
                className="box-border w-[440px] max-w-[calc(100%-48px)] gap-0 self-start overflow-hidden rounded-[10px] border border-solid border-colorBorderSecondary p-0 mt-[15vh]"
            >
                <DialogTitle className="sr-only">Search sessions</DialogTitle>
                <div className="flex h-11 items-center gap-[10px] border-0 border-b border-solid border-colorBorderSecondary px-3.5">
                    <MagnifyingGlass size={16} className="shrink-0 text-colorTextTertiary" />
                    <Input
                        autoFocus
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search sessions"
                        className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:outline-none"
                    />
                    <Hint>esc</Hint>
                </div>
                <div className="ag-scroll-quiet max-h-[340px] overflow-y-auto p-1.5">
                    {!typed ? (
                        <p className="m-0 px-2 py-3 text-[13px] text-colorTextTertiary">
                            Type to search this project&apos;s sessions.
                        </p>
                    ) : loading ? (
                        <p className="m-0 px-2 py-3 text-[13px] text-colorTextTertiary">
                            Searching…
                        </p>
                    ) : results.length === 0 ? (
                        <p className="m-0 px-2 py-3 text-[13px] text-colorTextTertiary">
                            No sessions match
                        </p>
                    ) : (
                        results.map((ref) => (
                            <Link
                                key={ref.sessionId}
                                href={entity.childLink(ref, projectURL)}
                                className="flex h-[34px] items-center gap-[10px] rounded-md px-2 text-[13px] !text-colorText no-underline hover:bg-colorFillQuaternary"
                                onClick={() => {
                                    entity.getOnClick?.(ref)?.()
                                    handleOpenChange(false)
                                }}
                            >
                                <span className="flex shrink-0 items-center">
                                    {entity.getIcon?.(ref)}
                                </span>
                                <span className="min-w-0 flex-1 truncate">
                                    {entity.getLabel(ref)}
                                </span>
                                {ref.agentName ? (
                                    <span className="shrink-0 truncate text-[12px] text-colorTextTertiary">
                                        {ref.agentName}
                                    </span>
                                ) : null}
                            </Link>
                        ))
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}

export default memo(SessionSearchPalette)
