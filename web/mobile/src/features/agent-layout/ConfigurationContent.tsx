import {useCallback, useEffect, useMemo, type ReactNode} from "react"

import {automationRunHistoryDrawerAtom} from "@agenta/automation-ui/run-history-drawer-atom"
import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {AgentOperationsSections, type TriggerOwnerRef} from "@agenta/entity-ui/drill-in"
import {useT} from "@agenta/i18n"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import {cn} from "@agenta/ui/styles"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {useViewStack, ViewStackHost} from "@agenta/ui/view-stack"
import {ArrowLeft, X} from "@phosphor-icons/react"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {AgentChannelsCard} from "../agents/AgentChannelsCard"
import {useAgentPublishPanel} from "../agents/useAgentPublishPanel"
import {AgentPrivacyHost} from "../chat/AgentPrivacyHost"
import {ConfigPane} from "../chat/ConfigPane"
import {DrillInBridgeProvider} from "../chat/DrillInBridgeProvider"
import {viewFormDirtyAtom} from "../chat/viewFormDirty"
import {useProjectPermissionState} from "../context/useProjectPermission"

import {useAgentPanel} from "./agentPanelContext"
import type {ConfigTab} from "./agentPanelState"
import {useLeaveSource} from "./leaveGuard"
import {PanelViewChrome} from "./PanelViewChrome"

/**
 * The Channels tab body of the panel. Task 23.3 (agent pages) fills it; until then the panel
 * shows the production Channels card.
 */
export const configurationChannelsSlotAtom = atom<
    ((props: {agentId: string; workspaceId: string; projectId: string}) => ReactNode) | null
>(null)

const TABS: {key: ConfigTab; label: "agent" | "automations" | "channels" | "access"}[] = [
    {key: "agent", label: "agent"},
    {key: "automations", label: "automations"},
    {key: "channels", label: "channels"},
    {key: "access", label: "access"},
]

interface ConfigurationContentProps {
    agentId: string
    revisionId: string
    sessionId: string
    filesScope: string
    workspaceId: string
    projectId: string
}

/**
 * The Configuration content of the right panel: four tabs over one view stack. The sections keep
 * today's bodies and drawers; a view opened from a tab shows with the panel chrome.
 */
export const ConfigurationContent = (props: ConfigurationContentProps) => {
    const t = useT(agentLayoutPanelCatalog)
    const panel = useAgentPanel()
    return (
        <ViewStackHost
            chrome={PanelViewChrome}
            rootTitle={t(`agentLayout.panel.${panel.configTab}`)}
            onEscapeAtRoot={() => void panel.close()}
        >
            <StackGuards />
            <ConfigurationRoot {...props} />
        </ViewStackHost>
    )
}

/** The view stack registers with the leave guard and tells open sessions a form has edits. */
const StackGuards = () => {
    const stack = useViewStack()
    const setViewFormDirty = useSetAtom(viewFormDirtyAtom)
    useEffect(() => {
        setViewFormDirty(stack.dirty)
    }, [stack.dirty, setViewFormDirty])
    useEffect(() => () => setViewFormDirty(false), [setViewFormDirty])
    useLeaveSource({isDirty: () => stack.dirty, ask: () => stack.closeAll()})
    return null
}

const ConfigurationRoot = ({
    agentId,
    revisionId,
    sessionId,
    filesScope,
    workspaceId,
    projectId,
}: ConfigurationContentProps) => {
    const t = useT(agentLayoutPanelCatalog)
    const panel = useAgentPanel()
    return (
        <div className="ag-panel-raised flex h-full min-h-0 flex-col">
            <div className="flex h-12 shrink-0 items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary px-3">
                {panel.phone ? (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("agentLayout.panel.back")}
                        className="size-11 shrink-0"
                        onClick={() => void panel.close()}
                    >
                        <ArrowLeft size={18} />
                    </Button>
                ) : null}
                <div role="tablist" className="flex min-w-0 flex-1 items-center gap-1">
                    {TABS.map((tab) => (
                        <button
                            key={tab.key}
                            type="button"
                            role="tab"
                            aria-selected={panel.configTab === tab.key}
                            className={cn(
                                "h-8 min-w-11 truncate rounded-md px-2 text-sm",
                                panel.configTab === tab.key
                                    ? "bg-colorFillSecondary font-medium text-colorText"
                                    : "text-colorTextSecondary hover:text-colorText",
                            )}
                            onClick={() => panel.setConfigTab(tab.key)}
                        >
                            {t(`agentLayout.panel.${tab.label}`)}
                        </button>
                    ))}
                </div>
                {panel.phone ? null : (
                    <SimpleTooltip title={t("agentLayout.panel.close")}>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("agentLayout.panel.close")}
                            onClick={() => void panel.close()}
                        >
                            <X size={16} />
                        </Button>
                    </SimpleTooltip>
                )}
            </div>
            <div role="tabpanel" className="min-h-0 flex-1">
                {panel.configTab === "agent" ? (
                    <ConfigPane
                        entityId={revisionId}
                        sessionId={sessionId}
                        filesScope={filesScope}
                        projectId={projectId}
                        operations={false}
                    />
                ) : panel.configTab === "automations" ? (
                    <AutomationsTab revisionId={revisionId} projectId={projectId} />
                ) : panel.configTab === "channels" ? (
                    <ChannelsTab
                        agentId={agentId}
                        workspaceId={workspaceId}
                        projectId={projectId}
                    />
                ) : (
                    <AccessTab agentId={agentId} workspaceId={workspaceId} projectId={projectId} />
                )}
            </div>
        </div>
    )
}

const AutomationsTab = ({revisionId, projectId}: {revisionId: string; projectId: string}) => {
    const editAccess = useProjectPermissionState(projectId, "edit_workflows")
    const openDrawer = useSetAtom(automationRunHistoryDrawerAtom)
    const openRunHistory = useCallback(
        ({id, kind}: TriggerOwnerRef) =>
            openDrawer({automationId: id, kind: kind === "schedule" ? "schedule" : "event"}),
        [openDrawer],
    )
    return (
        <div className="ag-scroll-no-bar h-full min-h-0 overflow-y-auto">
            <DrillInBridgeProvider projectId={projectId}>
                <AgentOperationsSections
                    revisionId={revisionId}
                    disabled={!editAccess.pending && !editAccess.allowed}
                    sticky={false}
                    // The session workspace mounts the automation drawers.
                    automationDrawer={null}
                    onOpenRunHistory={openRunHistory}
                />
            </DrillInBridgeProvider>
        </div>
    )
}

const useAgentRow = (agentId: string) => {
    const agents = useAtomValue(agentWorkflowsListQueryStateAtom)
    const list = useMemo(() => agents.data ?? [], [agents.data])
    const row = list.find((candidate) => candidate.id === agentId)
    const resolveAgentName = useCallback(
        (id: string) => {
            const match = list.find((candidate) => candidate.id === id)
            return match ? match.name || match.slug || null : null
        },
        [list],
    )
    return {row, resolveAgentName}
}

const ChannelsTab = ({
    agentId,
    workspaceId,
    projectId,
}: {
    agentId: string
    workspaceId: string
    projectId: string
}) => {
    const Slot = useAtomValue(configurationChannelsSlotAtom)
    if (Slot) return <>{Slot({agentId, workspaceId, projectId})}</>
    return <ProductionChannels agentId={agentId} workspaceId={workspaceId} projectId={projectId} />
}

const ProductionChannels = ({
    agentId,
    workspaceId,
    projectId,
}: {
    agentId: string
    workspaceId: string
    projectId: string
}) => {
    const {row, resolveAgentName} = useAgentRow(agentId)
    const publish = useAgentPublishPanel({
        agentId,
        agentName: row?.name || row?.slug || undefined,
        agentDescription: row?.description?.trim() || null,
        resolveAgentName,
        projectId,
        workspaceId,
    })
    return (
        <div className="h-full min-h-0 overflow-y-auto p-4">
            <AgentChannelsCard
                connections={publish.connections}
                loading={publish.loading}
                loadError={publish.loadError}
                onRetry={() => void publish.reload().catch(() => null)}
                onOpenHub={publish.openHub}
                onOpenConnection={publish.openConnection}
            />
            {publish.panel}
        </div>
    )
}

const AccessTab = ({
    agentId,
    workspaceId,
    projectId,
}: {
    agentId: string
    workspaceId: string
    projectId: string
}) => {
    const {row} = useAgentRow(agentId)
    return (
        <div className="h-full min-h-0 overflow-y-auto p-4">
            <AgentPrivacyHost
                agentId={agentId}
                agentName={row?.name || row?.slug || ""}
                workspaceId={workspaceId}
                projectId={projectId}
            />
        </div>
    )
}
