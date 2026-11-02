import type {Testset} from "@agenta/entities/testset"

export type {TestsetExportFormat} from "./useTestsetRowActions"

/** What the row menu can do for one row. `onClone` and `onRename` are absent until those flows exist. */
export interface TestsetRowActions {
    onOpen: () => void
    onExport: (format: "csv" | "json") => void
    onArchive: () => void
    onClone?: () => void
    onRename?: () => void
}

export type TestsetRow = Pick<Testset, "id" | "name" | "created_at" | "created_by_id">
