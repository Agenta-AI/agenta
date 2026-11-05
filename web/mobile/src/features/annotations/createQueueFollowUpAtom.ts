import type {SimpleQueue} from "@agenta/entities/simpleQueue"
import {atom} from "jotai"

/**
 * What runs with the queue the create sheet just made, when the sheet opened from a picker that
 * hands the picked queue to its caller ("Add all matching filter to queue"). Without it, "New"
 * there creates an empty queue and the traces are never added. The sheet clears it on close.
 */
export const createQueueFollowUpAtom = atom<((queue: SimpleQueue) => void) | null>(null)
