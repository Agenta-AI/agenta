import {useState} from "react"

import {Alert, Button, Spinner} from "@agenta/ui/ui"
import {ArrowsLeftRight, LinkBreak, Warning} from "@phosphor-icons/react"

import {
    answeringAgentName,
    botHandle,
    connectionScope,
    errorMessage,
    platformLabel,
} from "./helpers"
import type {ChannelConnection} from "./types"

/**
 * The manage view for a connected channel: the status summary, the "connect here" offer when
 * the connection answers as another agent, and disconnect. Shared by desktop + /m.
 *
 * Both mutations are real: they reject with a message the panel shows, and the panel stays
 * open on failure. The chat list, behavior switches and advanced policy from the first-pass
 * design are not wired in this release and are left out rather than shown as placeholders.
 */

export interface ChannelManagePanelProps {
    connection: ChannelConnection
    /** The agent whose page is open; decides whether the "connect here" offer shows. */
    agentId?: string
    agentName: string
    workspaceName?: string
    /** The hosted bot/app handle to show, e.g. "@newagentabot". */
    hostedHandle?: string
    /** Retarget this connection to the current agent. */
    onConnectHere: () => Promise<void>
    onDisconnect: () => Promise<void>
}

const formatDate = (iso: string | null | undefined): string | null => {
    if (!iso) return null
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleDateString(undefined, {day: "numeric", month: "short", year: "numeric"})
}

export const ChannelManagePanel = ({
    connection,
    agentId,
    agentName,
    workspaceName = "your workspace",
    hostedHandle = "@agenta",
    onConnectHere,
    onDisconnect,
}: ChannelManagePanelProps) => {
    const isSlack = connection.platform === "slack"
    const name = platformLabel(connection.platform)

    const [confirming, setConfirming] = useState(false)
    const [busy, setBusy] = useState<"disconnect" | "connect-here" | null>(null)
    const [error, setError] = useState<string | null>(null)

    const revoked = connection.status === "revoked"
    const scope = connectionScope(connection, agentId)
    const unassigned = scope === "unassigned"
    const elsewhere = scope === "elsewhere" || unassigned
    const otherAgent = unassigned ? "no agent" : answeringAgentName(connection)
    const connectedOn = formatDate(connection.connectedAt)

    const run = async (kind: "disconnect" | "connect-here", action: () => Promise<void>) => {
        setBusy(kind)
        setError(null)
        try {
            await action()
        } catch (e) {
            setError(
                errorMessage(
                    e,
                    kind === "disconnect"
                        ? `Could not disconnect ${name}. Try again.`
                        : `Could not connect ${name} to ${agentName}. Try again.`,
                ),
            )
        } finally {
            setBusy(null)
        }
    }

    const summaryRows: [string, string][] = [
        [
            "Bot",
            connection.kind === "hosted"
                ? `${botHandle(connection, hostedHandle)} · Agenta-hosted`
                : `${botHandle(connection, hostedHandle)} · your own ${isSlack ? "app" : "bot"}`,
        ],
        ["Answers as", elsewhere ? otherAgent : agentName],
        ...(isSlack ? ([["Workspace", workspaceName]] as [string, string][]) : []),
        ...(connectedOn ? ([["Connected", connectedOn]] as [string, string][]) : []),
    ]

    return (
        <div className="flex flex-col gap-5">
            {error ? <Alert type="error" showIcon message={error} /> : null}

            {revoked ? (
                <div className="flex items-start gap-2.5 rounded-lg border border-solid border-colorErrorBorder bg-colorErrorBg p-3">
                    <Warning size={16} className="mt-0.5 flex-shrink-0 text-colorError" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="text-[13px] font-medium text-colorText">
                            {name} revoked the credential
                        </span>
                        <span className="text-xs text-colorTextSecondary">
                            {agentName} cannot answer there until you disconnect and connect again.
                        </span>
                    </div>
                </div>
            ) : null}

            {elsewhere ? (
                <div className="flex flex-col gap-4" data-testid="channels-connect-here">
                    <div className="flex items-start gap-2.5">
                        <ArrowsLeftRight
                            size={18}
                            className="mt-0.5 flex-shrink-0 text-colorTextSecondary"
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="text-[15px] font-semibold text-colorText">
                                {unassigned
                                    ? `${name} is connected, but answers as no agent yet`
                                    : `${name} is connected to ${otherAgent}`}
                            </span>
                            <span className="text-[13px] leading-relaxed text-colorTextSecondary">
                                One {name} connection per project, and it answers as one agent.
                                {unassigned
                                    ? ` Connect it here so ${agentName} answers.`
                                    : ` Connecting it here makes ${agentName} answer instead of ${otherAgent}. The linked chats stay linked.`}
                            </span>
                        </div>
                    </div>
                    <Button
                        variant="default"
                        className="w-full"
                        disabled={busy !== null}
                        onClick={() => void run("connect-here", onConnectHere)}
                    >
                        {busy === "connect-here" ? <Spinner size="small" /> : null}
                        {unassigned
                            ? `Connect ${agentName}`
                            : `Disconnect from ${otherAgent} and connect here`}
                    </Button>
                </div>
            ) : null}

            {elsewhere ? null : (
                <>
                    <div className="overflow-hidden rounded-lg border border-solid border-colorBorderSecondary">
                        {summaryRows.map(([label, value], i) => (
                            <div
                                key={label}
                                className={`flex items-center justify-between gap-3 px-3 py-2.5 ${
                                    i
                                        ? "border-0 border-t border-solid border-colorBorderSecondary"
                                        : ""
                                }`}
                            >
                                <span className="text-xs text-colorTextSecondary">{label}</span>
                                <span className="truncate text-[13px] text-colorText">{value}</span>
                            </div>
                        ))}
                    </div>

                    <div className="flex flex-col gap-2 border-0 border-t border-solid border-colorBorderSecondary pt-4">
                        {confirming ? (
                            <div className="flex flex-col gap-3 rounded-lg border border-solid border-colorBorderSecondary p-3">
                                <span className="text-xs leading-relaxed text-colorTextSecondary">
                                    Disconnect {name}? {elsewhere ? otherAgent : agentName} stops
                                    answering there. Past conversations stay in Agenta.
                                </span>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={busy !== null}
                                        onClick={() => setConfirming(false)}
                                    >
                                        Keep
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        disabled={busy !== null}
                                        onClick={() => void run("disconnect", onDisconnect)}
                                        data-testid="channels-disconnect-confirm"
                                    >
                                        {busy === "disconnect" ? <Spinner size="small" /> : null}
                                        Disconnect
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <Button
                                variant="destructive-outline"
                                disabled={busy !== null}
                                onClick={() => setConfirming(true)}
                                data-testid="channels-disconnect"
                            >
                                <LinkBreak size={14} />
                                Disconnect {name}
                            </Button>
                        )}
                    </div>
                </>
            )}
        </div>
    )
}
