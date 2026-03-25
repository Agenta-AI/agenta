/**
 * Simple Queue Modal Adapters
 *
 * Registers the "simpleQueue" entity adapter for the unified modal system.
 * This enables EntityDeleteModal to work with annotation queues.
 */

import {simpleQueue, type SimpleQueue} from "@agenta/entities"
import {atom} from "jotai"

import {createAndRegisterEntityAdapter, type EntityModalAdapter} from "../modals"

const deleteSimpleQueuesReducer = atom(null, async (_get, set, ids: string[]): Promise<void> => {
    await set(simpleQueue.actions.deleteQueues, ids)
})

const simpleQueueDataAtom = (id: string) =>
    atom((get) => {
        return (get(simpleQueue.selectors.data(id)) as SimpleQueue | null) ?? null
    })

export const simpleQueueModalAdapter: EntityModalAdapter<SimpleQueue> =
    createAndRegisterEntityAdapter({
        type: "simpleQueue",
        getDisplayName: (entity) => entity?.name?.trim() || "Untitled queue",
        getDisplayLabel: (count) => (count === 1 ? "Annotation queue" : "Annotation queues"),
        deleteAtom: deleteSimpleQueuesReducer,
        dataAtom: simpleQueueDataAtom,
        canDelete: () => true,
        getDeleteWarning: () => null,
    })
