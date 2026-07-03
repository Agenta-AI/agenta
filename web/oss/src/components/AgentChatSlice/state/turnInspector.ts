import {atom} from "jotai"

/** Which assistant turn the Turn Inspector is open on. `null` = closed. */
export interface TurnInspectorTarget {
    sessionId: string
    /** The assistant turn's message id (its parts drive the Timeline tab). */
    assistantMessageId: string
}

export const turnInspectorAtom = atom<TurnInspectorTarget | null>(null)
