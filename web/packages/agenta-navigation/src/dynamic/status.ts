import type {SidebarEntitySource} from "./types"

export const getSidebarSourceStatusLabel = (
    status: SidebarEntitySource["status"],
    emptyLabel = "No items",
) => {
    switch (status) {
        case "idle":
            return "Open to load"
        case "loading":
            return "Loading"
        case "error":
            return "Failed to load"
        case "ready":
            return emptyLabel
    }
}
