import {atom} from "jotai"
import {atomFamily, atomWithStorage} from "jotai/utils"

export type AgentChannelMode = "stream" | "batch"

/**
 * How the agent playground talks to the agent `/invoke` endpoint, PER SESSION:
 *  - `stream` (default): request the real-time SSE UIMessage stream `useChat` renders
 *    token-by-token. If the backend can't stream (the handler can only batch → 406), the
 *    transport's `createNegotiatingFetch` middleware transparently falls back to a batch.
 *  - `batch`: skip the stream attempt and request a single JSON `WorkflowBatchResponse` up
 *    front; the transport replays it as a one-shot UIMessage stream so it lands in one frame.
 *
 * This is a transport/controller concern (which channel the playground PREFERS), NOT revision
 * config — it is never persisted on the agent revision. It is scoped to the conversation, so two
 * sessions can prefer different channels; the Session Inspector's Response lens writes it and
 * `buildAgentRequest` reads it (keyed by `session_id`) to set the `Accept` header. Persisted per
 * session so the preference survives reloads. Stream is the default for agents.
 */
const channelModeBySessionAtom = atomWithStorage<Record<string, AgentChannelMode>>(
    "agenta:agent-channel-mode-by-session",
    {},
)

export const agentChannelModeAtomFamily = atomFamily((sessionId: string) =>
    atom(
        (get) => get(channelModeBySessionAtom)[sessionId] ?? "stream",
        (get, set, next: AgentChannelMode) => {
            const all = get(channelModeBySessionAtom)
            set(channelModeBySessionAtom, {...all, [sessionId]: next})
        },
    ),
)
