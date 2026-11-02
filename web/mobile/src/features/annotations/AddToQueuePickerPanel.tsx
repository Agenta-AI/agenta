import {SearchInput} from "@agenta/ui/ui"

import {AddToQueuePickerEmpty} from "./states/AddToQueuePickerEmpty"
import {AddToQueuePickerError} from "./states/AddToQueuePickerError"
import {AddToQueuePickerSkeleton} from "./states/AddToQueuePickerSkeleton"

export interface PickerQueue {
    id: string
    name: string
    /** Already formatted, for example "Updated 2 hours ago". */
    updated: string
}

export interface AddToQueuePickerPanelProps {
    queues: PickerQueue[]
    status: "loading" | "error" | "ready"
    search: string
    onSearchChange: (value: string) => void
    /** The queue being written to; every row is disabled while one add is in flight. */
    submittingId: string | null
    emptyMessage: string
    onSelect: (queueId: string) => void
    onRetry: () => void
}

/** The picker body: a search box over a list of queues. Data and writes live in the caller. */
export const AddToQueuePickerPanel = ({
    queues,
    status,
    search,
    onSearchChange,
    submittingId,
    emptyMessage,
    onSelect,
    onRetry,
}: AddToQueuePickerPanelProps) => (
    <div className="flex flex-col">
        <div className="flex flex-col gap-2 p-3">
            <p className="m-0 text-sm font-medium">Select annotation queue</p>
            <SearchInput
                placeholder="Search queues..."
                value={search}
                onValueChange={onSearchChange}
                aria-label="Search queues"
            />
        </div>
        <div className="max-h-[min(22.5rem,50dvh)] overflow-y-auto border-0 border-t border-solid border-border">
            {status === "loading" ? (
                <AddToQueuePickerSkeleton />
            ) : status === "error" ? (
                <AddToQueuePickerError onRetry={onRetry} />
            ) : queues.length === 0 ? (
                <AddToQueuePickerEmpty
                    message={search.trim() ? "No matching queues" : emptyMessage}
                />
            ) : (
                <ul className="m-0 list-none p-0 py-1">
                    {queues.map((queue) => (
                        <li key={queue.id}>
                            <button
                                type="button"
                                disabled={submittingId !== null}
                                onClick={() => onSelect(queue.id)}
                                className="flex w-full min-h-11 cursor-pointer flex-col items-start justify-center border-0 bg-transparent px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:cursor-wait disabled:opacity-50"
                            >
                                <span
                                    className={
                                        submittingId === queue.id
                                            ? "w-full truncate text-sm font-semibold"
                                            : "w-full truncate text-sm"
                                    }
                                >
                                    {queue.name}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {queue.updated}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    </div>
)
