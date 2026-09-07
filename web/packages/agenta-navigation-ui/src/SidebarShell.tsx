import React, {type CSSProperties, memo, useCallback, useEffect, useMemo, useRef} from "react"

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
import clsx from "clsx"
import {useAtom, useSetAtom} from "jotai"

import {NavMenu} from "./NavMenu"

class SidebarErrorBoundary extends React.Component<React.PropsWithChildren, {hasError: boolean}> {
    state = {hasError: false}

    static getDerivedStateFromError() {
        return {hasError: true}
    }

    render() {
        if (this.state.hasError) return <div />
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
            if (!item.submenu?.length) return
            if (item.alwaysOpen) keys.push(item.key)
            visit(item.submenu)
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
}) => {
    // Only a drawer can dismiss the rail, so this is also how the shell knows it is in a sheet.
    const isOverlay = Boolean(onDismiss)
    const [collapsed] = useAtom(collapsedAtom)
    const railRef = useRef<HTMLDivElement>(null)
    const {width, handleProps} = useSidebarResize({railRef, disabled: collapsed})
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

    const renderSection = (section: SidebarSection) => {
        const isInlineSection = (section.mode ?? "inline") === "inline"

        return (
            <React.Fragment key={section.key}>
                {section.dividerBefore && (
                    <hr className="my-1 w-full border-0 border-t border-solid border-colorBorderSecondary" />
                )}
                {renderSlot(section.before, collapsed)}
                <NavMenu
                    // A bottom section is anchored from below, so it needs the trailing 4px to
                    // hold its own height; a top section must not have it, or it pushes every
                    // section after it down the rail.
                    className={section.placement === "bottom" ? "pb-1" : undefined}
                    items={section.items}
                    collapsed={collapsed}
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
            // data-resizing kills the collapse transition so the rail tracks the pointer 1:1.
            className={[
                "group/rail relative border-0 border-r border-solid border-[var(--ag-shell-line)] [&[data-resizing=true]_*]:!transition-none",
                // Claim the sheet's height; left to its content the frame collapses to the column.
                isOverlay ? "h-full" : "",
                className ?? "",
            ]
                .join(" ")
                .trim()}
            style={
                {
                    "--ag-sidebar-w": `${collapsed ? SIDEBAR_COLLAPSED_WIDTH : width}px`,
                } as CSSProperties
            }
            onClick={handleFrameClick}
        >
            <aside
                data-theme={theme}
                className={[
                    // The surface fills the sheet, so it still bleeds behind a phone's toolbar.
                    isOverlay
                        ? "h-full w-[var(--ag-sidebar-w)] bg-[var(--ag-sidebar-bg)] transition-all duration-300"
                        : // --ag-demo-banner-h: the fixed demo banner would cover the brand row on
                          // document-scrolling routes; 0px everywhere else.
                          "sticky top-[var(--ag-demo-banner-h,0px)] bottom-0 h-[calc(100vh-var(--ag-demo-banner-h,0px))] w-[var(--ag-sidebar-w)] bg-[var(--ag-sidebar-bg)] transition-all duration-300",
                ].join(" ")}
            >
                <div
                    className={clsx(
                        "flex flex-col w-[var(--ag-sidebar-w)] transition-all duration-300",
                        // `vh` is a phone's toolbars-HIDDEN height; the var also narrows for a keyboard.
                        isOverlay ? "h-[var(--ag-viewport-height,100dvh)]" : "h-full",
                    )}
                >
                    {renderSlot(scope.header, collapsed, scope.lastPath, onDismiss)}
                    <SidebarErrorBoundary>
                        <div className="flex flex-col justify-between items-center h-full overflow-y-auto">
                            <div
                                className={clsx(
                                    "w-full min-h-0 flex-1",
                                    // A group that scrolls its own rows owns the scrolling: the
                                    // rail must NOT scroll too, or the entries after that group
                                    // still leave the screen. Every other scope is unchanged.
                                    scrollsWithinAGroup
                                        ? "flex flex-col overflow-hidden"
                                        : "overflow-y-auto",
                                )}
                            >
                                {topSections.map(renderSection)}
                            </div>
                            <div
                                className={clsx(
                                    "w-full flex flex-col shrink-0",
                                    // The home indicator sits inside `dvh`; reserve it.
                                    isOverlay && "pb-[env(safe-area-inset-bottom)]",
                                )}
                            >
                                {renderSlot(scope.footer, collapsed, scope.lastPath)}
                                {bottomSections.map(renderSection)}
                                {renderSlot(scope.afterBottom, collapsed, scope.lastPath)}
                            </div>
                        </div>
                    </SidebarErrorBoundary>
                </div>
            </aside>
            {/* No resizer in an overlay mount: the sheet is a fixed width, so the handle would
                drag the rail out of alignment with the sheet that frames it. */}
            {!collapsed && !onDismiss && (
                <div
                    // Invisible 9px grab strip straddling the hairline; the ::after IS the
                    // hairline, tinted only while hovering or dragging.
                    className="absolute inset-y-0 -right-1 z-10 w-[9px] cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-colorBorder group-data-[resizing=true]/rail:after:bg-colorPrimary"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize sidebar"
                    {...handleProps}
                />
            )}
        </div>
    )
}

export default memo(SidebarShell)
