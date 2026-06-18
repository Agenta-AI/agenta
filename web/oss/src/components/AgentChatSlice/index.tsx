import {useState} from "react"

import {Segmented, Tooltip, Typography} from "antd"
import {useAtomValue} from "jotai"

import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"

import {type AgentChatTrack, DEFAULT_TRACK} from "./assets/constants"
import AgentChatConversation from "./components/AgentChatConversation"

const {Text, Title} = Typography

/**
 * Agent chat streaming slice — contract v1.
 *
 * A real `useChat` conversation streaming the v6 UI Message Stream protocol from the RAG_QA
 * contract service. Proves the FE↔service streaming contract end to end: text + tool-call
 * lifecycle + one human approval + a trace link into the existing trace drawer.
 *
 * It exposes BOTH request-contract tracks so the team can compare them on a running stream:
 *  - **Track A (UIMessage parts)** — `useChat` posts its `UIMessage[]` verbatim; the
 *    service speaks AI SDK parts. No FE translation.
 *  - **Track B (Agenta {role,content})** — the FE adapts to Agenta's existing message
 *    contract (what `chat.py`/`completion.py` parse), with approvals in a `tool_approvals`
 *    side field. Uniform backend, at the cost of a FE translation layer.
 *
 * The streamed response and rendering are identical across tracks — flip the toggle and
 * watch the Network tab; only the request body changes. Does NOT touch the Jotai/web-worker
 * playground pipeline — `useChat` owns this conversation.
 */
const AgentChatSlice = () => {
    const [track, setTrack] = useState<AgentChatTrack>(DEFAULT_TRACK)
    const appId = useAtomValue(routerAppIdAtom)

    return (
        <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <Title level={4} className="!mb-0">
                        Agent chat (contract v1)
                    </Title>
                    <Text type="secondary" className="!text-xs">
                        Same response stream, two request contracts — flip to compare.
                    </Text>
                </div>
                <Tooltip
                    title={
                        track === "agenta"
                            ? "Track B: FE adapts to Agenta {role, content} + tool_approvals (matches chat.py/completion.py)"
                            : "Track A: useChat posts UIMessage[] parts verbatim (service speaks AI SDK parts)"
                    }
                >
                    <Segmented<AgentChatTrack>
                        size="small"
                        value={track}
                        onChange={setTrack}
                        options={[
                            {label: "A · UIMessage parts", value: "uimessage"},
                            {label: "B · Agenta {role,content}", value: "agenta"},
                        ]}
                    />
                </Tooltip>
            </div>

            {/* Remount per track → clean session + fresh transport for an honest A/B. */}
            <div className="min-h-0 flex-1">
                <AgentChatConversation key={track} track={track} appId={appId} />
            </div>
        </div>
    )
}

export default AgentChatSlice
