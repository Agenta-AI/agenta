import type {SidebarConfig, SidebarSection} from "./types"

// Hidden entries are dropped at every level, not just the section root.
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
