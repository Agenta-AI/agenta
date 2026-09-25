import {useCallback, useState} from "react"

import {ChannelConnectFlow} from "./ChannelConnectFlow"
import {ChannelConnectionList} from "./ChannelConnectionList"
import {ChannelManagePanel} from "./ChannelManagePanel"
import {agentConnectionsOf, EMPTY_CONNECTIONS, NOOP_ACTIONS, platformLabel} from "./helpers"
import type {
    ChannelConnection,
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
    /** A wider container for code (Publish > API); the channel panels leave it unset. */
    wide?: boolean
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
    // Which of this agent's connections on the platform the manage view shows, when it has
    // more than one. Null follows the summarized connection.
    const [selectedId, setSelectedId] = useState<string | null>(null)

    const close = useCallback(() => {
        setActivePlatform(null)
        setForceConnect(null)
        setSelectedId(null)
    }, [])

    const open = useCallback(
        (platform: ChannelPlatform) => {
            const connection = connections[platform]
            // Keep an install mounted while polling publishes the new connection.
            // Only onConnected may switch this attempt to the manage panel.
            setForceConnect(!connection || connection.status === "pending" ? "hosted" : null)
            setSelectedId(null)
            setActivePlatform(platform)
        },
        [connections],
    )

    // A pending connection (link minted, no chat bound yet) opens the connect flow, not manage.
    const mine = activePlatform ? agentConnectionsOf(connections, activePlatform) : []
    const current: ChannelConnection | null = activePlatform
        ? (mine.find((c) => c.connectionId === selectedId) ?? connections[activePlatform])
        : null
    const active = current && current.status !== "pending" && !forceConnect ? current : null
    const listed = active && mine.length > 1 && mine.includes(active)

    const panel = activePlatform
        ? renderPanel({
              open: true,
              title: active
                  ? platformLabel(activePlatform)
                  : `Connect ${platformLabel(activePlatform)}`,
              subtitle: `${agentName} · ${
                  activePlatform === "slack"
                      ? (active?.workspaceName ?? workspaceName)
                      : platformLabel(activePlatform)
              }`,
              onClose: close,
              children: active ? (
                  <>
                      {listed ? (
                          <ChannelConnectionList
                              connections={mine}
                              selectedId={active.connectionId ?? null}
                              hostedHandle={hostedHandle}
                              onSelect={setSelectedId}
                          />
                      ) : null}
                      <ChannelManagePanel
                          key={active.connectionId ?? activePlatform}
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
                              const remaining = next ? agentConnectionsOf(next, activePlatform) : []
                              if (failure) {
                                  const gone =
                                      next !== null &&
                                      next[activePlatform]?.connectionId !== connectionId &&
                                      !remaining.some((c) => c.connectionId === connectionId)
                                  if (!gone) throw failure
                              }
                              // The agent still answers through another connection here: stay
                              // open on it, so the list shows what is left.
                              const stay = remaining.find((c) => c.connectionId !== connectionId)
                              if (stay?.connectionId) setSelectedId(stay.connectionId)
                              else close()
                          }}
                      />
                  </>
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
