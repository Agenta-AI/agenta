import {useCallback, useMemo, useState} from "react"

import {
    simpleQueueMolecule,
    simpleQueuesListDataAtom,
    simpleQueuesListQueryAtom,
} from "@agenta/entities/simpleQueue"
import type {AddToQueuePopoverSlotProps} from "@agenta/observability-ui/traceDrawer"
import {dayjs} from "@agenta/shared/utils"
import {message} from "@agenta/ui/app-message"
import {useAtomValue, useSetAtom} from "jotai"

import type {PickerQueue} from "./AddToQueuePickerPanel"

type HookArgs = Pick<
    AddToQueuePopoverSlotProps,
    "itemType" | "itemIds" | "onItemsAdded" | "onQueueSelected"
> & {onClose: () => void}

const ITEM_LABEL = {traces: "trace", testcases: "test case"} as const

/** Queue list, search and the add call for one open picker. */
export const useAddToQueuePicker = ({
    itemType,
    itemIds = [],
    onItemsAdded,
    onQueueSelected,
    onClose,
}: HookArgs) => {
    const queues = useAtomValue(simpleQueuesListDataAtom)
    const listQuery = useAtomValue(simpleQueuesListQueryAtom)
    const addTraces = useSetAtom(simpleQueueMolecule.actions.addTraces)
    const addTestcases = useSetAtom(simpleQueueMolecule.actions.addTestcases)
    const [search, setSearch] = useState("")
    const [submittingId, setSubmittingId] = useState<string | null>(null)

    const visible = useMemo(() => {
        const term = search.trim().toLowerCase()
        return queues
            .filter((queue) => queue.data?.kind === itemType)
            .filter((queue) => !term || (queue.name || "").toLowerCase().includes(term))
    }, [queues, itemType, search])

    const rows = useMemo<PickerQueue[]>(
        () =>
            visible.map((queue) => ({
                id: queue.id,
                name: queue.name || "Untitled",
                updated: queue.updated_at ? `Updated ${dayjs(queue.updated_at).fromNow()}` : "",
            })),
        [visible],
    )

    const status =
        queues.length === 0 && listQuery.isPending
            ? "loading"
            : queues.length === 0 && listQuery.isError
              ? "error"
              : "ready"

    const select = useCallback(
        async (queueId: string) => {
            const queue = visible.find((entry) => entry.id === queueId)
            if (!queue) return
            // Picker mode: the caller owns the add.
            if (onQueueSelected) {
                onQueueSelected(queue)
                onClose()
                return
            }
            if (itemIds.length === 0) return
            setSubmittingId(queueId)
            try {
                const added =
                    itemType === "traces"
                        ? await addTraces(queueId, itemIds)
                        : await addTestcases(queueId, itemIds)
                if (added) {
                    const label = `${ITEM_LABEL[itemType]}${itemIds.length > 1 ? "s" : ""}`
                    message.success(
                        `Added ${itemIds.length} ${label} to "${queue.name || "Untitled"}".`,
                    )
                    onItemsAdded?.()
                    onClose()
                }
            } catch (error) {
                console.error("Adding items to a queue failed", error)
                message.error("Couldn't add to this queue")
            } finally {
                setSubmittingId(null)
            }
        },
        [
            visible,
            onQueueSelected,
            onClose,
            itemIds,
            itemType,
            addTraces,
            addTestcases,
            onItemsAdded,
        ],
    )

    return {
        rows,
        status,
        search,
        setSearch,
        submittingId,
        select,
        retry: () => void listQuery.refetch(),
        emptyMessage: `No ${ITEM_LABEL[itemType]} queues`,
    } as const
}
