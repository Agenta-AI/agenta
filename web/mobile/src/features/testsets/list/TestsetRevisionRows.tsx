import {useEffect} from "react"

import {formatListDateTime} from "@agenta/ui/list-table"
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
 */
export const TestsetRevisionRows = ({
    projectId,
    testsetId,
    testsetName,
    onOpenRevision,
}: {
    projectId: string
    testsetId: string
    testsetName: string
    onOpenRevision: (revisionId: string) => void
}) => {
    const {revisions, status, load} = useRevisionsList({projectId, testsetId})
    useEffect(() => load(), [load])
    const queryClient = useQueryClient()
    const retry = () =>
        void queryClient.refetchQueries({queryKey: revisionsListQueryKey(projectId, testsetId)})

    return (
        <div
            role="group"
            aria-label={`Revisions of ${testsetName}`}
            className="mb-1 ml-8 border-0 border-l border-solid border-border pl-3"
        >
            {status === "error" ? (
                <p className="m-0 flex items-center gap-2 py-2 text-[13px] text-muted-foreground">
                    Couldn't load the revisions
                    <Button type="button" size="xs" variant="outline" onClick={retry}>
                        Try again
                    </Button>
                </p>
            ) : status !== "ready" ? (
                <p className="m-0 flex items-center gap-2 py-2 text-[13px] text-muted-foreground">
                    <Spinner aria-hidden />
                    Loading revisions
                </p>
            ) : revisions.length === 0 ? (
                <p className="m-0 py-2 text-[13px] text-muted-foreground">No saved revisions yet</p>
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
                                    className="grid w-full cursor-pointer grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-[13px] hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--ag-controlOutline)]"
                                >
                                    <span className="w-fit rounded-sm bg-secondary px-1.5 text-[12px] font-medium text-secondary-foreground">
                                        v{revision.version}
                                    </span>
                                    <span
                                        className={`truncate ${message ? "text-muted-foreground" : "text-placeholder"}`}
                                    >
                                        {message ?? "—"}
                                    </span>
                                    <span className="text-placeholder">
                                        {formatListDateTime(revision.createdAt)}
                                    </span>
                                </button>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}
