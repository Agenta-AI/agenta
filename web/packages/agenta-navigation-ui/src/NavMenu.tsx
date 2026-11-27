import {
    Fragment,
    memo,
    useRef,
    type KeyboardEvent,
    type MouseEvent,
    type ReactElement,
    type ReactNode,
} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import type {
    SidebarArrange,
    SidebarConfig,
    SidebarDragItem,
    SidebarMenuMode,
} from "@agenta/navigation"
import {HeightCollapse} from "@agenta/ui/components/presentational"
import {
    Badge,
    Button,
    CollapseCaret,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    SimpleTooltip,
    SkeletonBlock,
    cn,
} from "@agenta/ui/ui"
import {CaretRight, Plus} from "@phosphor-icons/react"
import clsx from "clsx"
import Link from "next/link"

import {ArrangeablePages} from "./ArrangeablePages"
import {FadeScrollBox} from "./FadeScrollBox"
import {HoverFlyout} from "./HoverFlyout"
import {SidebarReorderLayer} from "./reorder"
import {ROW_BASE, ROW_INTERACTIVE, ROW_LIST, ROW_SELECTED} from "./rowStyles"

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
    /** Makes the top-level rows arrangeable, with a "More" row for the hidden ones. */
    arrange?: SidebarArrange
    className?: string
}

const ROW_DISABLED = "cursor-default text-muted-foreground"
// Guide line on the parent icon's center (24px), marking the group's extent.
const GROUP_CHILDREN = `ml-6 ${ROW_LIST} border-0 border-l border-solid border-border-muted`
// A section's rows are rail rows: no indent, no guide line.
const SECTION_CHILDREN = ROW_LIST
// Hidden at rest; shows on row hover or focus, while its popover is open, and on touch.
const ROW_ACTION =
    "relative z-[1] mr-1 flex shrink-0 items-center opacity-0 transition-opacity group-hover/navrow:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 pointer-coarse:opacity-100"
// A small icon button inside a row: muted, 24px, its hover stacks on the row's (SURF-06).
const SMALL_ICON_BUTTON =
    "shrink-0 text-muted-foreground no-underline hover:bg-secondary hover:text-foreground"
// The same button in a heading, which has no hover of its own: the one hover fill (SURF-05).
const HEADING_ICON_BUTTON =
    "shrink-0 text-muted-foreground no-underline hover:bg-accent hover:text-foreground"
// Stretches the anchor over the whole row so middle-click / ctrl+click work anywhere on it.
const LINK_CLASS =
    "!text-inherit no-underline before:absolute before:inset-0 before:content-[''] min-w-0 flex-1 truncate rounded-sm focus-ring"

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
        <Badge variant="success" className="shrink-0">
            {tag}
        </Badge>
    ) : null

const Tip = ({title, children}: {title: ReactNode; children: ReactElement}) => (
    <SimpleTooltip title={title} side="right">
        {children}
    </SimpleTooltip>
)

const isExternal = (link?: string) => Boolean(link?.startsWith("http"))

/** A click the browser routes elsewhere (new tab / window) instead of following in place. */
const isModifiedClick = (event: MouseEvent) =>
    event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey

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
        // A modified click opens the page in another tab; the click work belongs to THIS tab
        // only, as on a heading's "+".
        if (isModifiedClick(event)) return
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
            <span className="min-w-0 flex-1 truncate" title={hover}>
                {item.title} <TagChip tag={item.tag} />
            </span>
            {item.suffix ? <span className="ml-auto shrink-0 pl-2">{item.suffix}</span> : null}
        </span>
    )
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
            prefetch={item.prefetch}
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

/** A group heading inside a submenu: a label over its rows; with `onClick` it folds them. */
// Sticky only inside the scrolling list; the opaque fill hides rows that pass under it.
const STICKY_HEADING =
    "[[data-nav-scroll]_&]:sticky [[data-nav-scroll]_&]:top-0 [[data-nav-scroll]_&]:z-10 [[data-nav-scroll]_&]:bg-muted"

/** A heading's actions when it has an open button: shown on hover or focus, always on touch. */
const HEADING_HOVER_ACTION =
    "opacity-0 transition-opacity group-hover/heading:opacity-100 group-focus-within/heading:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"

/** Every full-width sidebar label: 12px meta text starting on the icon line (16px). */
const HEADING_TEXT =
    "w-full shrink-0 pb-1 pl-4 pr-3 pt-3 text-meta text-muted-foreground select-none"

const GroupLabelRow = memo(function GroupLabelRow({item}: {item: NavItem}) {
    const t = useT(navigationCatalog)
    const toggle = item.onClick
    if (!toggle)
        return (
            <p
                {...dragAttrs(item.dragItem)}
                data-sticky-heading="true"
                className={clsx("m-0", HEADING_TEXT, STICKY_HEADING)}
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
            data-sticky-heading="true"
            className={clsx(
                "group/heading flex cursor-pointer items-center gap-1 rounded-md hover:text-foreground focus-ring-inset",
                HEADING_TEXT,
                STICKY_HEADING,
            )}
            onClick={(event) => {
                // The "+" link must bubble to the shell frame (drawer close) but not fold the group.
                if ((event.target as HTMLElement).closest("a, button")) return
                toggle(event)
            }}
            onKeyDown={(event) => {
                if (onMoveKey(event)) return
                if (event.key !== "Enter" && event.key !== " ") return
                event.preventDefault()
                toggle(event as unknown as MouseEvent)
            }}
        >
            <span className="min-w-0 truncate">{item.title}</span>
            <span
                aria-label={t(
                    item.isCollapsed
                        ? "navigation.chrome.expandGroup"
                        : "navigation.chrome.collapseGroup",
                    {
                        title: String(item.title),
                    },
                )}
                className="flex shrink-0 items-center justify-center"
            >
                <CollapseCaret open={!item.isCollapsed} className="text-inherit" />
            </span>
            {/* A real link, so a long-press / middle-click can open it in another tab. */}
            {item.groupAdd ? (
                <SimpleTooltip title={item.groupAdd.label}>
                    <Button
                        asChild
                        variant="ghost"
                        size="icon-xs"
                        className={clsx(
                            "ml-auto",
                            HEADING_ICON_BUTTON,
                            item.groupEnter && HEADING_HOVER_ACTION,
                        )}
                    >
                        <Link
                            href={item.groupAdd.link}
                            aria-label={item.groupAdd.label}
                            onClick={(event) => {
                                // A modified click opens another tab; the click work stays in this one.
                                if (isModifiedClick(event)) return
                                item.groupAdd?.onClick?.(event)
                            }}
                            // Enter on the link is its own activation; the heading must not also toggle.
                            onKeyDown={(event) => event.stopPropagation()}
                        >
                            <Plus />
                        </Link>
                    </Button>
                </SimpleTooltip>
            ) : null}
            {item.groupEnter ? (
                <SimpleTooltip title={item.groupEnter.label}>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={item.groupEnter.label}
                        className={clsx(
                            HEADING_ICON_BUTTON,
                            !item.groupAdd && "ml-auto",
                            HEADING_HOVER_ACTION,
                        )}
                        onClick={() => item.groupEnter?.onClick()}
                        // Enter on the button is its own activation; the heading must not also toggle.
                        onKeyDown={(event) => event.stopPropagation()}
                    >
                        {item.groupEnter.icon}
                    </Button>
                </SimpleTooltip>
            ) : null}
        </div>
    )
})

/** A group's idle / empty / error line: prose on the icon line, not a row. */
const PlaceholderRow = ({item}: {item: NavItem}) => (
    <p className="m-0 w-full shrink-0 pb-1 pl-4 pr-4 pt-0.5 text-meta text-muted-foreground select-none">
        {item.title}
    </p>
)

/** A top-level row's glyph is muted until selected; grouped rows keep their run-state colour. */
const iconClass = (topLevel: boolean, selected: boolean) =>
    clsx("flex shrink-0 items-center", topLevel && !selected && "text-muted-foreground")

/**
 * A section heading: an always-open group with no icon ("Sessions", "Chats"): a label (a link
 * when it has one), its count (`suffix`) and its controls (`groupAction`) on the right.
 */
const SectionHeading = ({
    item,
    selected,
    onItemSelect,
}: {
    item: NavItem
    selected: boolean
    onItemSelect?: NavMenuProps["onItemSelect"]
}) => {
    const label = (
        <>
            {item.title}
            {item.suffix != null ? (
                <span className="ml-1.5 text-muted-foreground">{item.suffix}</span>
            ) : null}
        </>
    )
    return (
        <div className={cn("flex items-center gap-1", HEADING_TEXT, item.rowClassName)}>
            {item.link && !item.disabled ? (
                <Link
                    href={item.link}
                    prefetch={item.prefetch}
                    title={item.tooltip}
                    draggable={false}
                    onClick={linkClickHandler(item, onItemSelect)}
                    className={clsx(
                        "-ml-1 inline-flex min-w-0 items-center rounded-sm px-1 py-0.5 no-underline focus-ring",
                        selected
                            ? "bg-selected !text-foreground"
                            : "!text-muted-foreground hover:bg-accent hover:!text-foreground",
                    )}
                >
                    {label}
                </Link>
            ) : (
                <span className="min-w-0 truncate text-muted-foreground">{label}</span>
            )}
            <span className="min-w-0 flex-1" />
            {item.groupAction ? (
                <span className="flex shrink-0 items-center">{item.groupAction}</span>
            ) : null}
        </div>
    )
}

/** Row widths for the loading list, varied so it reads as titles rather than a block. */
const LOADING_WIDTHS = ["w-[72%]", "w-[58%]", "w-[80%]", "w-[46%]", "w-[66%]", "w-[54%]"]

/** A group's loading state, shaped like the list it stands in for: a caption, then rows. */
const LoadingRows = () => {
    const t = useT(commonCatalog)
    return (
        <div className={`${ROW_LIST} shrink-0`} aria-busy="true" aria-label={t("common.loading")}>
            <div className="flex h-6 items-center pl-4 pr-3 pt-2">
                <SkeletonBlock active className="h-2.5 w-24 rounded-xs" />
            </div>
            {LOADING_WIDTHS.map((width) => (
                <div key={width} className={`${ROW_BASE} pointer-events-none`}>
                    <SkeletonBlock active className={`h-3 rounded-xs ${width}`} />
                </div>
            ))}
        </div>
    )
}

const LeafRow = memo(function LeafRow({
    item,
    selected,
    topLevel,
    onItemSelect,
}: {
    item: NavItem
    selected: boolean
    topLevel: boolean
    onItemSelect?: NavMenuProps["onItemSelect"]
}) {
    if (item.isLoading) return <LoadingRows />
    if (item.isPlaceholder) return <PlaceholderRow item={item} />
    const onClick = rowClickHandler(item, onItemSelect)
    // A controlled scope (Settings) gives its items `onItemSelect` and no `link`, so the row
    // is the only control there is — without this it is an unfocusable <div> wrapping a
    // <span>, and the whole rail is unreachable by keyboard. Link rows keep their <a>.
    const isControl = Boolean(onClick) && !item.link
    return (
        <div
            {...dragAttrs(item.dragItem)}
            // cn, not clsx: a row's own class (a dimmed archived session) must win over ROW_BASE.
            className={cn(
                ROW_BASE,
                item.disabled || item.isPlaceholder ? ROW_DISABLED : ROW_INTERACTIVE,
                selected && ROW_SELECTED,
                item.rowAction && "group/navrow pr-0",
                item.trailing && "pr-0",
                item.rowClassName,
                isControl && "outline-none focus-ring",
            )}
            onClick={onClick}
            role={isControl ? "menuitem" : undefined}
            tabIndex={isControl ? 0 : undefined}
            aria-current={isControl && selected ? "page" : undefined}
            data-selected={selected || undefined}
            onKeyDown={(event) => {
                if (onMoveKey(event)) return
                if (!isControl) return
                if (event.key !== "Enter" && event.key !== " ") return
                event.preventDefault()
                onClick?.(event as unknown as MouseEvent)
            }}
        >
            {item.icon ? <span className={iconClass(topLevel, selected)}>{item.icon}</span> : null}
            <RowLabel item={item} onItemSelect={onItemSelect} />
            {/* Above the stretched link anchor, like a group's action. */}
            {item.rowAction ? <span className={ROW_ACTION}>{item.rowAction}</span> : null}
            {item.trailing ? (
                <span className="relative z-[1] mr-0.5 flex shrink-0 items-center">
                    {item.trailing}
                </span>
            ) : null}
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
    className,
    onReachEnd,
}: {
    children: ReactNode
    className: string
    onReachEnd?: () => void
}) => {
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
        // Outside HeightCollapse: a scroll area takes its height from the flex line.
        <FadeScrollBox
            data-nav-scroll="true"
            className={className}
            boxClassName={DRAG_GHOST}
            revealSelector='[data-selected="true"]'
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
        </FadeScrollBox>
    )
}

/** Children of a collapsed-rail (or vertical-mode) group, flattened into a Radix flyout. */
export const FlyoutChildren = ({
    items,
    selectedKeys,
    onItemSelect,
}: {
    items: NavItem[]
    selectedKeys: string[]
    onItemSelect?: NavMenuProps["onItemSelect"]
}) => {
    return (
        <>
            {items.map((child) => {
                if (child.isPlaceholder || child.isGroupLabel) {
                    return <DropdownMenuLabel key={child.key}>{child.title}</DropdownMenuLabel>
                }
                // The row's leading glyph, as on every other path.
                const body = (
                    <>
                        {child.icon ? (
                            <span className="flex shrink-0 items-center">{child.icon}</span>
                        ) : null}
                        {child.subtitle ? (
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate">{child.title}</span>
                                <span className="truncate text-caption text-muted-foreground">
                                    {child.subtitle}
                                </span>
                            </span>
                        ) : (
                            <span className="min-w-0 flex-1 truncate">{child.title}</span>
                        )}
                        {/* The version rides the row it describes, as RowLabel draws it inline. */}
                        {child.suffix ? (
                            <span className="ml-auto shrink-0 pl-2">{child.suffix}</span>
                        ) : null}
                    </>
                )
                return (
                    <Fragment key={child.key}>
                        <DropdownMenuItem
                            disabled={child.disabled}
                            // MENU_ITEM owns the geometry (ROW-02); selection shows as a fill, not weight.
                            className={clsx(
                                selectedKeys.includes(child.key) &&
                                    "bg-selected data-[highlighted]:bg-selected data-[highlighted]:bg-[image:linear-gradient(var(--accent),var(--accent))]",
                                // A row's own tone (an archived session is dimmed) on this path too.
                                child.rowClassName,
                            )}
                            aria-current={selectedKeys.includes(child.key) ? "page" : undefined}
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
                                    prefetch={child.prefetch}
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
                        {/* `divider` means a rule FOLLOWS this row. */}
                        {child.divider ? <DropdownMenuSeparator /> : null}
                    </Fragment>
                )
            })}
        </>
    )
}

const NavMenuImpl = ({
    items,
    collapsed,
    mode = "inline",
    openKeys = [],
    selectedKeys = [],
    onToggleOpenKey,
    onPopupOpenChange,
    onItemSelect,
    arrange,
    className,
}: NavMenuProps) => {
    const t = useT(navigationCatalog)
    const inline = mode === "inline" && !collapsed
    const navRef = useRef<HTMLElement>(null)

    // `depth` 0 is a row of the rail itself; deeper rows sit inside a group.
    const renderItem = (item: NavItem, depth: number): ReactNode => {
        const selected = selectedKeys.includes(item.key)
        // A group that hides its children on the icon rail is a plain link there — no flyout, and
        // so no popup-open report, which keeps its gated source unsubscribed while collapsed.
        // An `alwaysOpen` group stays a group with zero children: it is a SECTION, and its own
        // controls (the sessions search and filter) are how you get rows back when it is empty.
        const hasChildren =
            (Boolean(item.submenu?.length) || Boolean(item.alwaysOpen)) &&
            !(collapsed && item.hideChildrenWhenCollapsed)

        if (collapsed || (!inline && hasChildren)) {
            // Icon rail (or vertical bottom section): leaves get a tooltip, groups a flyout.
            if (!hasChildren) {
                const icon = (
                    <div
                        className={cn(
                            // A 28px square centered on the 48px rail (icon center at 24px).
                            "relative mx-auto flex size-7 shrink-0 items-center justify-center rounded-md",
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
                )
                // The flyout replaces the tooltip: both would open on the same hover.
                const leaf = item.hoverFlyout ? (
                    <HoverFlyout content={item.hoverFlyout}>{icon}</HoverFlyout>
                ) : (
                    <Tip title={item.tooltip || item.title}>{icon}</Tip>
                )
                // The row's trailing controls (Settings' live chat and help) stack under its icon.
                return (
                    <Fragment key={item.key}>
                        {leaf}
                        {collapsed && item.trailing ? (
                            <div className="mx-auto flex flex-col items-center gap-0.5">
                                {item.trailing}
                            </div>
                        ) : null}
                    </Fragment>
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
                            className={cn(
                                // [font-family:inherit]: preflight is off, so a bare <button> renders Arial.
                                "group/flyout border-0 bg-transparent [font-family:inherit] outline-none focus-ring",
                                collapsed
                                    ? "relative mx-auto flex size-7 shrink-0 items-center justify-center rounded-md"
                                    : `${ROW_BASE} justify-start`,
                                item.disabled ? ROW_DISABLED : ROW_INTERACTIVE,
                                selected && ROW_SELECTED,
                            )}
                        >
                            {item.icon}
                            {/* Allow the flex item to shrink so the title truncates instead of wrapping. */}
                            {!collapsed ? (
                                <span className="min-w-0 flex-1 truncate text-left">
                                    {item.title}
                                </span>
                            ) : null}
                            {/* The suffix is drawn here too (RowLabel does not render this row); the caret points at the side panel, as a submenu does. */}
                            {!collapsed ? (
                                <span className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-muted-foreground">
                                    {item.suffix}
                                    <CaretRight size={12} aria-hidden />
                                </span>
                            ) : null}
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        side="right"
                        align="start"
                        // A set width, so truncated release titles do not shrink the menu.
                        className="max-h-[min(70dvh,560px)] w-popover-sm max-w-[calc(100vw-16px)] overflow-y-auto"
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
            // A section's rows start 4 px under its row, as the design's list does.
            const childrenClass = item.alwaysOpen ? clsx(SECTION_CHILDREN, "pt-1") : GROUP_CHILDREN
            // An always-open group with no icon is a section heading, not a row ("Sessions" in
            // the agent sidebar, "Chats" in the builder sidebar).
            const heading = item.alwaysOpen && !item.icon
            // A group with no page of its own opens and closes on a click anywhere on its row,
            // and on Enter or Space. A group with a page keeps the caret as its own button,
            // because a click on its row opens the page.
            const toggleOnRow = !item.link && !item.alwaysOpen && !item.disabled
            const toggleLabel = t(
                open ? "navigation.chrome.collapseGroup" : "navigation.chrome.expandGroup",
                {title: String(item.title)},
            )
            return (
                <Fragment key={item.key}>
                    {heading ? (
                        <SectionHeading
                            item={item}
                            selected={selected}
                            onItemSelect={onItemSelect}
                        />
                    ) : (
                        <div
                            // cn, as LeafRow does: `pr-0` must beat ROW_BASE's padding.
                            className={cn(
                                ROW_BASE,
                                item.disabled ? ROW_DISABLED : ROW_INTERACTIVE,
                                selected && ROW_SELECTED,
                                "pr-0",
                                toggleOnRow && "focus-ring-inset",
                                item.rowClassName,
                            )}
                            role={toggleOnRow ? "button" : undefined}
                            tabIndex={toggleOnRow ? 0 : undefined}
                            aria-expanded={toggleOnRow ? open : undefined}
                            onClick={
                                toggleOnRow
                                    ? (event) => {
                                          // The group's own controls (a filter, a "+") act alone.
                                          if ((event.target as HTMLElement).closest("a, button"))
                                              return
                                          onToggleOpenKey?.(item.key)
                                      }
                                    : undefined
                            }
                            onKeyDown={
                                toggleOnRow
                                    ? (event) => {
                                          if (event.target !== event.currentTarget) return
                                          if (event.key !== "Enter" && event.key !== " ") return
                                          event.preventDefault()
                                          onToggleOpenKey?.(item.key)
                                      }
                                    : undefined
                            }
                        >
                            {item.icon ? (
                                <span className={iconClass(depth === 0, selected)}>
                                    {item.icon}
                                </span>
                            ) : null}
                            <RowLabel item={item} onItemSelect={onItemSelect} />
                            {/* z-[1] for the same reason as the caret: the link anchor is stretched
                            over the whole row, and this has to stay clickable above it. */}
                            {item.groupAction ? (
                                <span className="relative z-[1] flex shrink-0 items-center">
                                    {item.groupAction}
                                </span>
                            ) : null}
                            {item.alwaysOpen ? null : toggleOnRow ? (
                                // The row is the button; the caret only shows the state.
                                <SimpleTooltip title={toggleLabel}>
                                    <span
                                        aria-hidden
                                        className="mr-1 flex size-control-xs shrink-0 items-center justify-center text-muted-foreground"
                                    >
                                        <CollapseCaret open={open} className="text-inherit" />
                                    </span>
                                </SimpleTooltip>
                            ) : (
                                <SimpleTooltip title={toggleLabel}>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-expanded={open}
                                        aria-label={toggleLabel}
                                        // z-[1] keeps the toggle clickable above the stretched link anchor.
                                        className={clsx("relative z-[1] mr-1", SMALL_ICON_BUTTON)}
                                        onClick={(event) => {
                                            event.preventDefault()
                                            event.stopPropagation()
                                            onToggleOpenKey?.(item.key)
                                        }}
                                    >
                                        <CollapseCaret open={open} className="text-inherit" />
                                    </Button>
                                </SimpleTooltip>
                            )}
                        </div>
                    )}
                    {item.scrollChildren ? (
                        <ScrollGroupChildren className={childrenClass} onReachEnd={item.onReachEnd}>
                            {(item.submenu ?? []).map((child) => renderItem(child, depth + 1))}
                        </ScrollGroupChildren>
                    ) : (
                        // `shrink-0`: HeightCollapse's wrapper is `overflow-hidden`, which drops a
                        // flex item's automatic min-height — so beside a scrolling group it
                        // shrank and clipped its own rows instead of holding its height.
                        <HeightCollapse open={open} className="shrink-0">
                            <div className={clsx(childrenClass, DRAG_GHOST)}>
                                {(item.submenu ?? []).map((child) => renderItem(child, depth + 1))}
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
                <LeafRow
                    item={item}
                    selected={selected}
                    topLevel={depth === 0}
                    onItemSelect={onItemSelect}
                />
                {item.divider ? (
                    <hr className="my-2 w-full border-0 border-t border-solid border-border-muted" />
                ) : null}
            </Fragment>
        )
    }

    return (
        <nav
            ref={navRef}
            role="menu"
            className={clsx(
                "flex w-full flex-col gap-1 pt-1",
                // Claim the spare height, but keep room for a few rows; past that the rail scrolls.
                items.some((item) => item.scrollChildren) && "min-h-40 flex-1",
                className,
            )}
        >
            {arrange ? (
                <ArrangeablePages
                    items={items}
                    arrange={arrange}
                    collapsed={collapsed}
                    renderItem={(item) => renderItem(item, 0)}
                />
            ) : (
                items.map((item) => renderItem(item, 0))
            )}
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
        className="absolute inset-0 rounded-md focus-ring"
        href={item.link ?? "#"}
        prefetch={item.prefetch}
        target={isExternal(item.link) ? "_blank" : undefined}
        rel={isExternal(item.link) ? "noopener noreferrer" : undefined}
        onClick={linkClickHandler(item, onItemSelect)}
    />
)

export const NavMenu = memo(NavMenuImpl)
