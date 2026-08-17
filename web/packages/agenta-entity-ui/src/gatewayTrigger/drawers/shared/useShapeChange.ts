/** Detects when the bound agent's input shape changes under a message the user already typed. */
import {useCallback, useRef} from "react"

/** How a message maps onto the agent's inputs: a chat `messages` array, or a named string input. */
export interface MessageShape {
    isChat: boolean
    primaryKey: string
}

/**
 * Returns a "take" function: call it inside an effect to claim a pending shape change.
 *
 * Both drawers derive `isChat`/`primaryKey` from an async query, so the shape can flip after a
 * message is typed — and both then need the PREVIOUS shape to migrate that message. Read-and-reset
 * (rather than a plain previous-value ref) because the effect that acts on the change also reruns
 * for unrelated reasons, and the migration must happen exactly once per change.
 */
export function useShapeChange(shape: MessageShape): () => MessageShape | null {
    const previous = useRef(shape)
    const {isChat, primaryKey} = shape
    return useCallback(() => {
        const prev = previous.current
        previous.current = {isChat, primaryKey}
        return prev.isChat !== isChat || prev.primaryKey !== primaryKey ? prev : null
    }, [isChat, primaryKey])
}
