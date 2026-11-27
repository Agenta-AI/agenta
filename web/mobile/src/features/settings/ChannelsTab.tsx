import {useCallback, useMemo, useState} from "react"

import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {
    ChannelsPanelSheet,
    ChannelsSettingsPage,
    type ChannelsPanelRenderProps,
} from "@agenta/settings-ui"
import {userAtom} from "@agenta/shared/state"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {isMyPrivateAgent} from "../agents/myPrivateAgent"
import {useAgentChannels} from "../agents/useAgentChannels"

import {useConfirmModal} from "./useConfirmModal"

/**
 * Settings > Channels: every connection in the project. The panel acts for one agent at a
 * time, so the channels actions are rebuilt whenever the user picks another.
 */
export const ChannelsTab = () => {
    const t = useT(commonCatalog)
    const confirmDialog = useConfirmModal()
    const {confirm} = confirmDialog
    const me = useAtomValue(userAtom)
    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agents = useMemo(
        () =>
            (agentsQuery.data ?? [])
                // Others' private agents never show; the server list already hides them.
                .filter(
                    (agent) =>
                        agent.access?.visibility !== "private" || isMyPrivateAgent(agent, me?.id),
                )
                .map((agent) => ({
                    id: agent.id,
                    // English: the panel saves this name into the Slack app it creates.
                    name: agent.name || agent.slug || "Agent",
                    description: agent.description?.trim() || null,
                })),
        [agentsQuery.data, me?.id],
    )
    const resolveAgentName = useCallback(
        (id: string) => agents.find((agent) => agent.id === id)?.name ?? null,
        [agents],
    )

    const [picked, setPicked] = useState<string | null>(null)
    const agent = agents.find((candidate) => candidate.id === picked) ?? agents[0]

    // A roster that lands after the read still names every agent; it does not reload.
    const {connections, loading, loadError, actions} = useAgentChannels(agent?.id ?? "", {
        resolveAgentName,
    })

    return (
        <>
            <ChannelsSettingsPage
                agents={agents}
                agentId={agent?.id}
                onAgentChange={setPicked}
                agentDescription={agent?.description}
                connections={connections}
                loading={loading}
                loadError={loadError}
                onRetry={() => actions.reload().then(() => undefined)}
                actions={actions}
                renderPanel={(props: ChannelsPanelRenderProps) => <ChannelsPanelSheet {...props} />}
                confirm={confirm}
            />
            <AlertDialog
                open={Boolean(confirmDialog.request)}
                onOpenChange={(next) => {
                    if (!next && !confirmDialog.pending) confirmDialog.close()
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{confirmDialog.request?.title ?? ""}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmDialog.request?.message ?? ""}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {confirmDialog.error ? (
                        <p className="m-0 text-body text-destructive">{confirmDialog.error}</p>
                    ) : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button
                                variant="outline"
                                onClick={confirmDialog.close}
                                disabled={confirmDialog.pending}
                            >
                                {confirmDialog.request?.cancelText ?? t("common.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button
                                variant={
                                    confirmDialog.request?.danger === false
                                        ? "default"
                                        : "destructive"
                                }
                                disabled={confirmDialog.pending}
                                onClick={(event) => {
                                    event.preventDefault()
                                    void confirmDialog.runConfirm()
                                }}
                            >
                                {confirmDialog.pending
                                    ? t("common.working")
                                    : (confirmDialog.request?.okText ?? t("common.confirm"))}
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
