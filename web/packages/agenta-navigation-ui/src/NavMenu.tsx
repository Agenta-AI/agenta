import {Fragment, memo, useRef, type KeyboardEvent, type MouseEvent, type ReactNode} from "react"

import type {SidebarConfig, SidebarDragItem, SidebarMenuMode} from "@agenta/navigation"
import {HeightCollapse} from "@agenta/ui/components/presentational"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    SkeletonBlock,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {CaretRight} from "@phosphor-icons/react"
import clsx from "clsx"
import Link from "next/link"

import {SidebarReorderLayer} from "./reorder"

/**
 * The antd-free nav renderer: one `@agenta/navigation` model, any shell. Inline mode expands
 * groups in place (HeightCollapse); a collapsed rail turns leaves into tooltipped icons and
 * groups into Radix flyouts, reporting open state so gated sources fetch on demand.
 */
export type NavItem = SidebarConfig
export type NavMenuMode = SidebarMenuMode
export interface NavMenuProps {
    items: NavItem[]
    collapsed: boolean
    mode?: NavMenuMode
    openKeys?: string[]
    selectedKeys?: string[]
    onToggleOpenKey?: (key: string) => void
    onPopupOpenChange?: (key: string, open: boolean) => void
    /** Controlled scopes (settings): handle the click and suppress navigation. */
    onItemSelect?: (key: string, event: MouseEvent) => void
    className?: string
}

// calc, not 94%: an exact 8px inset each side, so the row's right edge lines up with the
// 8px-inset collapse toggle in the brand row.
// h-7 (28px), not h-9: the rail is a dense nav, and 36px rows pushed every item progressively
// further down the list than the desktop app has ever placed them.
// gap-[10px], not gap-2: antd Menu's icon margin is 10px, and at 8px every label in the
// rail sat 2px left of where the desktop app has always drawn it.
const ROW_BASE =
    "relative box-border mb-1 flex h-7 w-[calc(100%-16px)] mx-auto items-center gap-[10px] rounded-md px-3 text-sm leading-7 select-none"
const ROW_INTERACTIVE = "cursor-pointer text-colorText hover:bg-colorFillQuaternary"
// The rail's own selection tokens, not neutral fills: the pill is accent-washed and the
// LABEL AND ICON both take the accent (the icon inherits, so no separate rule). The ring
// is inset rather than a border so the row's box never changes size between states; it is
// transparent in dark, where the olive wash carries the state on its own.
const ROW_SELECTED =
    "bg-[var(--ag-shell-selected-bg)] font-medium !text-[var(--ag-shell-selected-text)] shadow-[inset_0_0_0_1px_var(--ag-shell-selected-border)]"
const ROW_DISABLED = "cursor-default text-colorTextQuaternary"
// Guide line marks the group's extent, the way the old inline menu did.
const GROUP_CHILDREN =
    "ml-[22px] flex flex-col border-0 border-l border-solid border-colorBorderSecondary pl-1"
// Stretches the anchor over the whole row so middle-click / ctrl+click work anywhere on it.
const LINK_CLASS =
    "!text-inherit no-underline before:absolute before:inset-0 before:content-[''] min-w-0 flex-1 truncate"

/** Three static attributes; the engine reads them off the DOM. No per-row handlers. */
const dragAttrs = (item?: SidebarDragItem) =>
    item
        ? {
              "data-drag-zone": item.zone,
              "data-drag-id": item.id,
              "data-drag-kind": item.kind,
              "aria-roledescription": "sortable",
          }
        : undefined

/** Faded in place while dragged — no gap opens, and a heading's rows fade with it. */
const DRAG_GHOST = "[&_[data-drag-ghost=true]]:opacity-35"

/**
 * Alt+Arrow moves an arrangeable row without a pointer. Returns true when it handled the key.
 * Alt, not a bare arrow, so the browser's own scrolling is untouched. The engine is already
 * loaded by the time anyone reaches for this on a row they can also drag.
 */
const onMoveKey = (event: KeyboardEvent<HTMLElement>): boolean => {
    if (!event.altKey) return false
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0
    if (!delta) return false
    const el = event.currentTarget
    if (!el.dataset.dragZone) return false
    event.preventDefault()
    void import("./reorder/engine").then(({moveByKeyboard}) => {
        const message = moveByKeyboard(el, delta as -1 | 1)
        if (message) void import("./reorder/overlay").then((m) => m.announceReorder(message))
    })
    return true
}

const TagChip = ({tag}: {tag?: string}) =>
    tag ? (
        <span className="shrink-0 rounded bg-colorSuccessBg px-1 py-0.5 text-[12px] leading-none text-colorSuccessText">
            {tag}
        </span>
    ) : null

const Tip = ({title, children}: {title: ReactNode; children: ReactNode}) => (
    <TooltipProvider delayDuration={600}>
        <Tooltip>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent side="right">{title}</TooltipContent>
        </Tooltip>
    </TooltipProvider>
)

const isExternal = (link?: string) => Boolean(link?.startsWith("http"))

/**
 * What clicking a nav link does. Every `<Link>` here runs this — inline rows, the collapsed
 * rail's stretched anchor, and the flyout — so an inert or controlled item behaves the same
 * wherever it is rendered. It deliberately does NOT stop propagation: no ancestor row carries
 * a click handler when a link is present, and hosts listen for the bubble (the mobile drawer
 * closes itself on it).
 */
const linkClickHandler =
    (item: NavItem, onItemSelect?: NavMenuProps["onItemSelect"]) => (event: MouseEvent) => {
        // Inert item: keep it highlighted but cancel navigation and its onClick.
        if (item.inert) {
            event.preventDefault()
            return
        }
        if (onItemSelect) {
            event.preventDefault()
            onItemSelect(item.key, event)
            return
        }
        item.onClick?.(event)
    }

/**
 * A row's own click handler. Linked rows are driven by their stretched anchor instead; a
 * linkless row in a controlled scope (the settings rail) has nothing else to click.
 */
const rowClickHandler = (item: NavItem, onItemSelect?: NavMenuProps["onItemSelect"]) => {
    if (item.link || item.disabled || item.inert) return undefined
    if (onItemSelect) return (event: MouseEvent) => onItemSelect(item.key, event)
    return item.onClick
}

const RowLabel = memo(function RowLabel({
    item,
    onItemSelect,
}: {
    item: NavItem
    onItemSelect?: NavMenuProps["onItemSelect"]
}) {
    // Rows truncate at almost every rail width, so the label carries its own hover text: the
    // entity's tooltip where it has one, the full title otherwise. `Tip` is the collapsed rail's,
    // and both list groups hide their children there.
    const hover = item.tooltip ?? (typeof item.title === "string" ? item.title : undefined)
    const content = (
        <span className="flex w-full items-center">
            <span className="min-w-0 truncate" title={hover}>
                {item.title} <TagChip tag={item.tag} />
            </span>
            {item.suffix ? <span className="ml-auto shrink-0 pl-2">{item.suffix}</span> : null}
        </span>
    )
    if (item.isLoading) return <SkeletonBlock active className="h-4 min-w-[72px] flex-1" />
    if (!item.link || item.disabled)
        return (
            <span className="min-w-0 flex-1 truncate" data-tour={item.dataTour}>
                {content}
            </span>
        )
    const label = (
        <Link
            className={LINK_CLASS}
            data-tour={item.dataTour}
            // Browsers drag anchors natively; without this the link ghost rides along with ours.
            draggable={false}
            href={item.link}
            target={isExternal(item.link) ? "_blank" : undefined}
            rel={isExternal(item.link) ? "noopener noreferrer" : undefined}
            onClick={linkClickHandler(item, onItemSelect)}
        >
            {content}
        </Link>
    )
    // Per-row chrome (a kebab, a right-click menu) owns its own hooks — this only mounts it.
    return item.wrapRow ? item.wrapRow(label) : label
})

/** A group heading inside a submenu — a label over the rows below it, never a row itself.
 * With `onClick` it folds the rows under it away, and grows a caret to say so. */
const GroupLabelRow = memo(function GroupLabelRow({item}: {item: NavItem}) {
    const toggle = item.onClick
    if (!toggle)
        return (
            <p
                {...dragAttrs(item.dragItem)}
                className="m-0 mx-auto w-[calc(100%-16px)] px-3 pb-0.5 pt-2 text-[12px] uppercase tracking-wide text-colorTextTertiary select-none"
            >
                {item.title}
            </p>
        )
    return (
        <div
            role="button"
            tabIndex={0}
            aria-expanded={!item.isCollapsed}
            {...dragAttrs(item.dragItem)}
            // Not uppercase, unlike the static heading above: a collapsible heading labels an
            // ENTITY (an agent), and shouting a proper noun misspells it.
            className="mx-auto flex w-[calc(100%-16px)] cursor-pointer select-none items-center gap-1 rounded-md pb-0.5 pl-3 pr-0 pt-2 text-[12px] text-colorTextTertiary hover:text-colorText"
            onClick={toggle}
            onKeyDown={(event) => {
                if (onMoveKey(event)) return
                if (event.key !== "Enter" && event.key !== " ") return
                event.preventDefault()
                toggle(event as unknown as MouseEvent)
            }}
        >
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            {/* No fill on hover: the whole row already answers with a colour change, and a pill
                behind the caret made a heading look like a button it is not. */}
            <span
                aria-label={`${item.isCollapsed ? "Expand" : "Collapse"} ${item.title}`}
                className="mr-1 flex h-[22px] w-7 shrink-0 items-center justify-center"
            >
                <CaretRight
                    size={11}
                    className={clsx(
                        "transition-transform duration-200 ease-in-out",
                        !item.isCollapsed && "rotate-90",
                    )}
                />
            </span>
        </div>
    )
})

const LeafRow = memo(function LeafRow({
    item,
    selected,
    onItemSelect,
}: {
    item: NavItem
    selected: boolean
    onItemSelect?: NavMenuProps["onItemSelect"]
}) {
    const onClick = rowClickHandler(item, onItemSelect)
    // A controlled scope (Settings) gives its items `onItemSelect` and no `link`, so the row
    // is the only control there is — without this it is an unfocusable <div> wrapping a
    // <span>, and the whole rail is unreachable by keyboard. Link rows keep their <a>.
    const isControl = Boolean(onClick) && !item.link
    return (
        <div
            {...dragAttrs(item.dragItem)}
            className={clsx(
                ROW_BASE,
                item.disabled || item.isPlaceholder ? ROW_DISABLED : ROW_INTERACTIVE,
                selected && ROW_SELECTED,
                item.rowClassName,
                isControl &&
                    "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring",
            )}
            onClick={onClick}
            role={isControl ? "menuitem" : undefined}
            tabIndex={isControl ? 0 : undefined}
            aria-current={isControl && selected ? "page" : undefined}
            onKeyDown={(event) => {
                if (onMoveKey(event)) return
                if (!isControl) return
                if (event.key !== "Enter" && event.key !== " ") return
                event.preventDefault()
                onClick?.(event as unknown as MouseEvent)
            }}
        >
            {item.icon ? <span className="flex shrink-0 items-center">{item.icon}</span> : null}
            <RowLabel item={item} onItemSelect={onItemSelect} />
        </div>
    )
})

/** Within this many px of the bottom counts as reaching the end. */
const REACH_END_PX = 120

/** Long enough that one flick asks once, short enough not to be felt as a stall. */
const REACH_END_THROTTLE_MS = 400

/**
 * The one scrolling group's rows, which page in more as you reach the end.
 *
 * `onScroll` rather than an IntersectionObserver sentinel: a sentinel is permanently visible
 * whenever the content is shorter than the box — routine here, since headings collapse — and that
 * is a runaway fetch. A scroll handler cannot fire without a scroll. The autofill pass below
 * covers the case a scroll handler structurally cannot: no scrollbar yet, so no scroll to hear.
 */
const ScrollGroupChildren = ({
    children,
    onReachEnd,
}: {
    children: ReactNode
    onReachEnd?: () => void
}) => {
    const boxRef = useRef<HTMLDivElement>(null)
    // Throttled, NOT keyed on scrollHeight: a page whose rows all land in collapsed groups adds no
    // height, and a height-keyed guard would then never let another page be asked for. Time cannot
    // latch. The source's own in-flight check stops the duplicate a flick would otherwise queue.
    const askedAt = useRef(0)

    const reachEnd = () => {
        if (!onReachEnd) return
        const now = Date.now()
        if (now - askedAt.current < REACH_END_THROTTLE_MS) return
        askedAt.current = now
        onReachEnd()
    }

    return (
        // Its own scroll box, outside HeightCollapse: the animation drives height, and a scroll
        // area needs its height to come from the flex line instead. `min-h-0` is what lets it
        // shrink below its content; the rows around it hold their size on their own.
        <div
            ref={boxRef}
            data-nav-scroll="true"
            className={clsx(GROUP_CHILDREN, "min-h-0 overflow-y-auto", DRAG_GHOST)}
            onScroll={
                onReachEnd
                    ? (event) => {
                          const box = event.currentTarget
                          if (box.scrollHeight - box.scrollTop - box.clientHeight <= REACH_END_PX) {
                              reachEnd()
                          }
                      }
                    : undefined
            }
        >
            {children}
        </div>
    )
}

/** Children of a collapsed-rail (or vertical-mode) group, flattened into a Radix flyout. */
const FlyoutChildren = ({
    items,
    selectedKeys,
    onItemSelect,
}: {
    items: NavItem[]
    selectedKeys: string[]
    onItemSelect?: NavMenuProps["onItemSelect"]
}) => (
    <>
        {items.map((child) => {
            if (child.isPlaceholder || child.isGroupLabel) {
                return (
                    <DropdownMenuLabel key={child.key} className="text-xs text-colorTextTertiary">
                        {child.title}
                    </DropdownMenuLabel>
                )
            }
            // The icon is the row's leading glyph on every other path (LeafRow, the group row,
            // the collapsed trigger). The flyout has to draw it too, or Help & Docs loses the
            // icons the antd menu always rendered through its own `icon` slot.
            const body = (
                <>
                    {child.icon ? (
                        <span className="flex shrink-0 items-center">{child.icon}</span>
                    ) : null}
                    <span className="min-w-0 truncate">{child.title}</span>
                </>
            )
            return (
                <Fragment key={child.key}>
                    <DropdownMenuItem
                        disabled={child.disabled}
                        // gap-[10px] over the item's default gap-2: antd's Menu icon margin.
                        // It rides on `className` (which goes through tailwind-merge) rather
                        // than on the Link, because `asChild` merges classes by concatenation
                        // and would leave both gaps in the list.
                        className={clsx(
                            "gap-[10px]",
                            selectedKeys.includes(child.key) && "font-medium",
                        )}
                        asChild={Boolean(child.link)}
                        onSelect={
                            child.link
                                ? undefined
                                : (event) => child.onClick?.(event as unknown as MouseEvent)
                        }
                    >
                        {child.link ? (
                            <Link
                                href={child.link}
                                className="!text-inherit no-underline"
                                target={isExternal(child.link) ? "_blank" : undefined}
                                rel={isExternal(child.link) ? "noopener noreferrer" : undefined}
                                onClick={linkClickHandler(child, onItemSelect)}
                            >
                                {body}
                            </Link>
                        ) : (
                            body
                        )}
                    </DropdownMenuItem>
                    {/* `divider` means "a rule FOLLOWS this row", which is the contract the
                        inline path and the old antd menu both implement. Treating it as "this
                        row IS a rule" replaced the Documentation item with a hairline. */}
                    {child.divider ? <DropdownMenuSeparator /> : null}
                </Fragment>
            )
        })}
    </>
)

const NavMenuImpl = ({
    items,
    collapsed,
    mode = "inline",
    openKeys = [],
    selectedKeys = [],
    onToggleOpenKey,
    onPopupOpenChange,
    onItemSelect,
    className,
}: NavMenuProps) => {
    const inline = mode === "inline" && !collapsed
    const navRef = useRef<HTMLElement>(null)

    const renderItem = (item: NavItem): ReactNode => {
        const selected = selectedKeys.includes(item.key)
        // A group that hides its children on the icon rail is a plain link there — no flyout, and
        // so no popup-open report, which keeps its gated source unsubscribed while collapsed.
        const hasChildren =
            Boolean(item.submenu?.length) && !(collapsed && item.hideChildrenWhenCollapsed)

        if (collapsed || (!inline && hasChildren)) {
            // Icon rail (or vertical bottom section): leaves get a tooltip, groups a flyout.
            if (!hasChildren) {
                return (
                    <Tip key={item.key} title={item.tooltip || item.title}>
                        <div
                            className={clsx(
                                "relative mx-auto flex size-8 items-center justify-center rounded-md",
                                item.disabled ? ROW_DISABLED : ROW_INTERACTIVE,
                                selected && ROW_SELECTED,
                            )}
                            onClick={rowClickHandler(item, onItemSelect)}
                        >
                            {item.icon}
                            {item.link && !item.disabled ? (
                                <RowLabelCollapsed item={item} onItemSelect={onItemSelect} />
                            ) : null}
                        </div>
                    </Tip>
                )
            }
            return (
                <DropdownMenu
                    key={item.key}
                    onOpenChange={(open) => onPopupOpenChange?.(item.key, open)}
                >
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            aria-label={item.title}
                            disabled={item.disabled}
                            className={clsx(
                                // [font-family:inherit]: preflight is off, so a bare <button>
                                // renders Arial while the <div> rows around it render Inter.
                                "mx-auto flex min-w-0 items-center rounded-md border-0 bg-transparent [font-family:inherit]",
                                item.disabled ? ROW_DISABLED : ROW_INTERACTIVE,
                                selected && ROW_SELECTED,
                                collapsed
                                    ? "size-8 justify-center"
                                    : "h-7 w-[calc(100%-16px)] justify-start gap-[10px] px-3 text-sm leading-7",
                            )}
                        >
                            {item.icon}
                            {/* Allow the flex item to shrink so the title truncates instead of wrapping. */}
                            {!collapsed ? (
                                <span className="min-w-0 flex-1 truncate text-left">
                                    {item.title}
                                </span>
                            ) : null}
                            {/* A group in a vertical section (the bottom rail) renders HERE, not
                                through RowLabel — the suffix has to be drawn on both paths or
                                Help & Docs loses its version label. The caret stands in for
                                antd's submenu arrow, which the expanded rail has always shown
                                (and the collapsed one hidden). */}
                            {!collapsed ? (
                                <span className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-colorTextTertiary">
                                    {item.suffix}
                                    <CaretRight size={12} />
                                </span>
                            ) : null}
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        side="right"
                        align="start"
                        className="max-h-[min(70vh,560px)] overflow-y-auto"
                    >
                        <FlyoutChildren
                            items={item.submenu ?? []}
                            selectedKeys={selectedKeys}
                            onItemSelect={onItemSelect}
                        />
                    </DropdownMenuContent>
                </DropdownMenu>
            )
        }

        if (hasChildren) {
            const open = openKeys.includes(item.key)
            return (
                <Fragment key={item.key}>
                    <div
                        className={clsx(
                            ROW_BASE,
                            item.disabled ? ROW_DISABLED : ROW_INTERACTIVE,
                            selected && ROW_SELECTED,
                            "pr-0",
                        )}
                    >
                        {item.icon ? (
                            <span className="flex shrink-0 items-center">{item.icon}</span>
                        ) : null}
                        <RowLabel item={item} onItemSelect={onItemSelect} />
                        {/* z-[1] for the same reason as the caret: the link anchor is stretched
                            over the whole row, and this has to stay clickable above it. */}
                        {item.groupAction ? (
                            <span className="relative z-[1] flex shrink-0 items-center">
                                {item.groupAction}
                            </span>
                        ) : null}
                        {item.alwaysOpen ? null : (
                            <span
                                role="button"
                                tabIndex={0}
                                aria-label={`${open ? "Collapse" : "Expand"} ${item.title}`}
                                // z-[1] keeps the toggle clickable above the stretched link anchor.
                                className="relative z-[1] mr-1 flex h-[22px] w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-colorTextTertiary hover:bg-colorFillTertiary hover:text-colorText"
                                onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    onToggleOpenKey?.(item.key)
                                }}
                                onKeyDown={(event) => {
                                    if (event.target !== event.currentTarget) return
                                    if (event.key !== "Enter" && event.key !== " ") return
                                    event.preventDefault()
                                    event.stopPropagation()
                                    onToggleOpenKey?.(item.key)
                                }}
                            >
                                <CaretRight
                                    size={12}
                                    className={clsx(
                                        "transition-transform duration-200 ease-in-out",
                                        open && "rotate-90",
                                    )}
                                />
                            </span>
                        )}
                    </div>
                    {item.scrollChildren ? (
                        <ScrollGroupChildren onReachEnd={item.onReachEnd}>
                            {(item.submenu ?? []).map(renderItem)}
                        </ScrollGroupChildren>
                    ) : (
                        // `shrink-0`: HeightCollapse's wrapper is `overflow-hidden`, which drops a
                        // flex item's automatic min-height — so beside a scrolling group it
                        // shrank and clipped its own rows instead of holding its height.
                        <HeightCollapse open={open} className="shrink-0">
                            {/* Guide line marks the group's extent, as the old inline menu did. */}
                            <div className={clsx(GROUP_CHILDREN, DRAG_GHOST)}>
                                {(item.submenu ?? []).map(renderItem)}
                            </div>
                        </HeightCollapse>
                    )}
                </Fragment>
            )
        }

        if (item.isGroupLabel) {
            return <GroupLabelRow key={item.key} item={item} />
        }

        return (
            <Fragment key={item.key}>
                <LeafRow item={item} selected={selected} onItemSelect={onItemSelect} />
                {item.divider ? (
                    <hr className="my-2 w-full border-0 border-t border-solid border-colorBorderSecondary" />
                ) : null}
            </Fragment>
        )
    }

    // pt only: each row carries its own 4px trailing margin, so a bottom pad paid it twice
    // and pushed every section after the first 4px further down the rail.
    return (
        <nav
            ref={navRef}
            role="menu"
            className={clsx(
                "flex w-full flex-col pt-1",
                // A scrolling group only shrinks if its own line can: claim the section's height
                // and allow shrinking past the content.
                items.some((item) => item.scrollChildren) && "min-h-0 flex-1",
                className,
            )}
        >
            {items.map(renderItem)}
            {inline ? <SidebarReorderLayer containerRef={navRef} /> : null}
        </nav>
    )
}

/** Collapsed leaf: the stretched anchor alone — the icon is rendered by the parent. */
const RowLabelCollapsed = ({
    item,
    onItemSelect,
}: {
    item: NavItem
    onItemSelect?: NavMenuProps["onItemSelect"]
}) => (
    <Link
        aria-label={item.title}
        className="absolute inset-0"
        href={item.link ?? "#"}
        target={isExternal(item.link) ? "_blank" : undefined}
        rel={isExternal(item.link) ? "noopener noreferrer" : undefined}
        onClick={linkClickHandler(item, onItemSelect)}
    />
)

export const NavMenu = memo(NavMenuImpl)
