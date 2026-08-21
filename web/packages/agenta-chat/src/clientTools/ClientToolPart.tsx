/**
 * Client-tool dispatcher (#4920, interaction kinds M1) — the sibling to `ToolActivity` that renders
 * a single client-tool part. It resolves the widget by `render.kind` → `toolName` (the registry)
 * and falls back to the neutral "not handled by this client" surface for an unknown client tool. The
 * `render.kind` arrives as a sibling `data-render` part (strict tool chunks), resolved through the
 * message-scoped `renderMap`. The widget settles the part via `settle`, which calls the panel's
 * `addToolOutput`; the resume predicate then auto-resends.
 */
import {createElement, memo, useCallback} from "react"

import {clientToolWidgets} from "@agenta/entity-ui/clientTools"
import type {RenderHintLike} from "@agenta/playground"
import {CLIENT_TOOL_NAMES} from "@agenta/shared/clientTools"
import type {ToolUIPart} from "ai"

import {canonicalToolName, resolveClientToolWidget, resolveToolDisplay} from "../skin"

import {clientToolMeta} from "./meta"
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
    const handler = resolveClientToolWidget(meta, clientToolWidgets) ?? UnhandledClientTool
    // Resolved HERE because the tool-display store lives in this package. A widget that resolved it
    // itself would import @agenta/chat back from @agenta/entity-ui, closing a workspace package
    // cycle that breaks the production build. Null for a platform client tool: its own chrome
    // already says who asks.
    const askerLabel = CLIENT_TOOL_NAMES.has(canonicalToolName(meta.toolName))
        ? null
        : resolveToolDisplay(meta.toolName).label

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

    return (
        <div data-client-tool-call-id={meta.toolCallId}>
            {createElement(handler, {meta, settle, degradedEarlierInTurn, askerLabel})}
        </div>
    )
}

export default memo(ClientToolPart)
