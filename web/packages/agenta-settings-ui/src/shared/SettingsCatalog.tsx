import type {KeyboardEvent, ReactNode, Ref} from "react"

import {SkeletonBlock, cn, PageToolbar} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"

import {SettingsGroupHeading} from "./SettingsGroupHeading"

/** A row's state: `attention` names its problem beside the name, `available` draws a "+". */
export type SettingsCatalogStatus = "connected" | "attention" | "available"

export interface SettingsCatalogItem {
    key: string
    /** The provider's or platform's own mark, drawn inside the row's tile. */
    logo: ReactNode
    name: ReactNode
    /** A chip after the name, e.g. the owner in a list that mixes owners. */
    badge?: ReactNode
    description?: ReactNode
    status: SettingsCatalogStatus
    /** The problem on a broken row (shown beside its name), the verb on an available one. */
    statusLabel: string
    /** Opening the row: the connection's detail when connected, the connect flow when not. */
    onOpen?: () => void
    /** A row kebab for the verbs that are not the row click. */
    menu?: ReactNode
    testId?: string
    /** Listed but not connectable here: no "+", no click, greyed; `description` says why. */
    disabled?: boolean
}

export interface SettingsCatalogGroup {
    key: string
    /** The heading: a word, or a node such as the project switch. A folding group takes text. */
    label: ReactNode
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
    /** Shown with no rows too, e.g. a heading that is also the project switch. */
    keepWhenEmpty?: boolean
    /** One row per line, like a table, in place of two columns. */
    list?: boolean
    /** One line under the heading that says what the group is for. */
    description?: ReactNode
}

const FOCUS_RING = "outline-none focus-ring"

/** Rows sit in two columns where they fit, one on a phone. */
const ROW_GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-x-8 gap-y-0.5"

/** The "+" on a row one click from connecting. Broken rows say their problem beside the name. */
const ConnectMark = ({label}: {label: string}) => (
    <span
        title={label}
        aria-label={label}
        role="img"
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground transition-opacity duration-[var(--duration-fast)] group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:hover)]:opacity-0"
    >
        <Plus size={15} />
    </span>
)

const CatalogRow = ({item}: {item: SettingsCatalogItem}) => {
    const open = item.disabled ? undefined : item.onOpen
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
                          // Keys on a nested control (the kebab) belong to that control.
                          if (event.target !== event.currentTarget) return
                          if (event.key !== "Enter" && event.key !== " ") return
                          event.preventDefault()
                          open()
                      }
                    : undefined
            }
            aria-disabled={item.disabled || undefined}
            className={cn(
                // One row height per list (ROW-01): row-double with a description, row-single without.
                "group/row -mx-3 box-border flex min-w-0 items-center gap-3 rounded-md px-3",
                item.description ? "h-row-double" : "h-row-single",
                item.disabled && "cursor-not-allowed opacity-60",
                open &&
                    "cursor-pointer transition-colors duration-[var(--duration-fast)] hover:bg-accent",
                open && FOCUS_RING,
            )}
        >
            <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted [&_img]:size-4 [&_img]:object-contain [&_svg]:size-4">
                {item.logo}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-body font-medium leading-5 text-foreground">
                        {item.name}
                    </span>
                    {item.badge}
                    {/* Beside the name and never truncated, so the problem always shows. */}
                    {attention ? (
                        <span className="flex shrink-0 items-center gap-1.5 text-meta font-medium text-warning">
                            <span aria-hidden className="size-1.5 rounded-round bg-current" />
                            {/* A phone keeps the dot; the name needs the width. */}
                            <span className="max-sm:sr-only">{item.statusLabel}</span>
                        </span>
                    ) : null}
                </span>
                {item.description ? (
                    <span className="truncate text-label text-muted-foreground">
                        {item.description}
                    </span>
                ) : null}
            </span>
            {item.status === "available" && !item.disabled ? (
                <ConnectMark label={item.statusLabel} />
            ) : null}
            {item.menu}
        </div>
    )
}

/** A row's shape while it loads (STATE-02): the muted tile with its logo, the name and its line. */
const SkeletonRow = () => (
    <div className="-mx-3 box-border flex h-row-double items-center gap-3 px-3" aria-hidden>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
            <SkeletonBlock active className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-px">
            <div className="flex h-5 items-center">
                <SkeletonBlock active className="h-3.5 w-1/3" />
            </div>
            <div className="flex h-4.5 items-center">
                <SkeletonBlock active className="h-3 w-2/3" />
            </div>
        </div>
    </div>
)

const skeletonRows = (count: number) =>
    Array.from({length: count}, (_, index) => <SkeletonRow key={`skeleton-${index}`} />)

/** A group's heading while it loads, the label's width roughly. */
const SkeletonGroup = ({rows}: {rows: number}) => (
    <section className="flex flex-col gap-3" aria-hidden>
        <SkeletonBlock active className="h-4.5 w-24 rounded-sm" />
        <div className={ROW_GRID}>{skeletonRows(rows)}</div>
    </section>
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
        <SettingsGroupHeading
            label={group.label}
            count={group.count === null ? null : (group.count ?? group.items.length)}
            collapsed={group.collapsed}
            onToggle={group.onToggle}
            action={group.action}
        />
        {group.description ? (
            <p className="-mt-1.5 m-0 text-body-sm text-muted-foreground">{group.description}</p>
        ) : null}
        {group.collapsed ? null : group.items.length || group.pendingRows ? (
            <div
                // ROW-04: two-line rows 8 px apart, one-line rows 4 px.
                className={
                    group.list
                        ? group.pendingRows || group.items.some((item) => item.description)
                            ? "flex flex-col gap-2"
                            : "flex flex-col gap-1"
                        : ROW_GRID
                }
            >
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
    toolbar,
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
    /** Pinned under the search, e.g. filter chips. */
    toolbar?: ReactNode
}) => {
    const shown = groups.filter(
        (group) =>
            group.items.length > 0 || group.pendingRows || group.footer || group.keepWhenEmpty,
    )
    return (
        // The search sits close to what it filters; groups keep their wider gap between them.
        <div className="flex flex-col gap-5">
            {search ? (
                // Pinned to the body's top while the catalog scrolls; the host's fade starts below it.
                <div
                    data-sticky-search
                    className="sticky top-0 z-10 -mx-3 -mb-3 bg-background px-3 pb-3 pt-1"
                >
                    <PageToolbar
                        className="mb-0"
                        search={search.value}
                        onSearchChange={search.onChange}
                        searchPlaceholder={search.placeholder}
                    />
                    {toolbar}
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
