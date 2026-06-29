import {atom} from "jotai"

export type AgentChannelMode = "stream" | "batch"

/**
 * How the agent playground talks to the agent `/invoke` endpoint:
 *  - `stream` (default): request the real-time SSE UIMessage stream `useChat` renders
 *    token-by-token. If the backend can't stream (the handler can only batch → 406), the
 *    transport's `createNegotiatingFetch` middleware transparently falls back to a batch.
 *  - `batch`: skip the stream attempt and request a single JSON `WorkflowBatchResponse` up
 *    front; the transport replays it as a one-shot UIMessage stream so it lands in one frame.
 *
 * This is a transport/controller concern (which channel the playground PREFERS), NOT revision
 * config — it is never persisted on the agent revision. `buildAgentRequest` reads it to set the
 * `Accept` header; the playground kebab menu writes it. Stream is the default for agents.
 */
export const agentChannelModeAtom = atom<AgentChannelMode>("stream")
