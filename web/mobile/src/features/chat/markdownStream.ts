import type {RenderItem} from "@agenta/chat/model"

/**
 * Array position of the last `text` render item in a turn, or `-1` when the turn has none.
 *
 * Note this is the position in `items`, NOT `item.index` (which is the position in the
 * message's raw `parts` array — tool parts are folded, so the two diverge).
 */
export const lastTextItemIndex = (items: RenderItem[]): number => {
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]
        if (item.kind === "part" && item.part.type === "text") return i
    }
    return -1
}

/**
 * Is this text item the one currently being appended to by the stream?
 *
 * Only that item may be rendered with Streamdown's incomplete-markdown repair (which closes
 * dangling `**`, backticks and fences so a half-arrived token doesn't flash as literal
 * syntax). Settled text must NOT get it: a finished message that legitimately ends in `**`
 * or a lone backtick would be silently rewritten. An assistant turn can hold several text
 * items (text → tool call → more text) and only the last one is live.
 */
export const isLiveTextItem = (
    turn: {isStreamingTurn: boolean; items: RenderItem[]},
    position: number,
): boolean => {
    if (!turn.isStreamingTurn) return false
    const last = lastTextItemIndex(turn.items)
    return last >= 0 && position === last
}
