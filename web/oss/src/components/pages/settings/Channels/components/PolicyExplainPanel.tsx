import type {AgentaApi} from "@agentaai/api-client"
import {Skeleton, Tag, Typography} from "antd"

import {useChannelPolicyResolve} from "@/oss/state/channels"

const LEVEL_COLOR: Record<AgentaApi.ChannelPolicyLevel, string> = {
    capability: "red",
    channel: "default",
    agent: "blue",
    space: "purple",
    grant: "green",
}

const FIELD_LABEL: Record<string, string> = {
    triggers: "Triggers",
    session_scope: "Session scope",
    backfill: "Backfill",
    forwardfill: "Forwardfill",
}

const formatValue = (field: string, policy: AgentaApi.ChannelEffectivePolicy) => {
    switch (field) {
        case "triggers":
            return policy.triggers.join(", ") || "none"
        case "session_scope":
            return policy.session_scope
        case "backfill":
            return policy.backfill ? "on" : "off"
        case "forwardfill":
            return policy.forwardfill ? "on" : "off"
        default:
            return ""
    }
}

export interface PolicyExplainPanelProps {
    agentId: string | null | undefined
    spaceId: string | null | undefined
}

/**
 * Read-only explain panel: calls `resolve_channel_policy` for the pair in
 * view and renders each field next to the level that decided it. Not a
 * separate route — embedded in the agent and space detail screens.
 */
export function PolicyExplainPanel({agentId, spaceId}: PolicyExplainPanelProps) {
    const {policy, isLoading, error} = useChannelPolicyResolve(agentId, spaceId)

    if (!agentId || !spaceId) {
        return (
            <Typography.Text type="secondary" className="text-xs">
                Select both an agent and a space to see the effective policy.
            </Typography.Text>
        )
    }

    if (isLoading) return <Skeleton active paragraph={{rows: 4}} />

    if (error || !policy) {
        return (
            <Typography.Text type="danger" className="text-xs">
                Could not resolve the effective policy for this pair.
            </Typography.Text>
        )
    }

    return (
        <div className="flex flex-col gap-2">
            {Object.entries(FIELD_LABEL).map(([field, label]) => {
                const level = policy.decided_by[field]
                return (
                    <div key={field} className="flex items-center justify-between gap-3">
                        <Typography.Text>{label}</Typography.Text>
                        <div className="flex items-center gap-2">
                            <Typography.Text type="secondary" className="text-xs">
                                {formatValue(field, policy)}
                            </Typography.Text>
                            {level ? (
                                <Tag color={LEVEL_COLOR[level]} bordered={false}>
                                    {level}
                                </Tag>
                            ) : null}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
