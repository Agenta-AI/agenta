import type {ConnectToTestsetPayload} from "@agenta/playground"
import {atom} from "jotai"

/**
 * "keep": completion playground with local draft rows. Offers keeping the
 * drafts as unsaved additions to the loaded test set, or discarding them.
 *
 * "chat-replace": chat playground with a drafted conversation. The chat
 * playground loads one testcase at a time, so drafts cannot be kept; the
 * modal only warns that loading replaces the conversation.
 */
export type KeepDraftRowsVariant = "keep" | "chat-replace"

interface KeepDraftRowsModalState {
    open: boolean
    variant: KeepDraftRowsVariant
    /** Number of meaningful draft rows, for the modal copy */
    draftCount: number
    /** Name of the test set the user picked, for the modal copy */
    targetTestsetName: string | null
    /** The connect payload to run once the user decides */
    pendingPayload: ConnectToTestsetPayload | null
}

export const initialKeepDraftRowsState: KeepDraftRowsModalState = {
    open: false,
    variant: "keep",
    draftCount: 0,
    targetTestsetName: null,
    pendingPayload: null,
}

export const keepDraftRowsModalAtom = atom<KeepDraftRowsModalState>(initialKeepDraftRowsState)
