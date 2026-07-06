/**
 * Client-tool dispatcher (#4920, interaction kinds M1) — the sibling to `ToolActivity` that renders
 * a single client-tool part. It resolves the widget by `render.kind` → `toolName` (the registry)
 * and falls back to the explicit "can't handle that" surface for an unknown client tool. The
 * `render.kind` arrives as a sibling `data-render` part (strict tool chunks), resolved through the
 * message-scoped `renderMap`. The widget settles the part via `settle`, which calls the panel's
 * `addToolOutput`; the resume predicate then auto-resends.
 */
import {createElement, memo, useCallback} from "react"

import type {RenderHintLike} from "@agenta/playground"
import type {ToolUIPart} from "ai"

import {clientToolMeta} from "./meta"
import {resolveClientToolHandler} from "./registry"
import UnhandledClientTool from "./UnhandledClientTool"

/** Settle a parked client tool. The panel maps this onto `addToolOutput` (success or error). */
export type ClientToolOutputHandler = (args: {
    toolName: string
    toolCallId: string
    output?: Record<string, unknown>
    errorText?: string
}) => void

const ClientToolPart = ({
    part,
    onOutput,
    renderMap,
    degradedEarlierInTurn,
}: {
    part: ToolUIPart
    onOutput: ClientToolOutputHandler
    renderMap?: Map<string, RenderHintLike>
    /** Retry cap: an earlier part in this turn already auto-settled as an elicitation degradation. */
    degradedEarlierInTurn?: boolean
}) => {
    const meta = clientToolMeta(part, renderMap)
    // The handler is a STABLE module-level component picked from the registry (not created during
    // render), so dispatch via `createElement` — `<Handler/>` would trip the static-components rule.
    const handler = resolveClientToolHandler(meta) ?? UnhandledClientTool

    const settle = useCallback(
        (args: {output: Record<string, unknown>} | {errorText: string}) => {
            if ("errorText" in args) {
                onOutput({
                    toolName: meta.toolName,
                    toolCallId: meta.toolCallId,
                    errorText: args.errorText,
                })
            } else {
                onOutput({
                    toolName: meta.toolName,
                    toolCallId: meta.toolCallId,
                    output: args.output,
                })
            }
        },
        [onOutput, meta.toolName, meta.toolCallId],
    )

    return createElement(handler, {meta, settle, degradedEarlierInTurn})
}

export default memo(ClientToolPart)
