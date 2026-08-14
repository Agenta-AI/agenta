import {useEffect, useState} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {WarningCircle} from "@phosphor-icons/react"
import {Button, Empty, List, Skeleton, Tag, Tooltip, Typography, message} from "antd"

import {useChannelGrantActions, useChannelSpaceActions} from "@/oss/state/channels"

/** True when two locators name the same place — shallow, since a locator is
 * a flat map of platform-native ids (team/channel, never nested). */
function sameLocator(
    a: Record<string, unknown> | null | undefined,
    b: Record<string, unknown> | null | undefined,
): boolean {
    if (!a || !b) return false
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const key of keys) {
        if (a[key] !== b[key]) return false
    }
    return true
}

/** A discovered candidate's already-configured `channel_spaces` row, if any —
 * a candidate carries no id of its own until a space row backs it. */
export function matchConfiguredSpace(
    candidate: AgentaApi.ChannelSpaceCandidate,
    spaces: AgentaApi.ChannelSpace[],
): AgentaApi.ChannelSpace | undefined {
    return spaces.find((s) => sameLocator(s.data?.external_locator, candidate.external_locator))
}

export function channelGrantFor(
    grants: AgentaApi.ChannelGrant[],
    agentId: string,
    spaceId: string | undefined,
): AgentaApi.ChannelGrant | undefined {
    if (!spaceId) return undefined
    return grants.find((g) => g.agent_id === agentId && g.space_id === spaceId)
}

/** A topic/group space with an ALLOW grant still needs `/invite @Agenta`
 * before it can answer there — the backend tracks no such flag, so this is
 * a UI-only "not yet confirmed" signal, never a claim of certainty. */
export function needsInviteWarning(
    kind: AgentaApi.ChannelSpaceKind,
    effect: AgentaApi.ChannelGrantEffect | undefined,
): boolean {
    return effect === "allow" && kind !== "private"
}

export interface GrantChannelsSectionProps {
    agentId: string
    connectionId: string
    grants: AgentaApi.ChannelGrant[]
    spaces: AgentaApi.ChannelSpace[]
}

/** The third question: "Which channels?" — a picker over `discover_spaces`
 * candidates, the only kind that can be enumerated in advance. Each
 * selection writes a space-level grant, allow or deny; DMs and group chats
 * are answered by `GrantKindSection` instead, since they cannot be listed. */
export default function GrantChannelsSection({
    agentId,
    connectionId,
    grants,
    spaces,
}: GrantChannelsSectionProps) {
    const {discover, create: createSpace} = useChannelSpaceActions()
    const {create: createGrant, remove: removeGrant} = useChannelGrantActions()
    const [candidates, setCandidates] = useState<AgentaApi.ChannelSpaceCandidate[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [busyKey, setBusyKey] = useState<string | null>(null)

    useEffect(() => {
        if (!connectionId) return
        let cancelled = false
        setIsLoading(true)
        discover(connectionId)
            .then((res) => {
                if (!cancelled) {
                    setCandidates((res.candidates ?? []).filter((c) => c.kind === "topic"))
                }
            })
            .catch(() => {
                if (!cancelled) message.error("Failed to discover channels")
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [connectionId, discover])

    const setEffect = async (
        candidate: AgentaApi.ChannelSpaceCandidate,
        effect: AgentaApi.ChannelGrantEffect,
    ) => {
        const key = JSON.stringify(candidate.external_locator)
        setBusyKey(key)
        try {
            let space = matchConfiguredSpace(candidate, spaces)
            if (!space) {
                const res = await createSpace({
                    connection_id: connectionId,
                    kind: candidate.kind,
                    external_key: crypto.randomUUID(),
                    data: {external_locator: candidate.external_locator},
                })
                space = res.space ?? undefined
            }
            if (!space?.id) throw new Error("Space could not be configured")

            const existing = channelGrantFor(grants, agentId, space.id)
            if (existing?.id) await removeGrant(existing.id)
            await createGrant({
                agent_id: agentId,
                space_id: space.id,
                effect,
                data: {},
            })
            message.success(effect === "allow" ? "Channel allowed" : "Channel denied")
        } catch (err) {
            message.error(err instanceof Error ? err.message : "Failed to save grant")
        } finally {
            setBusyKey(null)
        }
    }

    const clearEffect = async (space: AgentaApi.ChannelSpace) => {
        const spaceId = space.id ?? undefined
        const existing = channelGrantFor(grants, agentId, spaceId)
        if (!existing?.id) return
        const key = JSON.stringify({id: spaceId})
        setBusyKey(key)
        try {
            await removeGrant(existing.id)
        } catch {
            message.error("Failed to clear grant")
        } finally {
            setBusyKey(null)
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <Typography.Text strong>Which channels</Typography.Text>
            {isLoading ? (
                <Skeleton active paragraph={{rows: 3}} />
            ) : candidates.length === 0 ? (
                <Empty description="No channels discovered for this connection" />
            ) : (
                <List
                    size="small"
                    bordered
                    dataSource={candidates}
                    renderItem={(candidate) => {
                        const space = matchConfiguredSpace(candidate, spaces)
                        const spaceId = space?.id ?? undefined
                        const grant = channelGrantFor(grants, agentId, spaceId)
                        const key = JSON.stringify(candidate.external_locator)
                        const isBusy = busyKey === key || busyKey === JSON.stringify({id: spaceId})

                        return (
                            <List.Item
                                actions={[
                                    <Button
                                        key="allow"
                                        size="small"
                                        type={grant?.effect === "allow" ? "primary" : "default"}
                                        loading={isBusy}
                                        onClick={() => setEffect(candidate, "allow")}
                                    >
                                        Allow
                                    </Button>,
                                    <Button
                                        key="deny"
                                        size="small"
                                        danger={grant?.effect === "deny"}
                                        loading={isBusy}
                                        onClick={() => setEffect(candidate, "deny")}
                                    >
                                        Deny
                                    </Button>,
                                    grant && space ? (
                                        <Button
                                            key="clear"
                                            size="small"
                                            type="text"
                                            loading={isBusy}
                                            onClick={() => clearEffect(space)}
                                        >
                                            Clear
                                        </Button>
                                    ) : null,
                                ].filter(Boolean)}
                            >
                                <div className="flex items-center gap-2">
                                    <Typography.Text>
                                        {candidate.display_name || candidate.kind}
                                    </Typography.Text>
                                    {grant?.effect === "allow" ? (
                                        <Tag color="green">Allowed</Tag>
                                    ) : grant?.effect === "deny" ? (
                                        <Tag color="red">Denied</Tag>
                                    ) : null}
                                    {needsInviteWarning(candidate.kind, grant?.effect) ? (
                                        <Tooltip title="Granted, not yet confirmed — run /invite @Agenta in this channel, or calls fail with not_in_channel">
                                            <WarningCircle
                                                size={14}
                                                weight="fill"
                                                className="text-colorWarning"
                                            />
                                        </Tooltip>
                                    ) : null}
                                </div>
                            </List.Item>
                        )
                    }}
                />
            )}
        </div>
    )
}
