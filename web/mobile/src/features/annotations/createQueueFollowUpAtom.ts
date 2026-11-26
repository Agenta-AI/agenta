import type {SimpleQueue} from "@agenta/entities/simpleQueue"
import {atom} from "jotai"

/** The picker's items and what runs with the queue the create sheet made for them. */
export interface CreateQueueFollowUp {
    /** The kind of the items the picker adds: the new queue must hold that kind. */
    itemType: "traces" | "testcases"
    run: (queue: SimpleQueue) => void
}

/**
 * What runs with the queue the create sheet just made, when the sheet opened from a picker that
 * hands the picked queue to its caller ("Add all matching filter to queue"). Without it, "New"
 * there creates an empty queue and the traces are never added. The sheet clears it on close.
 */
export const createQueueFollowUpAtom = atom<CreateQueueFollowUp | null>(null)
