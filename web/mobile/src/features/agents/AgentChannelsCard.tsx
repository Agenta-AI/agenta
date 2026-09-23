import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {getChannelsClient} from "@agenta/sdk/resources"
import {
    ChannelsPage,
    EMPTY_CONNECTIONS,
    buildAgentChannelsActions,
    type ChannelConnections,
    type ChannelsPanelRenderProps,
} from "@agenta/settings-ui"
import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"

import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from "@/components/ui/sheet"
import {getApiUrl} from "@/lib/env"

/** The hosted Slack install URL — a browser redirect into Slack's OAuth, same route the
 * desktop host builds. `getApiUrl()` is the host `_app` pins the SDK to, so both agree. */
const buildSlackInstallUrl = (projectId: string): string => {
    const params = new URLSearchParams({project_id: projectId})
    return `${getApiUrl()}/channels/catalog/channels/slack/install/?${params.toString()}`
}

/**
 * The agent page's Channels section on /m: the shared designed screen, wired to the real
 * channels API through `buildAgentChannelsActions`, in a bottom sheet.
 *
 * Same logic as the desktop host (`web/oss/.../overview/agent/AgentChannelsCard`); only the
 * panel container and the agent-name lookup differ.
 */
export const AgentChannelsCard = ({
    appId,
    agentName,
    agentDescription,
    resolveAgentName,
}: {
    appId: string
    agentName?: string
    /** Seeds the description of a new Slack app. */
    agentDescription?: string | null
    /** Resolve an agent id to its display name; null when the roster does not hold it. */
    resolveAgentName?: (id: string) => string | null
}) => {
    const [connections, setConnections] = useState<ChannelConnections>(EMPTY_CONNECTIONS)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    // The newest reload owns the state: a slow earlier read must not overwrite it.
    const reloadSeq = useRef(0)

    const resolve = useCallback((id: string) => resolveAgentName?.(id) ?? null, [resolveAgentName])

    const actions = useMemo(() => {
        const built = buildAgentChannelsActions({
            client: getChannelsClient(),
            projectId: () => getDefaultStore().get(projectIdAtom),
            appId,
            resolveAgentName: resolve,
            hostedSlackInstallUrl: buildSlackInstallUrl,
        })
        // Every reload lands in this card's state, so the rows and the open panel agree.
        return {
            ...built,
            reload: async () => {
                const seq = ++reloadSeq.current
                try {
                    const next = await built.reload()
                    if (seq === reloadSeq.current) {
                        setConnections(next)
                        setLoadError(null)
                    }
                    return next
                } catch (error) {
                    if (seq === reloadSeq.current) {
                        setLoadError("Could not load Channels. Try again.")
                    }
                    throw error
                }
            },
        }
    }, [appId, resolve])

    useEffect(() => {
        let alive = true
        setLoading(true)
        actions
            .reload()
            .catch(() => undefined)
            .finally(() => {
                if (alive) setLoading(false)
            })
        return () => {
            alive = false
            reloadSeq.current++
        }
    }, [actions])

    const renderPanel = useCallback(
        ({open, title, subtitle, onClose, children}: ChannelsPanelRenderProps) => (
            <Sheet
                open={open}
                onOpenChange={(next) => {
                    if (!next) onClose()
                }}
            >
                {/* `responsive` is this app's form-panel idiom: a bottom sheet on a phone, the
                    right-edge drawer from lg up — where the desktop shows its own Drawer. */}
                <SheetContent side="responsive">
                    <SheetHeader>
                        <SheetTitle>{title}</SheetTitle>
                        {subtitle ? <SheetDescription>{subtitle}</SheetDescription> : null}
                    </SheetHeader>
                    {/* The connect flow is taller than a phone, so the body is the scroller.
                        `min-h-0` is what lets it shrink inside the sheet's flex column. */}
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
                </SheetContent>
            </Sheet>
        ),
        [],
    )

    return (
        <ChannelsPage
            agentId={appId}
            agentName={agentName}
            agentDescription={agentDescription}
            connections={connections}
            loading={loading}
            loadError={loadError}
            onRetry={() => actions.reload().then(() => undefined)}
            actions={actions}
            renderPanel={renderPanel}
        />
    )
}

export default AgentChannelsCard
