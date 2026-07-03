import type {SidebarConfig, SidebarWorkflowCategory} from "../engine/types"

export const filterWorkflowSidebarItems = (
    items: SidebarConfig[],
    category: SidebarWorkflowCategory,
): SidebarConfig[] =>
    items.filter((item) => !item.workflowCategories || item.workflowCategories.includes(category))
