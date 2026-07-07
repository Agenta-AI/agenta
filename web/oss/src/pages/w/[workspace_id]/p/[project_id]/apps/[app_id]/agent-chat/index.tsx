import {Typography} from "antd"
import dynamic from "next/dynamic"

import {isAgentChatSliceEnabled} from "@/oss/components/AgentChatSlice/assets/constants"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"

// Client-only: `useChat` and the streaming transport are browser concerns.
const AgentChatSlice = dynamic(() => import("@/oss/components/AgentChatSlice"), {ssr: false})

/**
 * Feature-flagged route for the agent chat streaming slice (contract v1).
 * On by default; disable with `NEXT_PUBLIC_AGENT_CHAT_SLICE=false`.
 */
const AgentChatPage = () => {
    useBreadcrumbsEffect({breadcrumbs: {"agent-chat": {label: "Agent chat"}}}, [])

    if (!isAgentChatSliceEnabled()) {
        return (
            <div className="flex h-full items-center justify-center">
                <Typography.Text type="secondary">
                    Agent chat slice is disabled. Set NEXT_PUBLIC_AGENT_CHAT_SLICE to anything but
                    "false" to re-enable.
                </Typography.Text>
            </div>
        )
    }

    return (
        <div className="h-[calc(100vh-100px)] min-h-0">
            <AgentChatSlice />
        </div>
    )
}

export default AgentChatPage
