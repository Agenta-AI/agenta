import {atom} from "jotai"

export type AgentChannelMode = "stream" | "batch"

/**
 * How the agent playground talks to the agent `/invoke` endpoint:
 *  - `stream` (default): the real-time SSE UIMessage stream `useChat` renders token-by-token.
 *  - `batch`: a single JSON response (`WorkflowBatchResponse`); the transport replays it as a
 *    one-shot UIMessage stream, so the reply lands in one frame instead of streaming.
 *
 * This is a transport/controller concern (which channel the playground speaks), NOT revision
 * config — it is never persisted on the agent revision. `buildAgentRequest` reads it to set the
 * `Accept` header; the playground kebab menu writes it. Stream is the default for agents.
 */
export const agentChannelModeAtom = atom<AgentChannelMode>("stream")
