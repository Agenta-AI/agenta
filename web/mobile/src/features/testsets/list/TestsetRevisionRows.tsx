import {useEffect} from "react"

import {formatListDateTime, type ListTableColumn} from "@agenta/ui/list-table"
import {Button, Spinner} from "@agenta/ui/ui"
import {useQueryClient} from "@tanstack/react-query"

import {revisionsListQueryKey, useRevisionsList} from "../detail/useRevisionsList"

import {visibleCommitMessage} from "./commitMessage"

/**
 * The saved revisions of one test set, under its row in the list: the version, the commit
 * message and the date with the time, newest first. A click opens that revision, the same page
 * the editor's version picker opens.
 *
 * The request goes out when the row is expanded, and shares its cache with the version picker.
 * Each revision sits on the list's own column grid, so its cells line up with the headers.
 */
export const TestsetRevisionRows = ({
    projectId,
    testsetId,
    testsetName,
    onOpenRevision,
    columns,
    selecting,
}: {
    projectId: string
    testsetId: string
    testsetName: string
    onOpenRevision: (revisionId: string) => void
    /** The list's columns, in order. */
    columns: readonly ListTableColumn[]
    /** The list has a checkbox column in front. */
    selecting: boolean
}) => {
    const {revisions, status, load} = useRevisionsList({projectId, testsetId})
    useEffect(() => load(), [load])
    const queryClient = useQueryClient()
    const retry = () =>
        void queryClient.refetchQueries({queryKey: revisionsListQueryKey(projectId, testsetId)})
    const gridTemplateColumns = [selecting ? "20px" : null, ...columns.map((c) => c.width)]
        .filter(Boolean)
        .join(" ")
    const hasCommitColumn = columns.some((column) => column.key === "commit")

    return (
        <div role="group" aria-label={`Revisions of ${testsetName}`} className="mb-1">
            {status === "error" ? (
                <p className="m-0 flex items-center gap-2 py-2 pl-8 text-[13px] text-muted-foreground">
                    Couldn't load the revisions
                    <Button type="button" size="xs" variant="outline" onClick={retry}>
                        Try again
                    </Button>
                </p>
            ) : status !== "ready" ? (
                <p className="m-0 flex items-center gap-2 py-2 pl-8 text-[13px] text-muted-foreground">
                    <Spinner aria-hidden />
                    Loading revisions
                </p>
            ) : revisions.length === 0 ? (
                <p className="m-0 py-2 pl-8 text-[13px] text-muted-foreground">
                    No saved revisions yet
                </p>
            ) : (
                <ul className="m-0 list-none p-0">
                    {revisions.map((revision) => {
                        const message = visibleCommitMessage(revision.message)
                        return (
                            <li key={revision.id}>
                                <button
                                    type="button"
                                    aria-label={`Open v${revision.version} of ${testsetName}`}
                                    onClick={() => onOpenRevision(revision.id)}
                                    style={{gridTemplateColumns}}
                                    className="-mx-3 grid w-[calc(100%+1.5rem)] cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-3 py-1.5 text-left text-[13px] hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--ag-controlOutline)]"
                                >
                                    {selecting ? <span aria-hidden /> : null}
                                    {columns.map((column) => {
                                        if (column.key === "name") {
                                            return (
                                                <span
                                                    key={column.key}
                                                    className="flex min-w-0 items-center gap-2 pl-6"
                                                >
                                                    <span className="w-fit shrink-0 rounded-sm bg-secondary px-1.5 text-[12px] font-medium text-secondary-foreground">
                                                        v{revision.version}
                                                    </span>
                                                    {hasCommitColumn ? null : (
                                                        <span className="truncate text-muted-foreground">
                                                            {message ?? ""}
                                                        </span>
                                                    )}
                                                </span>
                                            )
                                        }
                                        if (column.key === "commit") {
                                            return (
                                                <span
                                                    key={column.key}
                                                    className={`truncate ${message ? "text-muted-foreground" : "text-placeholder"}`}
                                                >
                                                    {message ?? "—"}
                                                </span>
                                            )
                                        }
                                        if (column.key === "created") {
                                            return (
                                                <span
                                                    key={column.key}
                                                    className="truncate text-placeholder"
                                                >
                                                    {formatListDateTime(revision.createdAt)}
                                                </span>
                                            )
                                        }
                                        return <span key={column.key} aria-hidden />
                                    })}
                                </button>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}
