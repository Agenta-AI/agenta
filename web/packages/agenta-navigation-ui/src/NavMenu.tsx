import {Fragment, memo, type MouseEvent, type ReactNode} from "react"

import type {SidebarConfig, SidebarMenuMode} from "@agenta/navigation"
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

const ROW_BASE =
    "relative box-border flex h-9 w-[94%] mx-auto items-center gap-2 rounded-md px-3 text-xs select-none"
const ROW_INTERACTIVE = "cursor-pointer text-colorTextSecondary hover:bg-colorFillQuaternary"
const ROW_SELECTED = "bg-colorFillSecondary font-medium !text-colorText"
const ROW_DISABLED = "cursor-default text-colorTextQuaternary"
// Stretches the anchor over the whole row so middle-click / ctrl+click work anywhere on it.
const LINK_CLASS =
    "!text-inherit no-underline before:absolute before:inset-0 before:content-[''] min-w-0 flex-1 truncate"

const TagChip = ({tag}: {tag?: string}) =>
    tag ? (
        <span className="shrink-0 rounded bg-colorSuccessBg px-1 py-0.5 text-[10px] leading-none text-colorSuccessText">
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

const RowLabel = ({
    item,
    onItemSelect,
}: {
    item: NavItem
    onItemSelect?: NavMenuProps["onItemSelect"]
}) => {
    const content = (
        <span className="flex w-full items-center">
            <span className="min-w-0 truncate">
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
    return (
        <Link
            className={LINK_CLASS}
            data-tour={item.dataTour}
            href={item.link}
            target={isExternal(item.link) ? "_blank" : undefined}
            rel={isExternal(item.link) ? "noopener noreferrer" : undefined}
            onClick={linkClickHandler(item, onItemSelect)}
        >
            {content}
        </Link>
    )
}

/** A group heading inside a submenu — a label over the rows below it, never a row itself. */
const GroupLabelRow = ({title}: {title: ReactNode}) => (
    <p className="m-0 mx-auto w-[94%] px-3 pb-0.5 pt-2 text-[10px] uppercase tracking-wide text-colorTextTertiary select-none">
        {title}
    </p>
)

const LeafRow = ({
    item,
    selected,
    onItemSelect,
}: {
    item: NavItem
    selected: boolean
    onItemSelect?: NavMenuProps["onItemSelect"]
}) => (
    <div
        className={clsx(
            ROW_BASE,
            item.disabled || item.isPlaceholder ? ROW_DISABLED : ROW_INTERACTIVE,
            selected && ROW_SELECTED,
        )}
        onClick={item.link || item.disabled ? undefined : item.onClick}
    >
        {item.icon ? <span className="flex shrink-0 items-center">{item.icon}</span> : null}
        <RowLabel item={item} onItemSelect={onItemSelect} />
    </div>
)

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
        {items.map((child) =>
            child.isPlaceholder || child.isGroupLabel ? (
                <DropdownMenuLabel key={child.key} className="text-xs text-colorTextTertiary">
                    {child.title}
                </DropdownMenuLabel>
            ) : child.divider ? (
                <DropdownMenuSeparator key={child.key} />
            ) : (
                <DropdownMenuItem
                    key={child.key}
                    disabled={child.disabled}
                    className={clsx(selectedKeys.includes(child.key) && "font-medium")}
                    asChild={Boolean(child.link)}
                    onSelect={child.link ? undefined : () => child.onClick?.(undefined as never)}
                >
                    {child.link ? (
                        <Link
                            href={child.link}
                            className="!text-inherit no-underline"
                            target={isExternal(child.link) ? "_blank" : undefined}
                            rel={isExternal(child.link) ? "noopener noreferrer" : undefined}
                            onClick={linkClickHandler(child, onItemSelect)}
                        >
                            {child.title}
                        </Link>
                    ) : (
                        <span>{child.title}</span>
                    )}
                </DropdownMenuItem>
            ),
        )}
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

    const renderItem = (item: NavItem): ReactNode => {
        const selected = selectedKeys.includes(item.key)
        const hasChildren = Boolean(item.submenu?.length)

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
                            onClick={item.link || item.disabled ? undefined : item.onClick}
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
                                "mx-auto flex items-center rounded-md border-0 bg-transparent",
                                item.disabled ? ROW_DISABLED : ROW_INTERACTIVE,
                                selected && ROW_SELECTED,
                                collapsed
                                    ? "size-8 justify-center"
                                    : "h-9 w-[94%] justify-start gap-2 px-3 text-xs",
                            )}
                        >
                            {item.icon}
                            {!collapsed ? <span>{item.title}</span> : null}
                            {/* A group in a vertical section (the bottom rail) renders HERE, not
                                through RowLabel — the suffix has to be drawn on both paths or
                                Help & Docs loses its version label. */}
                            {item.suffix && !collapsed ? (
                                <span className="ml-auto shrink-0 pl-2">{item.suffix}</span>
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
                    </div>
                    <HeightCollapse open={open}>
                        {/* Guide line marks the group's extent, the way the old inline menu did. */}
                        <div className="ml-[22px] flex flex-col border-0 border-l border-solid border-colorBorderSecondary pl-1">
                            {(item.submenu ?? []).map(renderItem)}
                        </div>
                    </HeightCollapse>
                </Fragment>
            )
        }

        if (item.isGroupLabel) {
            return <GroupLabelRow key={item.key} title={item.title} />
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

    return (
        <nav className={clsx("flex w-full flex-col gap-0.5 py-1", className)}>
            {items.map(renderItem)}
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
