import React, {type CSSProperties, memo, useCallback, useEffect, useMemo, useRef} from "react"

import {
    filterVisibleSections,
    SIDEBAR_COLLAPSED_WIDTH,
    type SidebarConfig,
    type SidebarScope,
    type SidebarSection,
    type SidebarShellProps,
    useSidebarResize,
} from "@agenta/navigation"
import {useAtom} from "jotai"

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
    // Full ancestor key chain of the matched item, so every enclosing group auto-opens
    // (supports arbitrary nesting, not just the immediate parent).
    let openKeys: string[] = []

    const visit = (nodes: SidebarConfig[], ancestors: string[]) => {
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
                    openKeys = ancestors
                }
            }

            if (item.submenu?.length) {
                visit(item.submenu, [...ancestors, item.key])
            }
        })
    }

    visit(items, [])
    return {selectedKey: matched?.key, openKeys}
}

const findAncestorKeys = (items: SidebarConfig[], selectedKey?: string) => {
    if (!selectedKey) return []

    const visit = (nodes: SidebarConfig[], ancestors: string[]): string[] | undefined => {
        for (const item of nodes) {
            if (item.key === selectedKey) return ancestors

            if (item.submenu?.length) {
                const match = visit(item.submenu, [...ancestors, item.key])
                if (match) return match
            }
        }

        return undefined
    }

    return visit(items, []) ?? []
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
) => {
    if (!Slot) return null
    return <Slot collapsed={collapsed} lastPath={lastPath} />
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
}) => {
    const [collapsed] = useAtom(collapsedAtom)
    const railRef = useRef<HTMLDivElement>(null)
    const {width, handleProps} = useSidebarResize({railRef, disabled: collapsed})
    const openGroupsAtom = useMemo(
        () => openGroupsAtomFamily(scope.id),
        [openGroupsAtomFamily, scope.id],
    )
    const [persistedOpenGroups, setPersistedOpenGroups] = useAtom(openGroupsAtom)
    const lastSelectedKeyRef = useRef<string | undefined>(undefined)
    const selection = scope.useSelection()
    const sections = scope.useSections()

    const visibleSections = useMemo(() => filterVisibleSections(sections), [sections])

    const allItems = useMemo(
        () => visibleSections.flatMap((section) => section.items),
        [visibleSections],
    )

    const {selectedKey, routeOpenKeys} = useMemo(() => {
        if (selection.mode === "controlled") {
            return {selectedKey: selection.selectedKey, routeOpenKeys: [] as string[]}
        }

        const match = findSelectedRoute(allItems, currentPath)
        // A scope may pin the selected key (e.g. onboarding shows Home selected while the route is
        // the ephemeral playground). The override wins over the route match; open keys still follow it.
        return {
            selectedKey: selection.selectedKeyOverride ?? match.selectedKey,
            routeOpenKeys: match.openKeys,
        }
    }, [allItems, currentPath, selection])

    const selectedKeys = useMemo(() => (selectedKey ? [selectedKey] : []), [selectedKey])
    const defaultOpenKeys = useMemo(() => findDefaultOpenKeys(allItems), [allItems])
    const activeAncestorKeys = useMemo(
        () =>
            selection.mode === "controlled"
                ? findAncestorKeys(allItems, selectedKey)
                : routeOpenKeys,
        [allItems, routeOpenKeys, selectedKey, selection.mode],
    )
    const persistedOrDefaultOpenGroups = persistedOpenGroups ?? defaultOpenKeys
    const openKeys = useMemo(
        () => uniqueKeys(persistedOrDefaultOpenGroups),
        [persistedOrDefaultOpenGroups],
    )

    useEffect(() => {
        if (selectedKey === lastSelectedKeyRef.current && persistedOpenGroups !== undefined) return
        lastSelectedKeyRef.current = selectedKey

        if (!activeAncestorKeys.length) return

        const nextOpenKeys = uniqueKeys([...persistedOrDefaultOpenGroups, ...activeAncestorKeys])
        if (haveSameKeys(nextOpenKeys, persistedOrDefaultOpenGroups)) return

        setPersistedOpenGroups(nextOpenKeys)
    }, [
        activeAncestorKeys,
        persistedOpenGroups,
        persistedOrDefaultOpenGroups,
        selectedKey,
        setPersistedOpenGroups,
    ])

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
                    // --ag-demo-banner-h: the fixed demo banner would cover the brand row on
                    // document-scrolling routes; 0px everywhere else.
                    "sticky top-[var(--ag-demo-banner-h,0px)] bottom-0 h-[calc(100vh-var(--ag-demo-banner-h,0px))] w-[var(--ag-sidebar-w)] bg-[var(--ag-sidebar-bg)] transition-all duration-300",
                ].join(" ")}
            >
                <div className="flex flex-col h-full w-[var(--ag-sidebar-w)] transition-all duration-300">
                    {renderSlot(scope.header, collapsed, scope.lastPath)}
                    <SidebarErrorBoundary>
                        <div className="flex flex-col justify-between items-center h-full overflow-y-auto">
                            <div className="flex-1 min-h-0 w-full overflow-y-auto">
                                {topSections.map(renderSection)}
                            </div>
                            <div className="w-full flex flex-col shrink-0">
                                {renderSlot(scope.footer, collapsed, scope.lastPath)}
                                {bottomSections.map(renderSection)}
                                {renderSlot(scope.afterBottom, collapsed, scope.lastPath)}
                            </div>
                        </div>
                    </SidebarErrorBoundary>
                </div>
            </aside>
            {!collapsed && (
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
