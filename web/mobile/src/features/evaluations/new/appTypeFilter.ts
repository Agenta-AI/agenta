import type {WorkflowType} from "@agenta/entities/workflow"

/** The app types the Application step filters by, as /w offers them. */
export type AppTypeFilter = "all" | "chat" | "completion" | "custom"

export const APP_TYPE_FILTERS: readonly {value: AppTypeFilter; label: string}[] = [
    {value: "all", label: "All types"},
    {value: "chat", label: "Chat"},
    {value: "completion", label: "Completion"},
    {value: "custom", label: "Custom"},
]

/**
 * The apps whose name matches the search and whose type matches the filter. An app whose type
 * has not loaded yet shows only under "All types".
 */
export const filterApps = <App extends {id: string; name?: string | null; slug?: string | null}>(
    apps: readonly App[],
    types: ReadonlyMap<string, WorkflowType | null>,
    search: string,
    filter: AppTypeFilter,
): App[] => {
    const needle = search.trim().toLowerCase()
    return apps.filter(
        (app) =>
            (!needle || (app.name || app.slug || "").toLowerCase().includes(needle)) &&
            (filter === "all" || types.get(app.id) === filter),
    )
}
