import type {RenderItem, TurnViewModel} from "@agenta/chat/model"

// One display turn per response: the stream opens a message per tool result; fold them as adoption will.

/** Keeps every item's `index` unique across the merged parts, which the row keys depend on. */
const INDEX_STRIDE = 100_000

/** What a part is, for spotting the same one arriving twice across a run's messages. */
const partIdentity = (part: {type: string; toolCallId?: string; text?: string}): string | null => {
    if (part.toolCallId) return `tool:${part.toolCallId}`
    if (part.type === "text" || part.type === "reasoning") {
        return part.text?.trim() ? `${part.type}:${part.text}` : null
    }
    return null
}

const itemIdentity = (item: RenderItem): string[] => {
    if (item.kind === "tools") return item.parts.map((part) => `tool:${part.toolCallId}`)
    if (item.kind === "clientTool") return [`tool:${item.part.toolCallId}`]
    if (item.kind !== "part") return []
    const id = partIdentity(item.part as {type: string; text?: string})
    return id ? [id] : []
}

// The message the stream opens after a tool result briefly echoes the previous message's parts:
// a call id is unique for good, a text counts as an echo only of the message right before.
const dropEchoes = <T>(
    messages: T[][],
    identify: (entry: T) => string[],
    keep: (entry: T, position: number, fresh: (id: string) => boolean) => void,
) => {
    const calls = new Set<string>()
    let previous = new Set<string>()
    messages.forEach((entries, k) => {
        const own = new Set<string>()
        for (const entry of entries) {
            const ids = identify(entry)
            const fresh = (id: string) => !calls.has(id) && !previous.has(id)
            if (ids.length && !ids.some(fresh)) continue
            keep(entry, k, fresh)
            ids.forEach((id) => (id.startsWith("tool:") ? calls : own).add(id))
        }
        previous = own
    })
}

/** A tool group that carries an echoed call beside a new one keeps only the new one. */
const freshTools = (item: RenderItem, fresh: (id: string) => boolean): RenderItem =>
    item.kind === "tools"
        ? {...item, parts: item.parts.filter((part) => fresh(`tool:${part.toolCallId}`))}
        : item

const mergeRun = (run: TurnViewModel[]): TurnViewModel => {
    if (run.length === 1) return run[0]
    const first = run[0]
    const last = run[run.length - 1]
    const items: RenderItem[] = []
    dropEchoes(
        run.map((turn) => turn.items),
        itemIdentity,
        (item, k, fresh) =>
            items.push({...freshTools(item, fresh), index: item.index + k * INDEX_STRIDE}),
    )
    const parts: TurnViewModel["message"]["parts"] = []
    dropEchoes(
        run.map((turn) => turn.message.parts),
        (part) => {
            const id = partIdentity(part as {type: string; toolCallId?: string; text?: string})
            return id ? [id] : []
        },
        (part) => parts.push(part),
    )
    return {
        ...last,
        message: {...last.message, id: first.message.id, parts},
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
