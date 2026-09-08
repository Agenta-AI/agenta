import {useState} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {Segmented, Typography, message} from "antd"

import {useChannelGrantActions} from "@/oss/state/channels"

export type GrantKindAnswer = "unanswered" | "allow" | "deny"

/** The kind's current answer from whichever grant rows already name it —
 * a stray DENY among them still reads as "deny", matching deny-first
 * evaluation. Pass grants pre-filtered to this agent + kind. */
export function kindAnswer(grants: AgentaApi.ChannelGrant[]): GrantKindAnswer {
    if (grants.some((g) => g.effect === "deny")) return "deny"
    if (grants.length > 0) return "allow"
    return "unanswered"
}

export interface KindTransition {
    /** Existing rows for this agent+kind, superseded by the new answer. */
    toRemoveIds: string[]
    toCreate?: {
        agent_id: string
        kind: AgentaApi.ChannelSpaceKind
        effect: AgentaApi.ChannelGrantEffect
    }
}

/** kind/space_id/effect are immutable once written (`ChannelGrantEdit` never
 * carries them), so answering this question again is delete-then-create,
 * never an edit. */
export function planKindTransition(params: {
    agentId: string
    kind: AgentaApi.ChannelSpaceKind
    existing: AgentaApi.ChannelGrant[]
    next: GrantKindAnswer
}): KindTransition {
    const {agentId, kind, existing, next} = params
    const toRemoveIds = existing.map((g) => g.id).filter((id): id is string => Boolean(id))

    if (next === "unanswered") return {toRemoveIds}

    return {
        toRemoveIds,
        toCreate: {
            agent_id: agentId,
            kind,
            effect: next === "deny" ? "deny" : "allow",
        },
    }
}

export const KIND_DENY_COST_NOTICE =
    "A narrower allow on one space inside this kind will not re-admit it. To allow specific channels, remove this denial and allow them individually."

const ANSWER_OPTIONS: {label: string; value: GrantKindAnswer}[] = [
    {label: "Not answered", value: "unanswered"},
    {label: "Allow", value: "allow"},
    {label: "Deny", value: "deny"},
]

export interface GrantKindSectionProps {
    agentId: string
    kind: AgentaApi.ChannelSpaceKind
    label: string
    description: string
    grants: AgentaApi.ChannelGrant[]
}

/** One of the three questions ("Direct messages?" / "Group chats?") — a
 * single allow/deny/unanswered control, never a `space_id` field: a
 * kind-level grant has none. */
export default function GrantKindSection({
    agentId,
    kind,
    label,
    description,
    grants,
}: GrantKindSectionProps) {
    const {create, remove} = useChannelGrantActions()
    const [isSaving, setIsSaving] = useState(false)

    const matching = grants.filter((g) => g.agent_id === agentId && g.kind === kind)
    const answer = kindAnswer(matching)

    const handleChange = async (next: GrantKindAnswer) => {
        if (next === answer) return
        const plan = planKindTransition({agentId, kind, existing: matching, next})
        setIsSaving(true)
        try {
            await Promise.all(plan.toRemoveIds.map((id) => remove(id)))
            if (plan.toCreate) {
                await create({...plan.toCreate, data: {}})
            }
        } catch (err) {
            message.error(err instanceof Error ? err.message : "Failed to save grant")
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                    <Typography.Text strong>{label}</Typography.Text>
                    <Typography.Text type="secondary" className="text-xs">
                        {description}
                    </Typography.Text>
                </div>
                <Segmented<GrantKindAnswer>
                    size="small"
                    disabled={isSaving}
                    value={answer}
                    onChange={handleChange}
                    options={ANSWER_OPTIONS}
                />
            </div>
            {answer === "deny" ? (
                <Typography.Text type="warning" className="text-xs">
                    {KIND_DENY_COST_NOTICE}
                </Typography.Text>
            ) : null}
        </div>
    )
}
