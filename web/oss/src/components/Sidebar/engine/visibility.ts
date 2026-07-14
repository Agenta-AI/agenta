import type {SidebarConfig, SidebarSection} from "./types"

// Drop hidden entries at every level, not just the section root, so nested hidden items
// never render, auto-open, or become selected.
export const filterVisibleItems = (items: SidebarConfig[]): SidebarConfig[] =>
    items.flatMap((item) =>
        item.isHidden
            ? []
            : [{...item, submenu: item.submenu ? filterVisibleItems(item.submenu) : undefined}],
    )

export const filterVisibleSections = (sections: SidebarSection[]): SidebarSection[] =>
    sections
        .map((section) => ({...section, items: filterVisibleItems(section.items)}))
        .filter((section) => section.items.length > 0)
