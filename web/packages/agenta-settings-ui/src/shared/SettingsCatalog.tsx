import type {KeyboardEvent, ReactNode, Ref} from "react"

import {ListTableToolbar} from "@agenta/ui/list-table"
import {SkeletonBlock, cn} from "@agenta/ui/ui"
import {CaretRight, Plus} from "@phosphor-icons/react"

/** A row's state: `attention` names its problem beside the name, `available` draws a "+". */
export type SettingsCatalogStatus = "connected" | "attention" | "available"

export interface SettingsCatalogItem {
    key: string
    /** The provider's or platform's own mark, drawn inside the row's tile. */
    logo: ReactNode
    name: ReactNode
    description?: ReactNode
    status: SettingsCatalogStatus
    /** The problem on a broken row (shown beside its name), the verb on an available one. */
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
    /** The count beside the label. Defaults to the rows shown; `null` hides it. */
    count?: number | null
    /** Skeleton rows drawn after the real ones while more load, e.g. the next page. */
    pendingRows?: number
    /** Drawn under the group's rows, e.g. an infinite-scroll sentinel. */
    footer?: ReactNode
    /** Right of the heading, e.g. "Show all". */
    action?: ReactNode
    /** With `onToggle`, the heading folds the rows away. */
    collapsed?: boolean
    onToggle?: () => void
}

const FOCUS_RING =
    "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"

/** Rows sit in two columns where they fit, one on a phone. */
const ROW_GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-x-8 gap-y-0.5"

/** The "+" on a row one click from connecting. Broken rows say their problem beside the name. */
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
        // Not a <button>: the row can hold its own kebab button.
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
                <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[14.5px] font-medium leading-5 text-foreground">
                        {item.name}
                    </span>
                    {/* Beside the name and never truncated, so the problem always shows. */}
                    {attention ? (
                        <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-colorWarning">
                            <span aria-hidden className="size-1.5 rounded-full bg-current" />
                            {item.statusLabel}
                        </span>
                    ) : null}
                </span>
                {item.description ? (
                    <span className="truncate text-[13px] leading-[18px] text-muted-foreground">
                        {item.description}
                    </span>
                ) : null}
            </span>
            {item.status === "available" ? <ConnectMark label={item.statusLabel} /> : null}
            {item.menu}
        </div>
    )
}

/** A row's shape while it loads: the tile, the name, the subtitle. */
const SkeletonRow = () => (
    <div className="flex items-center gap-3.5 py-2.5" aria-hidden>
        <SkeletonBlock active className="size-8 shrink-0 rounded-lg" />
        <div className="flex flex-1 flex-col gap-1.5">
            <SkeletonBlock active className="h-4 w-1/3 rounded" />
            <SkeletonBlock active className="h-3.5 w-2/3 rounded" />
        </div>
    </div>
)

const skeletonRows = (count: number) =>
    Array.from({length: count}, (_, index) => <SkeletonRow key={`skeleton-${index}`} />)

/** A group's heading while it loads, the label's width roughly. */
const SkeletonGroup = ({rows}: {rows: number}) => (
    <section className="flex flex-col gap-3" aria-hidden>
        <SkeletonBlock active className="h-[18px] w-24 rounded" />
        <div className={ROW_GRID}>{skeletonRows(rows)}</div>
    </section>
)

const HEADING = "m-0 text-[13px] font-medium leading-[18px] text-muted-foreground"

const Count = ({group}: {group: Omit<SettingsCatalogGroup, "key">}) =>
    group.count === null ? null : (
        <span className="text-[13px] font-normal text-muted-foreground/60">
            {group.count ?? group.items.length}
        </span>
    )

/** One catalog group, exported for hosts that load groups on their own via `after`. */
export const SettingsCatalogSection = ({
    group,
    sectionRef,
}: {
    group: Omit<SettingsCatalogGroup, "key">
    /** For a host that loads the group once it nears the screen. */
    sectionRef?: Ref<HTMLElement>
}) => (
    <section ref={sectionRef} className="flex flex-col gap-3">
        <div className="flex min-h-6 items-center gap-1.5">
            {group.onToggle ? (
                <h2 className={HEADING}>
                    <button
                        type="button"
                        aria-expanded={!group.collapsed}
                        onClick={group.onToggle}
                        className={cn(
                            "flex cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent p-0 font-[inherit] text-inherit hover:text-foreground",
                            FOCUS_RING,
                        )}
                    >
                        {group.label}
                        <Count group={group} />
                        <CaretRight
                            size={12}
                            className={cn("transition-transform", !group.collapsed && "rotate-90")}
                        />
                    </button>
                </h2>
            ) : (
                <>
                    <h2 className={HEADING}>{group.label}</h2>
                    <Count group={group} />
                </>
            )}
            {group.action ? <div className="ml-auto flex">{group.action}</div> : null}
        </div>
        {group.collapsed ? null : group.items.length || group.pendingRows ? (
            <div className={ROW_GRID}>
                {group.items.map((item) => (
                    <CatalogRow key={item.key} item={item} />
                ))}
                {skeletonRows(group.pendingRows ?? 0)}
            </div>
        ) : null}
        {group.collapsed ? null : group.footer}
    </section>
)

/** A catalog page (AI providers, integrations, channels): connected first, then available. */
export const SettingsCatalog = ({
    search,
    groups,
    loading = false,
    empty,
    notice,
    after,
}: {
    search?: {value: string; onChange: (next: string) => void; placeholder: string}
    groups: SettingsCatalogGroup[]
    loading?: boolean
    /** Drawn when every group is empty, e.g. a search with no match. */
    empty?: ReactNode
    /** Drawn between the search and the groups: a load error, a failed removal. */
    notice?: ReactNode
    /** Drawn after the groups, in their rhythm: sections a host loads on its own. */
    after?: ReactNode
}) => {
    const shown = groups.filter(
        (group) => group.items.length > 0 || group.pendingRows || group.footer,
    )
    return (
        // The search sits close to what it filters; groups keep their wider gap between them.
        <div className="flex flex-col gap-5">
            {search ? (
                // Pinned to the body's top while the catalog scrolls; the host's fade starts below it.
                <div data-sticky-search className="sticky top-0 z-10 -mx-3 -mb-3 bg-background px-3 pb-3 pt-1">
                    <ListTableToolbar
                        className="mb-0"
                        search={search.value}
                        onSearchChange={search.onChange}
                        searchPlaceholder={search.placeholder}
                    />
                </div>
            ) : null}
            {notice}

            {loading ? (
                // The page's own shape: what is connected, then what is available.
                <div className="flex flex-col gap-8">
                    <SkeletonGroup rows={4} />
                    <SkeletonGroup rows={6} />
                </div>
            ) : shown.length === 0 && !after ? (
                empty
            ) : (
                <div className="flex flex-col gap-8">
                    {shown.map(({key, ...group}) => (
                        <SettingsCatalogSection key={key} group={group} />
                    ))}
                    {after}
                </div>
            )}
        </div>
    )
}
