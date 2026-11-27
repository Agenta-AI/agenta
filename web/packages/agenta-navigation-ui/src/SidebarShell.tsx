import React, {
    type CSSProperties,
    memo,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react"

import {useT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {
    filterVisibleSections,
    SIDEBAR_COLLAPSED_WIDTH,
    sidebarAlwaysOpenGroupsAtomFamily,
    sidebarCollapsedScopeAtomFamily,
    sidebarDefaultOpenGroupsAtomFamily,
    type SidebarConfig,
    type SidebarScope,
    type SidebarSection,
    type SidebarShellProps,
    useSidebarResize,
} from "@agenta/navigation"
import {Alert, ResizeEdgeLine} from "@agenta/ui/ui"
import clsx from "clsx"
import {useAtom, useSetAtom} from "jotai"
import {useReducedMotion} from "motion/react"

import {NavMenu} from "./NavMenu"
import {SidebarLayoutContext} from "./sidebarLayout"

/** Fallback for the rail's width transition, which runs on `--duration-slow`. */
const RAIL_MS = 320

/** What a crashed sidebar shows: the cause and the fix, not an empty rail. */
const SidebarErrorNotice = () => {
    const t = useT(navigationCatalog)
    return (
        <Alert
            type="error"
            showIcon
            className="m-2"
            message={t("navigation.chrome.sidebarError")}
        />
    )
}

class SidebarErrorBoundary extends React.Component<React.PropsWithChildren, {hasError: boolean}> {
    state = {hasError: false}

    static getDerivedStateFromError() {
        return {hasError: true}
    }

    render() {
        if (this.state.hasError) return <SidebarErrorNotice />
        return this.props.children
    }
}

// Boundary-aware prefix match: `/foo` must not match `/foobar`. A link matches when the
// path equals it or continues with a path/query/hash boundary. Query string and hash on
// `currentPath` (router.asPath) are tolerated by the boundary check.
const pathMatchesLink = (currentPath: string, link: string) => {
    // A trailing slash means descendants only: `/apps/` claims `/apps/<id>` but not `/apps`.
    if (link.endsWith("/")) return currentPath.startsWith(link)
    if (currentPath === link) return true
    if (!currentPath.startsWith(link)) return false
    const nextChar = currentPath.charAt(link.length)
    return nextChar === "" || nextChar === "/" || nextChar === "?" || nextChar === "#"
}

const findSelectedRoute = (items: SidebarConfig[], currentPath = "") => {
    let matched: SidebarConfig | undefined
    let matchedLength = -1
    let matchedIsExact = false

    const visit = (nodes: SidebarConfig[]) => {
        nodes.forEach((item) => {
            // A row can own more routes than it navigates to; an empty list opts it out.
            const matchLinks = item.matchLinks ?? (item.link ? [item.link] : [])
            for (const matchLink of matchLinks) {
                if (!pathMatchesLink(currentPath, matchLink)) continue

                const isExact = currentPath === matchLink
                const isSameLength = matchLink.length === matchedLength
                const isBetterMatch =
                    !matched ||
                    (isExact && !matchedIsExact) ||
                    (isExact === matchedIsExact && matchLink.length > matchedLength) ||
                    (isExact === matchedIsExact &&
                        isSameLength &&
                        matched.isDynamic &&
                        !item.isDynamic)

                if (isBetterMatch) {
                    matched = item
                    matchedLength = matchLink.length
                    matchedIsExact = isExact
                }
            }

            if (item.submenu?.length) {
                visit(item.submenu)
            }
        })
    }

    visit(items)
    return {selectedKey: matched?.key}
}

/** Whether any row carries this key. */
const hasItemKey = (items: SidebarConfig[], key: string): boolean =>
    items.some((item) => item.key === key || (item.submenu ? hasItemKey(item.submenu, key) : false))

/**
 * Which key is selected, given a scope's optional pin and the route match.
 *
 * A pinned key that names an UNRENDERED row selects nothing — never the route match. The rail
 * pins the open session, whose row shares its agent's playground URL, so the route match is that
 * agent; collapsing the session's group (or filtering it out) would otherwise jump the highlight
 * onto the agent, falsely saying you are viewing it. With no pin, the route match is honest.
 */
export const resolveSelectedKey = (
    overrideKey: string | undefined,
    overrideRendered: boolean,
    routeSelectedKey: string | undefined,
): string | undefined => {
    if (!overrideKey) return routeSelectedKey
    return overrideRendered ? overrideKey : undefined
}

/** Groups that render no collapse control — their key must stay in the open set, or a gated
 * dynamic source would never subscribe and the group would sit empty with no way to expand it. */
const findAlwaysOpenKeys = (items: SidebarConfig[]) => {
    const keys: string[] = []

    const visit = (nodes: SidebarConfig[]) => {
        nodes.forEach((item) => {
            // Published even with NO children: a group that renders nothing when empty would
            // otherwise unpublish itself, leave its gated source idle, and never fetch again.
            if (item.alwaysOpen) keys.push(item.key)
            if (item.submenu?.length) visit(item.submenu)
        })
    }

    visit(items)
    return keys
}

const findDefaultOpenKeys = (items: SidebarConfig[]) => {
    const keys: string[] = []

    const visit = (nodes: SidebarConfig[]) => {
        nodes.forEach((item) => {
            if (item.submenu?.length) {
                if (item.defaultOpen) keys.push(item.key)
                visit(item.submenu)
            }
        })
    }

    visit(items)
    return keys
}

const uniqueKeys = (keys: string[]) => Array.from(new Set(keys))

const haveSameKeys = (left: string[], right: string[]) =>
    left.length === right.length && left.every((key) => right.includes(key))

const renderSlot = (
    Slot: SidebarSection["before"] | SidebarScope["header"] | SidebarScope["footer"],
    collapsed: boolean,
    lastPath?: string,
    onDismiss?: () => void,
) => {
    if (!Slot) return null
    return <Slot collapsed={collapsed} lastPath={lastPath} onDismiss={onDismiss} />
}

const SidebarShell: React.FC<SidebarShellProps> = ({
    collapsedAtom,
    currentPath,
    onPopupOpenChange,
    openGroupsAtomFamily,
    scope,
    theme,
    className,
    onNavigate,
    onDismiss,
    enterFrom,
}) => {
    const t = useT(navigationCatalog)
    // Only a drawer can dismiss the rail, so this is also how the shell knows it is in a sheet.
    const isOverlay = Boolean(onDismiss)
    // The phone sheet sets its own width; the rail fills it.
    const phone = useContext(SidebarLayoutContext) === "phone"
    const [collapsed, setCollapsed] = useAtom(collapsedAtom)
    const railRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const {width, handleProps} = useSidebarResize({railRef, contentRef, collapsed, setCollapsed})
    // A scope change the person asked for slides the new rail in, 4px, on the theme's timing.
    useEffect(() => {
        const content = contentRef.current
        if (!enterFrom || !content?.animate) return
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
        const theme = getComputedStyle(content)
        content.animate(
            [
                {transform: `translateX(${enterFrom === "end" ? 4 : -4}px)`, opacity: 0},
                {transform: "none", opacity: 1},
            ],
            {
                duration: parseFloat(theme.getPropertyValue("--duration-base")) || 200,
                easing: theme.getPropertyValue("--ease-out").trim() || "ease-out",
            },
        )
        // Mount only: the host remounts the shell per scope.
    }, [])
    const reduced = Boolean(useReducedMotion())
    // The column's layout leads an expand and trails a collapse, so the moving rail only clips it.
    const [shown, setShown] = useState(collapsed)
    const [moving, setMoving] = useState(false)
    const [prevCollapsed, setPrevCollapsed] = useState(collapsed)
    if (collapsed !== prevCollapsed) {
        setPrevCollapsed(collapsed)
        setMoving(!reduced)
        if (!collapsed || reduced) setShown(collapsed)
    }
    const settle = useCallback(() => {
        setMoving(false)
        setShown(collapsed)
    }, [collapsed])
    useEffect(() => {
        if (!moving) return
        // Fallback for a transition that never ends (a background tab, an interrupted toggle).
        const timer = setTimeout(settle, RAIL_MS + 100)
        return () => clearTimeout(timer)
    }, [moving, settle])
    const openGroupsAtom = useMemo(
        () => openGroupsAtomFamily(scope.id),
        [openGroupsAtomFamily, scope.id],
    )
    const [persistedOpenGroups, setPersistedOpenGroups] = useAtom(openGroupsAtom)
    const setDefaultOpenGroups = useSetAtom(sidebarDefaultOpenGroupsAtomFamily(scope.id))
    const setAlwaysOpenGroups = useSetAtom(sidebarAlwaysOpenGroupsAtomFamily(scope.id))
    const setCollapsedScope = useSetAtom(sidebarCollapsedScopeAtomFamily(scope.id))
    const selection = scope.useSelection()
    const sections = scope.useSections()

    const visibleSections = useMemo(() => filterVisibleSections(sections), [sections])

    const allItems = useMemo(
        () => visibleSections.flatMap((section) => section.items),
        [visibleSections],
    )

    const selectedKey = useMemo(() => {
        if (selection.mode === "controlled") return selection.selectedKey

        const match = findSelectedRoute(allItems, currentPath)
        // A scope may pin the selected key (e.g. onboarding shows Home selected while the route is
        // the ephemeral playground, or the rail pins the open session whose row shares its agent's
        // URL). The override wins over the route match.
        const overrideKey = selection.selectedKeyOverride
        const overrideRendered = overrideKey ? hasItemKey(allItems, overrideKey) : false
        return resolveSelectedKey(overrideKey, overrideRendered, match.selectedKey)
    }, [allItems, currentPath, selection])

    const selectedKeys = useMemo(() => (selectedKey ? [selectedKey] : []), [selectedKey])
    const defaultOpenKeys = useMemo(() => findDefaultOpenKeys(allItems), [allItems])
    const alwaysOpenKeys = useMemo(() => findAlwaysOpenKeys(allItems), [allItems])
    const persistedOrDefaultOpenGroups = persistedOpenGroups ?? defaultOpenKeys
    // The route decides what is SELECTED, never what is open — it reopened collapsed groups (#6460).
    const openKeys = useMemo(
        () => uniqueKeys([...persistedOrDefaultOpenGroups, ...alwaysOpenKeys]),
        [alwaysOpenKeys, persistedOrDefaultOpenGroups],
    )

    // A `defaultOpen` group renders expanded off `defaultOpenKeys` alone, but the gated entity
    // sources read the open-groups atoms — unpublished, a visibly expanded group stays "idle"
    // and shows "Open to load" forever. Publish (never persist: the persisted atom is empty
    // until localStorage hydrates, so writing there would wipe the real open groups).
    // `alwaysOpen` groups go in for the same reason: they are expanded on screen with nothing
    // persisted and no way to toggle, so the gate has to count them open too.
    useEffect(() => {
        setDefaultOpenGroups((current) =>
            haveSameKeys(current, defaultOpenKeys) ? current : defaultOpenKeys,
        )
    }, [defaultOpenKeys, setDefaultOpenGroups])

    // Published separately from the defaults: the gate falls back to defaults only while a scope
    // has NO persisted record, and an always-open group has to count as open regardless.
    useEffect(() => {
        setAlwaysOpenGroups((current) =>
            haveSameKeys(current, alwaysOpenKeys) ? current : alwaysOpenKeys,
        )
    }, [alwaysOpenKeys, setAlwaysOpenGroups])

    // The gate has to know the rail is collapsed: nothing renders inline there, so an open (or
    // always-open) group must not keep its query subscribed.
    useEffect(() => {
        setCollapsedScope(collapsed)
    }, [collapsed, setCollapsedScope])

    const handleToggleOpenKey = useCallback(
        (key: string) => {
            const nextOpenKeys = persistedOrDefaultOpenGroups.includes(key)
                ? persistedOrDefaultOpenGroups.filter((openKey) => openKey !== key)
                : [...persistedOrDefaultOpenGroups, key]

            setPersistedOpenGroups(nextOpenKeys)
        },
        [persistedOrDefaultOpenGroups, setPersistedOpenGroups],
    )

    const renderSection = (section: SidebarSection, index: number) => {
        const isInlineSection = (section.mode ?? "inline") === "inline"

        return (
            <React.Fragment key={section.key}>
                {section.dividerBefore && (
                    <hr className="my-2 w-full shrink-0 border-0 border-t border-solid border-border-muted" />
                )}
                {renderSlot(section.before, shown)}
                <NavMenu
                    // A following section continues the list: the 2px row gap, not a new top pad.
                    className={clsx(
                        section.placement === "bottom" && "pb-1",
                        index > 0 && !section.dividerBefore && !shown && "!pt-0.5",
                    )}
                    items={section.items}
                    arrange={section.arrange}
                    collapsed={shown}
                    mode={section.mode}
                    selectedKeys={selectedKeys}
                    openKeys={isInlineSection ? openKeys : []}
                    onToggleOpenKey={isInlineSection ? handleToggleOpenKey : undefined}
                    onPopupOpenChange={onPopupOpenChange}
                    onItemSelect={
                        selection.mode === "controlled"
                            ? (key) => {
                                  if (key !== selection.selectedKey) selection.onSelect(key)
                              }
                            : undefined
                    }
                />
            </React.Fragment>
        )
    }

    const topSections = visibleSections.filter((section) => section.placement !== "bottom")
    const bottomSections = visibleSections.filter((section) => section.placement === "bottom")

    // Derived, not a second flag to keep in step with the group that sets it.
    const scrollsWithinAGroup = topSections.some((section) =>
        section.items.some((item) => item.scrollChildren),
    )

    // Navigation notifies the host (the drawer closes itself); expand toggles and group
    // headers must not — hence the anchor check rather than a blanket click handler.
    const handleFrameClick = onNavigate
        ? (event: React.MouseEvent<HTMLDivElement>) => {
              if ((event.target as HTMLElement).closest("a")) onNavigate()
          }
        : undefined

    return (
        <div
            ref={railRef}
            // Width lives in --ag-sidebar-w so a drag can repaint it without a React render;
            // data-resizing kills CSS transitions while the drag's own rAF loop paints the width.
            className={[
                // The right edge line is an allowed border on an area edge (SURF-01, SURF-07). The
                // handle's 2px line covers it on hover and while dragging.
                "group/rail relative [&[data-resizing=true]_*]:!transition-none",
                // The phone sheet has its own edge, so only the docked rail draws the line.
                isOverlay ? "" : "border-0 border-r border-solid border-border-muted",
                // Claim the sheet's height; left to its content the frame collapses to the column.
                // The corners follow the floating sheet's, so the rail's surface cannot square them.
                isOverlay ? "h-full rounded-[inherit]" : "",
                className ?? "",
            ]
                .join(" ")
                .trim()}
            style={
                {
                    "--ag-sidebar-w": phone
                        ? "100%"
                        : `${collapsed ? SIDEBAR_COLLAPSED_WIDTH : width}px`,
                } as CSSProperties
            }
            onClick={handleFrameClick}
        >
            <aside
                data-theme={theme}
                onTransitionEnd={(event) => {
                    if (
                        moving &&
                        event.target === event.currentTarget &&
                        event.propertyName === "width"
                    )
                        settle()
                }}
                className={[
                    // The surface fills the sheet, so it still bleeds behind a phone's toolbar.
                    // overflow-hidden clips to those corners; the switcher's panel portals into
                    // the sheet, outside this element, so it is not cut off.
                    isOverlay
                        ? "h-full w-[var(--ag-sidebar-w)] overflow-hidden rounded-[inherit] bg-muted transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-in-out)] motion-reduce:transition-none"
                        : // --ag-top-bars-h: the app's fixed top bars, 0px on most routes.
                          "sticky top-[var(--ag-top-bars-h,0px)] bottom-0 h-[calc(100dvh-var(--ag-top-bars-h,0px))] w-[var(--ag-sidebar-w)] bg-muted transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-in-out)] motion-reduce:transition-none group-data-[snap]/rail:overflow-hidden",
                    moving ? "overflow-hidden" : "",
                ].join(" ")}
            >
                <div
                    ref={contentRef}
                    // A collapsing column keeps its width and fades; the narrowing rail clips it.
                    style={moving && !shown ? {width} : undefined}
                    className={clsx(
                        // A drag-collapse pins the column (--ag-snap-w) so the gliding rail clips it.
                        "flex flex-col w-[var(--ag-sidebar-w)] transition-opacity duration-[var(--duration-fast)] motion-reduce:transition-none group-data-[snap]/rail:w-[var(--ag-snap-w)]",
                        moving && collapsed && "opacity-0",
                        // `vh` is a phone's toolbars-HIDDEN height; the var also narrows for a keyboard.
                        // Capped at the sheet's height: the sheet floats 8px in from the top and
                        // bottom, so a viewport-tall column ran the workspace row off its bottom.
                        isOverlay ? "h-[min(100%,var(--ag-viewport-height,100dvh))]" : "h-full",
                    )}
                >
                    {renderSlot(scope.header, shown, scope.lastPath, onDismiss)}
                    <SidebarErrorBoundary>
                        {/* One scroller: the top section (the scrolling group owns it when there is one). */}
                        <div className="flex flex-col justify-between items-center h-full min-h-0">
                            <div
                                className={clsx(
                                    "w-full min-h-0 flex-1",
                                    scrollsWithinAGroup
                                        ? "flex flex-col overflow-y-auto"
                                        : "overflow-y-auto",
                                )}
                            >
                                {topSections.map(renderSection)}
                            </div>
                            <div
                                className={clsx(
                                    "w-full flex flex-col shrink-0",
                                    !shown && "pt-2",
                                    // The home indicator sits inside `dvh`; reserve it.
                                    isOverlay && "pb-[env(safe-area-inset-bottom)]",
                                )}
                            >
                                {renderSlot(scope.footer, shown, scope.lastPath)}
                                {bottomSections.map(renderSection)}
                                {renderSlot(scope.afterBottom, shown, scope.lastPath)}
                            </div>
                        </div>
                    </SidebarErrorBoundary>
                </div>
            </aside>
            {/* No resizer in an overlay mount: the sheet is a fixed width, so the handle would
                drag the rail out of alignment with the sheet that frames it. */}
            {!onDismiss && (
                <div
                    // Invisible 8px grab strip centred on the border's inner edge; its line is the shared
                    // resize edge (SURF-07). Also on the icon rail: dragging it out opens the rail.
                    className="group absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={t("navigation.chrome.resizeSidebar")}
                    {...handleProps}
                >
                    <ResizeEdgeLine className="group-data-[resizing=true]/rail:bg-border-strong" />
                </div>
            )}
        </div>
    )
}

export default memo(SidebarShell)
