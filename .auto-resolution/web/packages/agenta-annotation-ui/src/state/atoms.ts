import {atom} from "jotai"

export interface CreateQueueDrawerSelection {
    itemType: "traces" | "testcases"
    itemIds: string[]
}

/** Controls the create queue drawer visibility */
export const createQueueDrawerOpenAtom = atom(false)

/** Controls the default kind for the create queue drawer */
export const createQueueDrawerDefaultKindAtom = atom<"traces" | "testcases">("traces")

/** Carries the selected items when creating a queue from observability/testsets. */
export const createQueueDrawerSelectionAtom = atom<CreateQueueDrawerSelection | null>(null)
