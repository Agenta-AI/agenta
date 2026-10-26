import {useState} from "react"

import type {Visibility} from "@agenta/entities/sharing"
import {personName, type SharingPerson, type SharingWriteResult} from "@agenta/sessions-ui/sharing"

import {agentSharingCopy as copy} from "./copy"

/** One channel app bound to the agent (a Slack app in one workspace). Never a channel. */
export interface AgentChannelConnection {
    /** Display name, e.g. "Slack". */
    platform: string
    workspace?: string | null
}

export type AgentSharingNotice = "conflict" | "owner_active" | "failed" | null

export interface AgentSharingWritesOptions {
    agentName: string
    channelConnections?: readonly AgentChannelConnection[]
    onSetVisibility: (visibility: Visibility) => Promise<SharingWriteResult>
    onTakeOwnership: () => Promise<SharingWriteResult>
    onNotify?: (message: string) => void
    onReload?: () => void
}

/** The agent writes, their notices and their toasts, shared by the panel and the dialog. */
export const useAgentSharingWrites = ({
    agentName,
    channelConnections = [],
    onSetVisibility,
    onTakeOwnership,
    onNotify,
    onReload,
}: AgentSharingWritesOptions) => {
    const [notice, setNotice] = useState<AgentSharingNotice>(null)
    const [saving, setSaving] = useState<"visibility" | "take" | null>(null)

    const settle = (result: SharingWriteResult): boolean => {
        if (result === "ok") {
            setNotice(null)
            return true
        }
        if (result === "conflict" || result === "owner_active") {
            setNotice(result)
            onReload?.()
        } else setNotice("failed")
        return false
    }

    const attempt = async (
        key: "visibility" | "take",
        write: () => Promise<SharingWriteResult>,
    ) => {
        setSaving(key)
        try {
            return settle(await write())
        } catch {
            return settle("failed")
        } finally {
            setSaving(null)
        }
    }

    const setVisibility = async (visibility: Visibility) => {
        const ok = await attempt("visibility", () => onSetVisibility(visibility))
        if (!ok) return false
        if (visibility === "private") {
            const off =
                channelConnections.length === 1
                    ? ` ${copy.toastConnectionOff(channelConnections[0].platform)}`
                    : ""
            onNotify?.(`${copy.toastPrivate(agentName)}${off}`)
        } else onNotify?.(copy.toastShared(agentName))
        return true
    }

    const takeOwnership = async () => {
        const ok = await attempt("take", onTakeOwnership)
        if (ok) onNotify?.(copy.toastTookOwnership(agentName))
        return ok
    }

    const transferred = (owner: SharingPerson) => {
        setNotice(null)
        onNotify?.(copy.toastTransferred(personName(owner), agentName))
    }

    return {notice, saving, settle, setVisibility, takeOwnership, transferred}
}
