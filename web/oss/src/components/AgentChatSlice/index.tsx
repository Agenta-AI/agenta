import {Typography} from "antd"
import {useAtomValue} from "jotai"

import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"

import AgentChatConversation from "./components/AgentChatConversation"

const {Text, Title} = Typography

/**
 * Agent chat streaming slice — a client for the RFC `POST /messages` contract
 * (`docs/design/agent-workflows/agent-protocol-rfc.md`).
 *
 * A real `useChat` conversation streaming the v6 UI Message Stream protocol. Proves the
 * FE↔service streaming contract end to end: text + tool-call lifecycle + one human approval
 * + a trace link into the existing trace drawer. The conversation is posted as
 * `data.messages` (AI SDK `UIMessage[]` parts) — the RFC's chosen request shape. Does NOT
 * touch the Jotai/web-worker playground pipeline — `useChat` owns this conversation.
 */
const AgentChatSlice = () => {
    const appId = useAtomValue(routerAppIdAtom)

    return (
        <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-3 p-4">
            <div>
                <Title level={4} className="!mb-0">
                    Agent chat (contract v1)
                </Title>
                <Text type="secondary" className="!text-xs">
                    Streaming agent chat over the v6 UI Message Stream (POST /messages).
                </Text>
            </div>

            <div className="min-h-0 flex-1">
                <AgentChatConversation appId={appId} />
            </div>
        </div>
    )
}

export default AgentChatSlice
