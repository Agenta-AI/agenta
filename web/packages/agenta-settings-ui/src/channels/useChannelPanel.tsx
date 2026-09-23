import {useCallback, useState} from "react"

import {ChannelConnectFlow} from "./ChannelConnectFlow"
import {ChannelManagePanel} from "./ChannelManagePanel"
import {EMPTY_CONNECTIONS, NOOP_ACTIONS, platformLabel} from "./helpers"
import type {
    ChannelConnections,
    ChannelInstallMode,
    ChannelPlatform,
    ChannelsActions,
} from "./types"

export interface ChannelsPanelRenderProps {
    open: boolean
    title: string
    subtitle?: string
    onClose: () => void
    children: React.ReactNode
}

export interface UseChannelPanelOptions {
    /** The agent whose page this is; decides "connected here" versus "connected to X". */
    agentId?: string
    agentName?: string
    /** Seeds the description of a new Slack app. */
    agentDescription?: string | null
    workspaceName?: string
    connections?: ChannelConnections
    actions?: ChannelsActions
    /** Host-provided sliding container: a drawer on desktop, a Sheet on /m. */
    renderPanel: (props: ChannelsPanelRenderProps) => React.ReactNode
    hostedHandle?: string
}

/**
 * The connect-or-manage panel for one platform, shared by every entry point that opens it
 * (the agent page's Channels card and the Publish menu), so both open the same flow.
 */
export const useChannelPanel = ({
    agentId,
    agentName = "your agent",
    agentDescription,
    workspaceName = "your workspace",
    connections = EMPTY_CONNECTIONS,
    actions = NOOP_ACTIONS,
    renderPanel,
    hostedHandle = "@agenta",
}: UseChannelPanelOptions) => {
    const [activePlatform, setActivePlatform] = useState<ChannelPlatform | null>(null)
    // A connected platform normally opens the manage view. This holds the tab to open when the
    // manage view sends the user back into the connect flow: a bot of this agent's own, or a
    // second attempt at an install the platform threw away.
    const [forceConnect, setForceConnect] = useState<ChannelInstallMode | null>(null)

    const close = useCallback(() => {
        setActivePlatform(null)
        setForceConnect(null)
    }, [])

    const open = useCallback(
        (platform: ChannelPlatform) => {
            const connection = connections[platform]
            // Keep an install mounted while polling publishes the new connection.
            // Only onConnected may switch this attempt to the manage panel.
            setForceConnect(!connection || connection.status === "pending" ? "hosted" : null)
            setActivePlatform(platform)
        },
        [connections],
    )

    // A pending connection (link minted, no chat bound yet) opens the connect flow, not manage.
    const current = activePlatform ? connections[activePlatform] : null
    const active = current && current.status !== "pending" && !forceConnect ? current : null

    const panel = activePlatform
        ? renderPanel({
              open: true,
              title: active
                  ? platformLabel(activePlatform)
                  : `Connect ${platformLabel(activePlatform)}`,
              subtitle: `${agentName} · ${activePlatform === "slack" ? workspaceName : "Telegram"}`,
              onClose: close,
              children: active ? (
                  <ChannelManagePanel
                      connection={active}
                      agentId={agentId}
                      agentName={agentName}
                      workspaceName={workspaceName}
                      hostedHandle={hostedHandle}
                      actions={actions}
                      onUseOwnBot={() => setForceConnect("custom")}
                      onReconnect={() => setForceConnect(active.kind)}
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
                          const connectionId = active.connectionId
                          let failure: unknown = null
                          try {
                              await actions.disconnect(activePlatform, connectionId)
                          } catch (error) {
                              failure = error
                          }
                          // Re-read even after a failure: the backend can archive the
                          // row and still answer with an error, and the row must show
                          // what is actually there rather than what the call claimed.
                          const next = await actions.reload().catch(() => null)
                          if (failure) {
                              const gone =
                                  next !== null &&
                                  next[activePlatform]?.connectionId !== connectionId
                              if (!gone) throw failure
                          }
                          close()
                      }}
                  />
              ) : (
                  <ChannelConnectFlow
                      platform={activePlatform}
                      agentName={agentName}
                      agentDescription={agentDescription}
                      workspaceName={workspaceName}
                      hostedHandle={hostedHandle}
                      actions={actions}
                      initialMode={forceConnect ?? "hosted"}
                      onConnected={async () => {
                          setForceConnect(null)
                          await actions.reload()
                      }}
                  />
              ),
          })
        : null

    return {open, close, activePlatform, panel}
}
