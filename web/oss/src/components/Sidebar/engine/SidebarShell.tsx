import React, {memo, useCallback, useEffect, useMemo, useRef} from "react"

import {Divider, Layout} from "antd"
import {useAtom} from "jotai"

import SidebarMenu from "./SidebarMenu"
import type {SidebarConfig, SidebarScope, SidebarSection, SidebarShellProps} from "./types"

const {Sider} = Layout

const MENU_CLASS_NAME =
    "border-r-0 overflow-y-auto relative [&_.ant-menu-item-selected]:font-medium"

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
            if (item.link && pathMatchesLink(currentPath, item.link)) {
                const isExact = currentPath === item.link
                const isSameLength = item.link.length === matchedLength
                const isBetterMatch =
                    !matched ||
                    (isExact && !matchedIsExact) ||
                    (isExact === matchedIsExact && item.link.length > matchedLength) ||
                    (isExact === matchedIsExact &&
                        isSameLength &&
                        matched.isDynamic &&
                        !item.isDynamic)

                if (isBetterMatch) {
                    matched = item
                    matchedLength = item.link.length
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

const findNavigableGroupKeys = (items: SidebarConfig[]) => {
    const keys = new Set<string>()

    const visit = (nodes: SidebarConfig[]) => {
        nodes.forEach((item) => {
            if (item.submenu?.length) {
                if (item.link) keys.add(item.key)
                visit(item.submenu)
            }
        })
    }

    visit(items)
    return keys
}

// Drop hidden entries at every level, not just the section root, so nested hidden items
// never render, auto-open, or become selected.
const filterVisibleItems = (items: SidebarConfig[]): SidebarConfig[] =>
    items.flatMap((item) =>
        item.isHidden
            ? []
            : [{...item, submenu: item.submenu ? filterVisibleItems(item.submenu) : undefined}],
    )

const uniqueKeys = (keys: string[]) => Array.from(new Set(keys))

const haveSameKeys = (left: string[], right: string[]) =>
    left.length === right.length && left.every((key) => right.includes(key))

const renderSlot = (
    Slot: SidebarSection["before"] | SidebarScope["header"] | SidebarScope["footer"],
    collapsed: boolean,
) => {
    if (!Slot) return null
    return <Slot collapsed={collapsed} />
}

const SidebarShell: React.FC<SidebarShellProps> = ({
    collapsedAtom,
    currentPath,
    onPopupOpenChange,
    openGroupsAtomFamily,
    scope,
    theme,
}) => {
    const [collapsed] = useAtom(collapsedAtom)
    const openGroupsAtom = useMemo(
        () => openGroupsAtomFamily(scope.id),
        [openGroupsAtomFamily, scope.id],
    )
    const [persistedOpenGroups, setPersistedOpenGroups] = useAtom(openGroupsAtom)
    const lastSelectedKeyRef = useRef<string | undefined>(undefined)
    const selection = scope.useSelection()
    const sections = scope.useSections()

    const visibleSections = useMemo(
        () => sections.filter((section) => section.items.some((item) => !item.isHidden)),
        [sections],
    )

    const allItems = useMemo(
        () => visibleSections.flatMap((section) => filterVisibleItems(section.items)),
        [visibleSections],
    )

    const {selectedKey, routeOpenKeys} = useMemo(() => {
        if (selection.mode === "controlled") {
            return {selectedKey: selection.selectedKey, routeOpenKeys: [] as string[]}
        }

        const match = findSelectedRoute(allItems, currentPath)
        return {selectedKey: match.selectedKey, routeOpenKeys: match.openKeys}
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
    const navigableGroupKeys = useMemo(() => findNavigableGroupKeys(allItems), [allItems])
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

    const handleOpenChange = useCallback(
        (keys: string[]) => {
            const requestedKeys = new Set(keys)
            const nextOpenKeys = uniqueKeys([
                ...keys.filter((key) => !navigableGroupKeys.has(key)),
                ...persistedOrDefaultOpenGroups.filter((key) => navigableGroupKeys.has(key)),
            ]).filter((key) => requestedKeys.has(key) || navigableGroupKeys.has(key))

            setPersistedOpenGroups(nextOpenKeys)
        },
        [navigableGroupKeys, persistedOrDefaultOpenGroups, setPersistedOpenGroups],
    )

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
        const items = filterVisibleItems(section.items)
        if (!items.length) return null

        const isBottomSection = section.placement === "bottom"
        const isInlineSection = (section.mode ?? "inline") === "inline"

        return (
            <React.Fragment key={section.key}>
                {section.dividerBefore && <Divider className="my-1" />}
                {renderSlot(section.before, collapsed)}
                <SidebarMenu
                    menuProps={{
                        className: isBottomSection ? "" : MENU_CLASS_NAME,
                        selectedKeys,
                        ...(isInlineSection
                            ? {
                                  openKeys,
                                  onOpenChange: (keys) => handleOpenChange(keys as string[]),
                              }
                            : {}),
                        onClick:
                            selection.mode === "controlled"
                                ? ({domEvent, key}) => {
                                      domEvent.preventDefault()
                                      if (key !== selection.selectedKey) {
                                          selection.onSelect(key)
                                      }
                                  }
                                : undefined,
                    }}
                    items={items}
                    collapsed={collapsed}
                    mode={section.mode}
                    openKeys={isInlineSection ? openKeys : []}
                    onToggleOpenKey={isInlineSection ? handleToggleOpenKey : undefined}
                    onPopupOpenChange={onPopupOpenChange}
                />
            </React.Fragment>
        )
    }

    const topSections = visibleSections.filter((section) => section.placement !== "bottom")
    const bottomSections = visibleSections.filter((section) => section.placement === "bottom")

    return (
        <div className="border-0 border-r border-solid border-gray-100">
            <Sider
                theme={theme}
                className="sticky top-0 bottom-0 h-screen bg-[var(--ag-sidebar-bg)]"
                collapsible
                width={collapsed ? 80 : 236}
                trigger={null}
            >
                <div
                    className={[
                        "flex flex-col h-full transition-all duration-300",
                        collapsed ? "w-[80px]" : "w-[236px]",
                    ].join(" ")}
                >
                    {renderSlot(scope.header, collapsed)}
                    <SidebarErrorBoundary>
                        <div className="flex flex-col justify-between items-center h-full overflow-y-auto">
                            <div className="flex-1 min-h-0 w-full overflow-y-auto">
                                {topSections.map(renderSection)}
                            </div>
                            <div className="w-full flex flex-col shrink-0">
                                {renderSlot(scope.footer, collapsed)}
                                {bottomSections.map(renderSection)}
                            </div>
                        </div>
                    </SidebarErrorBoundary>
                </div>
            </Sider>
        </div>
    )
}

export default memo(SidebarShell)
