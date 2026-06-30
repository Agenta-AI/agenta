/**
 * Shared types for the client-tool round-trip (#4920).
 *
 * A *client tool* is a tool the playground fulfills, not the sandbox. The runner streams the call
 * as a standard unsettled tool part (`tool-input-available`, no output, `providerExecuted` falsy)
 * and parks the turn. The playground dispatches a widget; the widget drives the interaction and
 * settles the part with a structured **reference** (never a secret) via `addToolOutput`. The
 * `sendAutomaticallyWhen` predicate then auto-resends and the runner resumes on cold-replay.
 *
 * These types are structural (no `ai` import) so the dispatcher, registry, and widgets agree on the
 * one shape they read off a UI message part.
 */
import type {ToolUIPart} from "ai"

/** The optional presentation hint that rides the one-way render channel (`data-<name>`). v1 may not
 * see it on the wire — dispatch falls back to `toolName` — but the shape is reserved so a future
 * `render.kind` (e.g. `config-diff`) lands with no protocol change. */
export interface ClientToolRenderHint {
    kind?: string
}

/**
 * Normalised view of a tool part the dispatcher works with. `toolName` is read off the typed
 * `tool-<name>` part type or a `dynamic-tool`'s `toolName`; `renderKind` off the (optional) render
 * hint. `state` is the AI SDK tool-part state machine value.
 */
export interface ClientToolMeta {
    toolCallId: string
    toolName: string
    renderKind?: string
    state: string
    input: unknown
    output: unknown
    /** A browser-fulfilled result already settled it (`output-available`/`output-error`). */
    settled: boolean
    /** The raw part, for handlers that need fields beyond the normalised view. */
    part: ToolUIPart
}

/** Settle the parked part. Mirrors `addToolOutput` but keyed by the values a widget already holds.
 * Exactly one of `output` / `errorText` is supplied (success vs error envelope). */
export interface SettleClientTool {
    (args: {output: Record<string, unknown>}): void
    (args: {errorText: string}): void
}

/** Props every client-tool widget receives. */
export interface ClientToolHandlerProps {
    meta: ClientToolMeta
    /** Settle the part (resumes the run). No-op once already settled. */
    settle: SettleClientTool
}
