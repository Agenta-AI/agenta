import type {SimpleQueueTableRow} from "@agenta/entities/simpleQueue"
import {ListTableToolbar} from "@agenta/ui/list-table"
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@agenta/ui/ui"

import {QueueListTable} from "./QueueListTable"
import {QueueLoadMore} from "./QueueLoadMore"
import {QueueListLoadError} from "./states/QueueListLoadError"
import {QueueListSkeleton} from "./states/QueueListSkeleton"
import {QueuesFirstRun} from "./states/QueuesFirstRun"
import {QueuesNoMatch} from "./states/QueuesNoMatch"
import type {QueueToDelete} from "./useQueueDelete"
import type {QueueKindFilter} from "./useQueueList"

const ALL_TYPES = "all"

export interface QueueListContentProps {
    rows: SimpleQueueTableRow[]
    /** `/w/:workspace/p/:project` */
    base: string
    isLoading: boolean
    isError: boolean
    hasMore: boolean
    isLoadingMore: boolean
    search: string
    /** The term the server filtered by. It trails `search` by the debounce. */
    appliedSearch: string
    kind: QueueKindFilter
    canEdit: boolean
    onSearchChange: (next: string) => void
    onClearSearch: () => void
    onKindChange: (next: QueueKindFilter) => void
    onLoadMore: () => void
    onRetry: () => void
    onCreate: () => void
    onDelete: (queue: QueueToDelete) => void
}

/**
 * The toolbar and the results. State precedence: load error (only when nothing is loaded), loading
 * skeleton, rows, search with no match, type filter with no match, first run.
 */
export const QueueListContent = (props: QueueListContentProps) => {
    const term = props.appliedSearch.trim()
    const hasRows = props.rows.length > 0
    const showError = props.isError && !hasRows
    const showSkeleton = !showError && props.isLoading && !hasRows

    const empty = term ? (
        <QueuesNoMatch term={term} onClear={props.onClearSearch} />
    ) : props.kind ? (
        <QueuesNoMatch onClear={() => props.onKindChange(null)} />
    ) : (
        <QueuesFirstRun onCreate={props.canEdit ? props.onCreate : undefined} />
    )

    return (
        <>
            <ListTableToolbar
                search={props.search}
                onSearchChange={props.onSearchChange}
                searchPlaceholder="Search queues"
                actions={
                    <Select
                        value={props.kind ?? ALL_TYPES}
                        onValueChange={(value) =>
                            props.onKindChange(
                                value === ALL_TYPES ? null : (value as QueueKindFilter),
                            )
                        }
                    >
                        <SelectTrigger size="sm" aria-label="Type" className="w-[140px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL_TYPES}>All types</SelectItem>
                            <SelectItem value="traces">Traces</SelectItem>
                            <SelectItem value="testcases">Test cases</SelectItem>
                        </SelectContent>
                    </Select>
                }
            />
            {showError ? (
                <QueueListLoadError onRetry={props.onRetry} />
            ) : showSkeleton ? (
                <QueueListSkeleton />
            ) : (
                <>
                    <QueueListTable
                        rows={props.rows}
                        base={props.base}
                        isLoading={false}
                        canDelete={props.canEdit}
                        onDelete={props.onDelete}
                        empty={empty}
                    />
                    <QueueLoadMore
                        hasMore={props.hasMore}
                        isLoadingMore={props.isLoadingMore}
                        onLoadMore={props.onLoadMore}
                    />
                </>
            )}
        </>
    )
}
