import {useCallback, useMemo} from "react"

import {appTemplatesQueryAtom, createEphemeralAppFromTemplate} from "@agenta/entities/workflow"
import {openWorkflowRevisionDrawerAtom} from "@agenta/playground-ui/workflow-revision-drawer"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {PageLayout} from "@agenta/ui"
import {PlusIcon} from "@phosphor-icons/react"
import {Button, Input, message} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import useURL from "@/oss/hooks/useURL"

import type {AgentColumnActions} from "../agent-home/components/YourAgentsTable/columns"
import {openDeleteAppModalAtom} from "../app-management/modals/DeleteAppModal/store/deleteAppModalStore"
import {openEditAppModalAtom} from "../app-management/modals/EditAppModal/store/editAppModalStore"

import AgentsGrid from "./AgentsGrid"
import {
    agentsSearchTermAtom,
    agentsWorkflowsAtom,
    agentsWorkflowsLoadingAtom,
    refetchAgentsWorkflowsAtom,
} from "./store"

export default function AgentsPage() {
    const router = useRouter()
    const {baseAppURL, projectURL} = useURL()
    const {goToPlayground} = usePlaygroundNavigation()
    const setOpenDrawer = useSetAtom(openWorkflowRevisionDrawerAtom)
    const openDeleteAppModal = useSetAtom(openDeleteAppModalAtom)
    const openEditAppModal = useSetAtom(openEditAppModalAtom)
    const rows = useAtomValue(agentsWorkflowsAtom)
    const isLoading = useAtomValue(agentsWorkflowsLoadingAtom)
    const searchTerm = useAtomValue(agentsSearchTermAtom)
    const setSearchTerm = useSetAtom(agentsSearchTermAtom)
    const refetchAgents = useSetAtom(refetchAgentsWorkflowsAtom)

    useAtomValue(appTemplatesQueryAtom)

    const handleCreate = useCallback(async () => {
        try {
            const entityId = await createEphemeralAppFromTemplate({type: "agent"})
            if (!entityId) {
                message.error("Couldn't start agent creation — please retry")
                return
            }

            setOpenDrawer({entityId, context: "app-create"})
        } catch (error) {
            message.error(extractApiErrorMessage(error))
        }
    }, [setOpenDrawer])

    const handleArchived = useCallback(() => refetchAgents(), [refetchAgents])

    const cardActions = useMemo<AgentColumnActions>(
        () => ({
            onOpen: (record) => router.push(`${baseAppURL}/${record.workflowId}/overview`),
            onOpenPlayground: (record) => goToPlayground(undefined, {appId: record.workflowId}),
            onRename: (record) =>
                openEditAppModal({
                    id: record.workflowId,
                    name: record.name,
                    onRenamed: refetchAgents,
                }),
            onArchive: (record) =>
                openDeleteAppModal({
                    id: record.workflowId,
                    name: record.name,
                    onArchived: handleArchived,
                }),
        }),
        [
            router,
            baseAppURL,
            goToPlayground,
            openEditAppModal,
            openDeleteAppModal,
            refetchAgents,
            handleArchived,
        ],
    )

    return (
        <PageLayout className="grow min-h-0" title="Agents">
            <div className="flex items-center gap-3">
                <Button type="primary" icon={<PlusIcon size={14} />} onClick={handleCreate}>
                    New agent
                </Button>
                <Input
                    allowClear
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search agents by name…"
                    className="max-w-80"
                />
                {/* The table's bulk-archive control was also the only route to the archived
                    list; the grid has no bulk mode, so the link stands on its own. */}
                <Link
                    href={`${projectURL}/agents/archived`}
                    className="ml-auto shrink-0 text-xs !text-colorTextSecondary"
                >
                    Archived agents
                </Link>
            </div>

            <AgentsGrid
                rows={rows}
                isLoading={isLoading}
                actions={cardActions}
                onCreate={handleCreate}
            />
        </PageLayout>
    )
}
