import type {KeyboardEvent, ReactNode} from "react"

import {ListTableToolbar} from "@agenta/ui/list-table"
import {SkeletonBlock, cn} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"

/**
 * A row's state. A broken row (`attention`) names its problem at the head of its subtitle; a row
 * one click from connecting (`available`) draws a "+". A row under Connected says the rest.
 */
export type SettingsCatalogStatus = "connected" | "attention" | "available"

export interface SettingsCatalogItem {
    key: string
    /** The provider's or platform's own mark, drawn inside the row's tile. */
    logo: ReactNode
    name: ReactNode
    description?: ReactNode
    status: SettingsCatalogStatus
    /** The problem on a broken row (shown in its subtitle), the verb on an available one. */
    statusLabel: string
    /** Opening the row: the connection's detail when connected, the connect flow when not. */
    onOpen?: () => void
    /** A row kebab for the verbs that are not the row click. */
    menu?: ReactNode
    testId?: string
}

export interface SettingsCatalogGroup {
    key: string
    label: string
    items: SettingsCatalogItem[]
    /** Drawn under the group's rows, e.g. "Browse all integrations". */
    footer?: ReactNode
}

const FOCUS_RING =
    "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"

/** Rows sit in two columns where they fit, one on a phone. */
const ROW_GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-x-8 gap-y-0.5"

/** The "+" on a row one click from connecting. Broken rows say their problem in the subtitle. */
const ConnectMark = ({label}: {label: string}) => (
    <span
        title={label}
        aria-label={label}
        role="img"
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground"
    >
        <Plus size={15} />
    </span>
)

const CatalogRow = ({item}: {item: SettingsCatalogItem}) => {
    const open = item.onOpen
    const attention = item.status === "attention"
    return (
        // Not a <button>: the row can carry a kebab of its own, and a button in a button is
        // invalid HTML.
        <div
            data-testid={item.testId}
            role={open ? "button" : undefined}
            tabIndex={open ? 0 : undefined}
            onClick={open}
            onKeyDown={
                open
                    ? (event: KeyboardEvent<HTMLDivElement>) => {
                          if (event.key !== "Enter" && event.key !== " ") return
                          event.preventDefault()
                          open()
                      }
                    : undefined
            }
            className={cn(
                "-mx-3 flex min-w-0 items-center gap-3.5 rounded-[10px] px-3 py-2.5",
                open && "cursor-pointer hover:bg-accent/60",
                open && FOCUS_RING,
            )}
        >
            <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-solid border-border bg-background shadow-xs [&_img]:size-[18px] [&_img]:object-contain [&_svg]:size-[18px]">
                {item.logo}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate text-[14.5px] font-medium leading-5 text-foreground">
                    {item.name}
                </span>
                {item.description || attention ? (
                    <span className="truncate text-[13px] leading-[18px] text-muted-foreground">
                        {/* The problem leads the line, so truncation never hides it. */}
                        {attention ? (
                            <span className="font-medium text-colorWarning">
                                <span
                                    aria-hidden
                                    className="mr-1.5 inline-block size-1.5 rounded-full bg-current align-middle"
                                />
                                {item.statusLabel}
                                {item.description ? " · " : null}
                            </span>
                        ) : null}
                        {item.description}
                    </span>
                ) : null}
            </span>
            {item.status === "available" ? <ConnectMark label={item.statusLabel} /> : null}
            {item.menu}
        </div>
    )
}

/**
 * A Settings page that is a catalog of things to connect: AI providers, integrations, channels.
 *
 * What is connected comes first, then what is available, each a run of rows under a heading with
 * its count. A row opens its connection when connected and starts the connect flow when not, so
 * the page needs no separate "Add" button.
 */
export const SettingsCatalog = ({
    search,
    groups,
    loading = false,
    empty,
    notice,
}: {
    search?: {value: string; onChange: (next: string) => void; placeholder: string}
    groups: SettingsCatalogGroup[]
    loading?: boolean
    /** Drawn when every group is empty, e.g. a search with no match. */
    empty?: ReactNode
    /** Drawn between the search and the groups: a load error, a failed removal. */
    notice?: ReactNode
}) => {
    const shown = groups.filter((group) => group.items.length > 0 || group.footer)
    return (
        <div className="flex flex-col gap-8">
            {search || notice ? (
                <div className="flex flex-col gap-3">
                    {search ? (
                        <ListTableToolbar
                            className="mb-0"
                            search={search.value}
                            onSearchChange={search.onChange}
                            searchPlaceholder={search.placeholder}
                        />
                    ) : null}
                    {notice}
                </div>
            ) : null}

            {loading ? (
                <section className="flex flex-col gap-3" aria-hidden>
                    <SkeletonBlock active className="h-[18px] w-24 rounded" />
                    <div className={ROW_GRID}>
                        {[0, 1, 2, 3].map((index) => (
                            <div key={index} className="flex items-center gap-3.5 py-2.5">
                                <SkeletonBlock active className="size-8 shrink-0 rounded-lg" />
                                <div className="flex flex-1 flex-col gap-1.5">
                                    <SkeletonBlock active className="h-4 w-1/3 rounded" />
                                    <SkeletonBlock active className="h-3.5 w-2/3 rounded" />
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            ) : shown.length === 0 ? (
                empty
            ) : (
                shown.map((group) => (
                    <section key={group.key} className="flex flex-col gap-3">
                        <div className="flex items-baseline gap-1.5">
                            <h2 className="m-0 text-[13px] font-medium leading-[18px] text-muted-foreground">
                                {group.label}
                            </h2>
                            <span className="text-[13px] text-muted-foreground/60">
                                {group.items.length}
                            </span>
                        </div>
                        {group.items.length ? (
                            <div className={ROW_GRID}>
                                {group.items.map((item) => (
                                    <CatalogRow key={item.key} item={item} />
                                ))}
                            </div>
                        ) : null}
                        {group.footer}
                    </section>
                ))
            )}
        </div>
    )
}
