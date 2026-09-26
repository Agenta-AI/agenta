import type {UIMessage} from "ai"

export interface TurnGrouping {
    lastUserIndex: number
    activeStart: number
    reserveActive: boolean
}

// Group the ACTIVE turn (the last user message + its response) into one wrapper that carries the
// fill. Keeping the fill on a STABLE element — not hopping it from the user bubble to the assistant
// bubble when the answer arrives — avoids the mid-stream layout jump.
export const getTurnGrouping = (messages: UIMessage[]): TurnGrouping => {
    const lastUserIndex = (() => {
        for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return i
        return -1
    })()
    const activeStart = lastUserIndex >= 0 ? lastUserIndex : messages.length
    // The fill = min-h-full on the active turn whenever there's PRIOR conversation above it (so the
    // question can sit at the top). Derived from layout, NOT from `busy` — so it persists when the turn
    // settles instead of being yanked away (which clamped the scroll and jumped the view).
    const reserveActive = activeStart > 0

    return {lastUserIndex, activeStart, reserveActive}
}
