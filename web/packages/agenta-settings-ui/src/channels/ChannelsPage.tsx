import {useCallback, useState} from "react"

import {CaretRight} from "@phosphor-icons/react"

import {ChannelConnectFlow} from "./ChannelConnectFlow"
import {ChannelManagePanel} from "./ChannelManagePanel"
import {
    EMPTY_CONNECTIONS,
    NOOP_ACTIONS,
    hasAnyIssue,
    platformLabel,
    summarizeConnection,
} from "./helpers"
import {platformLogo} from "./icons"
import type {ChannelConnections, ChannelPlatform, ChannelsActions} from "./types"

/**
 * The agent page's Channels section: connect and manage the chat tools an agent answers in.
 *
 * Reusable across the desktop app and /m. The host supplies the sliding panel container via
 * `renderPanel` (a drawer on desktop, a bottom sheet on /m), the connections it loaded, and
 * the real actions; everything inside — the connect flow and the manage view — is shared.
 *
 * A channel connection is one per project and answers as one agent. Each platform row is in
 * one of three states relative to the agent whose page is open: not connected ("Connect"),
 * connected here (opens the manage view), or connected to another agent ("Connect here",
 * which retargets the connection to this agent).
 */

export interface ChannelsPanelRenderProps {
    open: boolean
    title: string
    subtitle?: string
    onClose: () => void
    children: React.ReactNode
}

export interface ChannelsPageProps {
    /** The agent whose page this is; decides "connected here" versus "connected to X". */
    agentId?: string
    agentName?: string
    workspaceName?: string
    /** The project's connections, as loaded by the host. */
    connections?: ChannelConnections
    /** True while the host is loading `connections` for the first time. */
    loading?: boolean
    /** The real actions; defaults to no-op actions for previews. */
    actions?: ChannelsActions
    /** Host-provided sliding container: antd/@agenta drawer on desktop, a Sheet on /m. */
    renderPanel: (props: ChannelsPanelRenderProps) => React.ReactNode
    /** The hosted bot/app handle to show, e.g. "@newagentabot". */
    hostedHandle?: string
}

const PLATFORMS: ChannelPlatform[] = ["slack", "telegram"]

export const ChannelsPage = ({
    agentId,
    agentName = "your agent",
    workspaceName = "your workspace",
    connections = EMPTY_CONNECTIONS,
    loading = false,
    actions = NOOP_ACTIONS,
    renderPanel,
    hostedHandle = "@agenta",
}: ChannelsPageProps) => {
    const [activePlatform, setActivePlatform] = useState<ChannelPlatform | null>(null)

    const close = useCallback(() => setActivePlatform(null), [])

    // A pending connection (link minted, no chat bound yet) opens the connect flow, not manage.
    const current = activePlatform ? connections[activePlatform] : null
    const active = current && current.status !== "pending" ? current : null
    const anyIssue = hasAnyIssue(connections)
    const nothingConnected = (["slack", "telegram"] as const).every(
        (platform) => !connections[platform] || connections[platform]?.status === "pending",
    )

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
                    {nothingConnected && !loading ? (
                        <p className="m-0 mb-1 text-xs leading-normal text-colorTextSecondary">
                            Talk to {agentName} from the chat tools your team already uses.
                        </p>
                    ) : null}
                    {PLATFORMS.map((platform) => {
                        const connection = connections[platform]
                        const summary = summarizeConnection(platform, connection, agentId)
                        return (
                            <button
                                key={platform}
                                type="button"
                                disabled={loading}
                                onClick={() => setActivePlatform(platform)}
                                className="flex cursor-pointer items-center gap-2.5 border-0 bg-transparent px-0 py-2.5 text-left disabled:cursor-default"
                                data-testid={`channels-row-${platform}`}
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
                                        {loading ? "Loading…" : summary.sub}
                                    </span>
                                </span>
                                {loading ? null : summary.action === "manage" ? (
                                    <CaretRight
                                        size={14}
                                        className="flex-shrink-0 text-colorTextTertiary"
                                    />
                                ) : (
                                    <span className="inline-flex h-6 items-center whitespace-nowrap rounded-md border border-solid border-colorBorder bg-colorBgContainer px-2.5 text-xs text-colorText">
                                        {summary.action === "connect-here"
                                            ? "Connect here"
                                            : "Connect"}
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
                              agentId={agentId}
                              agentName={agentName}
                              workspaceName={workspaceName}
                              hostedHandle={hostedHandle}
                              onConnectHere={async () => {
                                  if (!active.connectionId) {
                                      throw new Error("This connection has no id yet.")
                                  }
                                  await actions.connectHere(activePlatform, active.connectionId)
                                  await actions.reload()
                              }}
                              onDisconnect={async () => {
                                  if (!active.connectionId) {
                                      throw new Error("This connection has no id yet.")
                                  }
                                  await actions.disconnect(activePlatform, active.connectionId)
                                  await actions.reload()
                                  close()
                              }}
                          />
                      ) : (
                          <ChannelConnectFlow
                              platform={activePlatform}
                              agentName={agentName}
                              workspaceName={workspaceName}
                              hostedHandle={hostedHandle}
                              actions={actions}
                              onConnected={async () => {
                                  await actions.reload()
                              }}
                          />
                      ),
                  })
                : null}
        </div>
    )
}
