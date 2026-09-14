import type {RenderItem, TurnViewModel} from "@agenta/chat/model"

/**
 * One display turn per response.
 *
 * A live run arrives as several assistant messages — the stream opens a new one after each tool
 * result — and they are folded into one only when the durable record is adopted at settle. Shown
 * as they arrive, a running turn stacks two or three folds and the earlier ones read as finished
 * ("Worked for 7s") while the run is still going. This folds them the way adoption will: the first
 * message keys the turn (its fold and clock), the last one carries the status, trace and usage,
 * and the steps run end to end.
 */

/** Keeps every item's `index` unique across the merged parts, which the row keys depend on. */
const INDEX_STRIDE = 100_000

/** What an item is, for spotting the same one arriving twice across a run's messages. */
const itemIdentity = (item: RenderItem): string[] => {
    if (item.kind === "tools") return item.parts.map((part) => `tool:${part.toolCallId}`)
    if (item.kind === "clientTool") return [`tool:${item.part.toolCallId}`]
    if (item.kind === "part" && (item.part.type === "text" || item.part.type === "reasoning")) {
        const text = (item.part as {text?: string}).text ?? ""
        return text.trim() ? [`${item.part.type}:${text}`] : []
    }
    return []
}

/**
 * A run's messages, end to end, each item once. The message the stream opens after a tool
 * result briefly carries a copy of the parts before it — the same call, the same thought — so
 * a plain concatenation showed every step twice until the copy dropped.
 */
const mergeItems = (run: TurnViewModel[]): RenderItem[] => {
    const seen = new Set<string>()
    const items: RenderItem[] = []
    run.forEach((turn, k) => {
        for (const item of turn.items) {
            const ids = itemIdentity(item)
            if (ids.length && ids.every((id) => seen.has(id))) continue
            ids.forEach((id) => seen.add(id))
            items.push({...item, index: item.index + k * INDEX_STRIDE})
        }
    })
    return items
}

const mergeRun = (run: TurnViewModel[]): TurnViewModel => {
    if (run.length === 1) return run[0]
    const first = run[0]
    const last = run[run.length - 1]
    const items = mergeItems(run)
    return {
        ...last,
        message: {
            ...last.message,
            id: first.message.id,
            parts: run.flatMap((t) => t.message.parts),
        },
        index: first.index,
        items,
        isStreamingTurn: run.some((turn) => turn.isStreamingTurn),
        status: {
            ...last.status,
            hasAnswer: run.some((turn) => turn.status.hasAnswer),
            hasReasoning: run.some((turn) => turn.status.hasReasoning),
            hasContent: run.some((turn) => turn.status.hasContent),
            noResponse: run.every((turn) => turn.status.noResponse),
        },
        precededByEmptyAssistant: first.precededByEmptyAssistant,
        traceId: last.traceId ?? first.traceId,
    }
}

/** Fold each run of consecutive assistant turns into one; user turns pass through untouched. */
export const mergeAssistantRuns = (turns: TurnViewModel[]): TurnViewModel[] => {
    const out: TurnViewModel[] = []
    let run: TurnViewModel[] = []
    const flush = () => {
        if (run.length) out.push(mergeRun(run))
        run = []
    }
    for (const turn of turns) {
        if (turn.isUser) {
            flush()
            out.push(turn)
        } else {
            run.push(turn)
        }
    }
    flush()
    return out
}
