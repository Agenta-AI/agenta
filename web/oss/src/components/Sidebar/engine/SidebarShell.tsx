import React, {memo, useEffect, useMemo, useState} from "react"

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
    // Full ancestor key chain of the matched item, so every enclosing group auto-opens
    // (supports arbitrary nesting, not just the immediate parent).
    let openKeys: string[] = []

    const visit = (nodes: SidebarConfig[], ancestors: string[]) => {
        nodes.forEach((item) => {
            if (item.submenu?.length) {
                visit(item.submenu, [...ancestors, item.key])
                return
            }

            if (
                item.link &&
                pathMatchesLink(currentPath, item.link) &&
                item.link.length > matchedLength
            ) {
                matched = item
                matchedLength = item.link.length
                openKeys = ancestors
            }
        })
    }

    visit(items, [])
    return {selectedKey: matched?.key, openKeys}
}

const renderSlot = (
    Slot: SidebarSection["before"] | SidebarScope["header"] | SidebarScope["footer"],
    collapsed: boolean,
) => {
    if (!Slot) return null
    return <Slot collapsed={collapsed} />
}

const SidebarShell: React.FC<SidebarShellProps> = ({collapsedAtom, currentPath, scope, theme}) => {
    const [collapsed] = useAtom(collapsedAtom)
    // Multi-open in-memory open-group state (Phase 2 swaps this for a persisted,
    // per-(scope, project) atom). Holds every expanded group key at once.
    const [openGroups, setOpenGroups] = useState<string[]>([])
    const selection = scope.useSelection()
    const sections = scope.useSections()

    const visibleSections = useMemo(
        () => sections.filter((section) => section.items.some((item) => !item.isHidden)),
        [sections],
    )

    const allItems = useMemo(
        () => visibleSections.flatMap((section) => section.items.filter((item) => !item.isHidden)),
        [visibleSections],
    )

    const {selectedKey, routeOpenKeys} = useMemo(() => {
        if (selection.mode === "controlled") {
            return {selectedKey: selection.selectedKey, routeOpenKeys: [] as string[]}
        }

        const match = findSelectedRoute(allItems, currentPath)
        return {selectedKey: match.selectedKey, routeOpenKeys: match.openKeys}
    }, [allItems, currentPath, selection])

    // Auto-open the active route's ancestor groups, unioned with whatever the user has
    // manually expanded (never collapse a user-opened group just because the route changed).
    useEffect(() => {
        if (selection.mode !== "route" || routeOpenKeys.length === 0) return

        setOpenGroups((prev) => {
            const next = Array.from(new Set([...prev, ...routeOpenKeys]))
            return next.length === prev.length ? prev : next
        })
    }, [routeOpenKeys, selection.mode])

    const selectedKeys = useMemo(() => (selectedKey ? [selectedKey] : []), [selectedKey])
    const openKeys = useMemo(() => {
        if (selection.mode === "controlled") return selectedKey ? [selectedKey] : []
        return openGroups
    }, [selection.mode, selectedKey, openGroups])

    const renderSection = (section: SidebarSection) => {
        const items = section.items.filter((item) => !item.isHidden)
        if (!items.length) return null

        const isBottomSection = section.placement === "bottom"

        return (
            <React.Fragment key={section.key}>
                {section.dividerBefore && <Divider className="my-1" />}
                {renderSlot(section.before, collapsed)}
                <SidebarMenu
                    menuProps={{
                        className: isBottomSection ? "" : MENU_CLASS_NAME,
                        selectedKeys,
                        openKeys,
                        onOpenChange: (keys) => setOpenGroups(keys as string[]),
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
