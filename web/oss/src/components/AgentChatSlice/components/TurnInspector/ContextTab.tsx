import {memo} from "react"

import {type TurnRequestCapture} from "@agenta/playground"

const format = (value: unknown): string => {
    if (value == null) return "null"
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

const agentInstructions = (parameters: unknown): string | null => {
    const p = parameters as {agent?: {instructions?: {agents_md?: unknown}}} | null
    const md = p?.agent?.instructions?.agents_md
    return typeof md === "string" ? md : null
}

const agentModel = (parameters: unknown): string | null => {
    const p = parameters as {agent?: {llm?: {model?: unknown}; model?: unknown}} | null
    const m = p?.agent?.llm?.model ?? p?.agent?.model
    return typeof m === "string" ? m : null
}

const Block = ({label, value}: {label: string; value: string}) => (
    <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-[10px] text-colorTextTertiary">{label}</span>
        <pre className="ag-surface-inset m-0 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded px-2 py-1.5 font-mono text-[11px] leading-snug text-colorTextSecondary">
            {value}
        </pre>
    </div>
)

const Send = ({
    capture,
    index,
    total,
}: {
    capture: TurnRequestCapture
    index: number
    total: number
}) => {
    const model = agentModel(capture.parameters)
    const instructions = agentInstructions(capture.parameters)
    return (
        <div className="flex flex-col gap-2 rounded-lg border border-solid border-colorBorderSecondary p-3">
            <div className="flex items-center gap-2">
                <span className="!text-xs !font-medium">
                    Request {index + 1} of {total}
                </span>
                {model ? (
                    <span className="!text-[11px] font-mono text-muted-foreground">{model}</span>
                ) : null}
            </div>
            {instructions != null ? (
                <Block label="instructions (agents_md)" value={instructions} />
            ) : null}
            <Block label="parameters (config as sent)" value={format(capture.parameters)} />
            <Block
                label={`messages sent (${(capture.messages ?? []).length})`}
                value={format(capture.messages)}
            />
        </div>
    )
}

/** The Context tab: every send for the selected turn, config-at-turn + exact messages. */
const ContextTab = ({captures}: {captures: TurnRequestCapture[]}) => {
    if (captures.length === 0) {
        return (
            <div className="text-xs text-colorTextTertiary">
                No capture for this turn. Captures are recorded live in Build mode; a turn restored
                from a previous session has none.
            </div>
        )
    }
    return (
        <div className="flex flex-col gap-3">
            {captures.length > 1 ? (
                <span className="!text-xs text-muted-foreground">
                    This turn made {captures.length} requests (initial + resumes). Compare them to
                    spot drift or a loop.
                </span>
            ) : null}
            {captures.map((c, i) => (
                <Send key={c.requestId} capture={c} index={i} total={captures.length} />
            ))}
        </div>
    )
}

export default memo(ContextTab)
