import {useState} from "react"

import {CaretRight} from "@phosphor-icons/react"

import {ChannelConnectFlow} from "./ChannelConnectFlow"
import {ChannelManagePanel} from "./ChannelManagePanel"
import {EMPTY_CONNECTIONS, hasAnyIssue, platformLabel, summarizeConnection} from "./helpers"
import {platformLogo} from "./icons"
import type {ChannelConnection, ChannelConnections, ChannelPlatform} from "./types"

/**
 * Channels settings page: connect and manage the chat tools an agent answers in.
 *
 * Reusable across the desktop app and /m. The host supplies the sliding panel container via
 * `renderPanel` (a drawer on desktop, a bottom sheet on /m); everything inside — the connect
 * flow and the manage view — is shared.
 *
 * FIRST PASS: connections live in local state, seeded from `initialConnections`. There is no
 * data layer yet, so nothing persists across a reload and no api-client is called. Lift the
 * state to real atoms/mutations when the backend lands.
 */

export interface ChannelsPanelRenderProps {
    open: boolean
    title: string
    subtitle?: string
    onClose: () => void
    children: React.ReactNode
}

export interface ChannelsPageProps {
    /** The agent this workspace routes its channels to. Placeholder until the data layer lands. */
    agentName?: string
    workspaceName?: string
    initialConnections?: ChannelConnections
    /** Preview the "install failed" state in the Slack hosted flow (placeholder only). */
    forceInstallError?: boolean
    /** Host-provided sliding container: antd/@agenta drawer on desktop, a Sheet on /m. */
    renderPanel: (props: ChannelsPanelRenderProps) => React.ReactNode
    /** Real action: mint the hosted-Telegram bind link. Omit for the placeholder flow. */
    onConnectHostedTelegram?: () => Promise<{url: string} | undefined>
}

const PLATFORMS: ChannelPlatform[] = ["slack", "telegram"]

export const ChannelsPage = ({
    agentName = "your agent",
    workspaceName = "your workspace",
    initialConnections = EMPTY_CONNECTIONS,
    forceInstallError = false,
    renderPanel,
    onConnectHostedTelegram,
}: ChannelsPageProps) => {
    const [connections, setConnections] = useState<ChannelConnections>(initialConnections)
    const [activePlatform, setActivePlatform] = useState<ChannelPlatform | null>(null)

    const close = () => setActivePlatform(null)

    const setConnection = (platform: ChannelPlatform, next: ChannelConnection | null) =>
        setConnections((prev) => ({...prev, [platform]: next}))

    const active = activePlatform ? connections[activePlatform] : null
    const anyIssue = hasAnyIssue(connections)
    const nothingConnected = !connections.slack && !connections.telegram

    return (
        <div className="flex flex-col gap-4">
            <section className="overflow-hidden rounded-xl border border-solid border-colorBorderSecondary bg-colorBgContainer">
                <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
                    <div className="flex min-w-0 items-center gap-2">
                        <h3 className="m-0 text-base font-semibold text-colorText">Channels</h3>
                        {anyIssue ? (
                            <span className="rounded bg-colorErrorBg px-1.5 py-0.5 text-xs text-colorError">
                                Needs attention
                            </span>
                        ) : null}
                    </div>
                </div>
                <div className="flex flex-col px-4 pb-3">
                    {nothingConnected ? (
                        <p className="m-0 mb-1 text-xs leading-normal text-colorTextSecondary">
                            Talk to {agentName} from the chat tools your team already uses.
                        </p>
                    ) : null}
                    {PLATFORMS.map((platform) => {
                        const connection = connections[platform]
                        const summary = summarizeConnection(platform, connection)
                        return (
                            <button
                                key={platform}
                                type="button"
                                onClick={() => setActivePlatform(platform)}
                                className="flex cursor-pointer items-center gap-2.5 border-0 bg-transparent px-0 py-2.5 text-left"
                            >
                                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer">
                                    {platformLogo(platform, 18)}
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col gap-px">
                                    <span className="flex items-center gap-1.5 text-[13px] font-medium text-colorText">
                                        {platformLabel(platform)}
                                        {summary.dotClass ? (
                                            <span
                                                className={`inline-block h-1.5 w-1.5 rounded-full ${summary.dotClass}`}
                                            />
                                        ) : null}
                                    </span>
                                    <span className={`truncate text-xs ${summary.subClass}`}>
                                        {summary.sub}
                                    </span>
                                </span>
                                {summary.connected ? (
                                    <CaretRight
                                        size={14}
                                        className="flex-shrink-0 text-colorTextTertiary"
                                    />
                                ) : (
                                    <span className="inline-flex h-6 items-center rounded-md border border-solid border-colorBorder bg-colorBgContainer px-2.5 text-xs text-colorText">
                                        Connect
                                    </span>
                                )}
                            </button>
                        )
                    })}
                </div>
            </section>

            {activePlatform
                ? renderPanel({
                      open: true,
                      title: active
                          ? platformLabel(activePlatform)
                          : `Connect ${platformLabel(activePlatform)}`,
                      subtitle: `${agentName} · ${
                          activePlatform === "slack" ? workspaceName : "Telegram"
                      }`,
                      onClose: close,
                      children: active ? (
                          <ChannelManagePanel
                              connection={active}
                              agentName={agentName}
                              workspaceName={workspaceName}
                              onChange={(next) => setConnection(activePlatform, next)}
                              onDisconnect={() => {
                                  setConnection(activePlatform, null)
                                  close()
                              }}
                          />
                      ) : (
                          <ChannelConnectFlow
                              platform={activePlatform}
                              agentName={agentName}
                              workspaceName={workspaceName}
                              forceInstallError={forceInstallError}
                              onConnected={(next) => setConnection(activePlatform, next)}
                              onConnectHostedTelegram={onConnectHostedTelegram}
                          />
                      ),
                  })
                : null}
        </div>
    )
}
