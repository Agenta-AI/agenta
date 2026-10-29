import type {SidebarConfig, SidebarWorkflowCategory} from "@agenta/navigation"

export const filterWorkflowSidebarItems = (
    items: SidebarConfig[],
    category: SidebarWorkflowCategory,
): SidebarConfig[] =>
    items.filter((item) => !item.workflowCategories || item.workflowCategories.includes(category))
