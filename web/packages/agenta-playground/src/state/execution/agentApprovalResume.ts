/**
 * Agent-lane resume predicate — for BOTH parked client tools and HITL approval gates.
 *
 * `useChat`'s `sendAutomaticallyWhen` decides when the conversation auto-resends after a parked
 * client interaction settles. The agent FE round-trip (#4920) generalizes the existing approval
 * round-trip to an arbitrary browser-fulfilled tool: the runner emits the tool call and parks the
 * turn; the playground fulfills it with `addToolOutput`; the turn must then auto-resend so the
 * runner cold-replays and resumes. Two settle shapes drive a resume here:
 *
 *   - **Approval response.** Approve AND Deny both resume — a denied tool part is still
 *     `approval-responded`, so the runner gets the denial round-trip (the SDK ingress maps it to a
 *     `tool_result`, a deny → tool-error) and the model continues. No `approval-responded` limbo
 *     (the F-036 dead-end).
 *   - **Client-tool result.** A parked client tool fulfilled by the browser settles to
 *     `output-available`/`output-error` with `providerExecuted` falsy (it was NOT run server-side).
 *     That fulfilled output must resume the run exactly as an approval does.
 *
 * A pending interaction (`approval-requested`, or a still-`input-available` client tool awaiting the
 * user) does NOT resume. Server-executed tool parts (`providerExecuted === true`) are ignored — they
 * settle within the turn and never park, so they neither gate nor trigger a resume.
 *
 * Pure + structurally typed so the package needs no `ai` dependency: it reads only the fields the AI
 * SDK puts on a UI message (`role`, `parts[].type/state/providerExecuted`).
 */

interface ApprovalLike {
    id?: string
    approved?: boolean
}

import {CLIENT_TOOL_NAMES, canonicalClientToolName} from "@agenta/shared/clientTools"

import {buildRenderMap, renderKindFor, type RenderHintLike} from "./renderMap"

export type LiveAgentInteraction =
    | {kind: "approval"; id: string}
    | {kind: "client_tool"; id: string}

interface ToolPartLike {
    type?: string
    state?: string
    toolCallId?: string
    providerExecuted?: boolean
    approval?: ApprovalLike
    render?: {kind?: unknown}
    data?: unknown
}

interface MessageLike {
    role?: string
    parts?: ToolPartLike[]
}

const isToolPart = (part: ToolPartLike): boolean => {
    const type = part?.type
    return typeof type === "string" && (type.startsWith("tool-") || type === "dynamic-tool")
}

/** A tool part the user has resolved (approve OR deny) on this turn. */
const isRespondedToolPart = (part: ToolPartLike): boolean =>
    isToolPart(part) && part.state === "approval-responded"

const toolPartName = (part: ToolPartLike): string =>
    typeof part.type === "string" ? part.type.replace(/^tool-/, "") : ""

/**
 * A part that is actually a client tool (browser-fulfilled), not an ordinary server tool.
 * The render hint arrives as a sibling `data-render` part (strict tool chunks), so the
 * message-scoped map is consulted alongside the inline field and the known-name set.
 */
const isClientTool = (part: ToolPartLike, renderMap?: Map<string, RenderHintLike>): boolean =>
    renderKindFor(part, renderMap) !== undefined ||
    // Canonicalized: the wire name carries a harness wrapper (`__ag__request_input`,
    // `mcp__agenta-tools__…`) while the set holds bare names. Matching raw made the name axis
    // dead, so a client tool only qualified once its sibling `data-render` part had landed.
    CLIENT_TOOL_NAMES.has(canonicalClientToolName(toolPartName(part)))

/**
 * A PARKED client tool still awaiting the user (its widget is live in the transcript). Gates the
 * message queue like an approval: the stream reads "ready" while the run is really paused, and a
 * queued message must not inject itself before the widget settles. Safe to hold on — unlike an
 * orphaned `approval-responded`, the pending widget IS the unblock UI (accept/decline/dismiss).
 */
export const isPendingClientToolInteraction = (
    part: ToolPartLike,
    renderMap?: Map<string, RenderHintLike>,
): boolean =>
    isToolPart(part) &&
    part.providerExecuted !== true &&
    isClientTool(part, renderMap) &&
    (part.state === "input-available" || part.state === "input-streaming")

const isClientToolResult = (part: ToolPartLike, renderMap?: Map<string, RenderHintLike>): boolean =>
    isToolPart(part) &&
    part.providerExecuted !== true &&
    part.approval == null &&
    // Load-bearing: only a real CLIENT tool (a `render.kind` hint or a known client-tool name)
    // is a resume trigger. An ordinary server tool the agent ran itself (e.g. the `read` skill)
    // also settles to `output-available` with `providerExecuted` falsy and no `approval` —
    // without this guard it is misread as a client-tool result, so every tool-using turn
    // auto-resends forever (the Aloha loop).
    isClientTool(part, renderMap) &&
    (part.state === "output-available" || part.state === "output-error")

/** A resolved tool part is settled when it has run, errored, or carries a decision. */
const isSettledToolPart = (part: ToolPartLike): boolean =>
    isToolPart(part) &&
    (part.state === "output-available" ||
        part.state === "output-error" ||
        part.state === "output-denied" ||
        part.state === "approval-responded")

/**
 * Resume when the targeted assistant turn carries a freshly-resolved parked interaction. Approval
 * responses dispatch per card; browser-fulfilled client tools retain the all-settled rule:
 *   - Approval (approve OR deny): a denied tool part is `approval-responded`, so a deny-only turn
 *     still resumes and the runner gets the denial round-trip (the deny dead-end fix).
 *   - Client tool: a `request_connection` the widget settled (success, cancel, failure, abandon)
 *     reads as a client-tool result, so the run resumes and the runner re-resolves on cold-replay.
 */
export function agentShouldResumeAfterApproval({
    messages,
    liveInteraction,
}: {
    messages: MessageLike[]
    liveInteraction?: LiveAgentInteraction | null
}): boolean {
    if (liveInteraction === null) return false

    // Live markers target their owning message; markerless orphan checks stay tail-only.
    let message: MessageLike | undefined
    if (liveInteraction) {
        for (let i = messages.length - 1; i >= 0; i--) {
            const candidate = messages[i]
            if (candidate.role !== "assistant") continue
            const ownsInteraction = (candidate.parts ?? []).some(
                (part) =>
                    isToolPart(part) &&
                    (liveInteraction.kind === "approval"
                        ? part.approval?.id === liveInteraction.id
                        : part.toolCallId === liveInteraction.id),
            )
            if (ownsInteraction) {
                message = candidate
                break
            }
        }
    } else {
        const last = messages[messages.length - 1]
        if (last?.role === "assistant") message = last
    }
    if (!message) return false

    const parts = message.parts ?? []
    const toolParts = parts.filter((part) => isToolPart(part) && part.providerExecuted !== true)
    if (toolParts.length === 0) return false

    // Message-scoped render hints (sibling `data-render` parts) for client-tool detection.
    const renderMap = buildRenderMap(parts)

    let lastResolvedIdx = -1
    let lastResolvedIsApproval = false
    if (liveInteraction) {
        lastResolvedIsApproval = liveInteraction.kind === "approval"
        lastResolvedIdx = parts.findIndex((part) =>
            liveInteraction.kind === "approval"
                ? isRespondedToolPart(part) && part.approval?.id === liveInteraction.id
                : isClientToolResult(part, renderMap) && part.toolCallId === liveInteraction.id,
        )
    } else {
        // Queue/orphan checks omit a marker and inspect the latest resolved interaction shape.
        for (let i = 0; i < parts.length; i++) {
            if (isRespondedToolPart(parts[i])) {
                lastResolvedIdx = i
                lastResolvedIsApproval = true
            } else if (isClientToolResult(parts[i], renderMap)) {
                lastResolvedIdx = i
                lastResolvedIsApproval = false
            }
        }
    }
    if (lastResolvedIdx === -1) return false

    if (!liveInteraction) {
        // Restored tails need this guard; exact live markers are single-use and may target a part before `step-start`.
        const resumedAlready = parts
            .slice(lastResolvedIdx + 1)
            .some((part) => part.type === "step-start")
        if (resumedAlready) return false
    }

    // The AI SDK re-evaluates after message updates and waits for an in-flight stream to finish,
    // so an approval clicked during a resume dispatches when that stream finishes.
    if (!liveInteraction) return toolParts.every(isSettledToolPart)

    if (lastResolvedIsApproval) {
        const pendingClientTool = toolParts.some((part) =>
            isPendingClientToolInteraction(part, renderMap),
        )
        return !pendingClientTool
    }
    return toolParts.every(isSettledToolPart)
}
