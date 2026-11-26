import type {Workflow} from "@agenta/entities/workflow"

/** One archived app, reduced to what its row shows. */
export interface ArchivedAppRow {
    id: string
    name: string
    createdAt: string | null
    archivedAt: string | null
    archivedById: string | null
}

export const toArchivedAppRow = (workflow: Workflow): ArchivedAppRow => ({
    id: workflow.id,
    name: workflow.name?.trim() || workflow.slug?.trim() || "Untitled app",
    createdAt: workflow.created_at ?? null,
    archivedAt: workflow.deleted_at ?? null,
    archivedById: workflow.deleted_by_id ?? null,
})

/** A date cell: the reader's local calendar day, or a dash when the server sent none. */
export const formatDay = (iso: string | null): string => {
    if (!iso) return "—"
    const time = Date.parse(iso)
    if (Number.isNaN(time)) return "—"
    return new Date(time).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    })
}
