import {useCallback, useMemo} from "react"

import {appTemplatesQueryAtom, createEphemeralAppFromTemplate} from "@agenta/entities/workflow"
import {openWorkflowRevisionDrawerAtom} from "@agenta/playground-ui/workflow-revision-drawer"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {PageLayout} from "@agenta/ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {FilterRailLayout} from "@agenta/ui/components/presentational"
import {SearchInput} from "@agenta/ui/ui"
import {message} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import NewAgentButton from "@/oss/components/NewAgentButton"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import useURL from "@/oss/hooks/useURL"

import {BROWSE_RAIL_MODE} from "../agent-home/assets/constants"
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

    if (!BROWSE_RAIL_MODE)
        return (
            // The page's own title and gutters, so the roster shares one column width with the
            // rest of the app; create, search and the archived link are a toolbar above the grid.
            <PageLayout className={clsx(pageContentWidthClass, "grow min-h-0")} title="Agents">
                <div className="flex items-center gap-3">
                    <NewAgentButton />

                    <SearchInput
                        value={searchTerm}
                        onValueChange={setSearchTerm}
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

    return (
        <PageLayout className="grow min-h-0 !p-0">
            {/* The shared browse frame — the roster's search and its page actions live in the rail,
                so they stay put however far the grid runs. Same pattern as sessions and templates. */}
            <FilterRailLayout
                rail={
                    <>
                        <h1 className="m-0 text-[24px] font-semibold leading-tight text-colorText">
                            Agents
                        </h1>

                        <NewAgentButton />

                        <SearchInput
                            value={searchTerm}
                            onValueChange={setSearchTerm}
                            placeholder="Search agents by name…"
                        />

                        {/* The table's bulk-archive control was also the only route to the archived
                            list; the grid has no bulk mode, so the link stands on its own. */}
                        <Link
                            href={`${projectURL}/agents/archived`}
                            className="text-xs !text-colorTextSecondary"
                        >
                            Archived agents
                        </Link>
                    </>
                }
                // pt-4 is breathing room the cards need: the grid's own pt-5 is exactly the
                // avatar overhang, so without it every avatar sits flush on the scroll edge.
                contentClassName="overflow-y-auto px-6 pb-6 pt-4"
            >
                <AgentsGrid
                    rows={rows}
                    isLoading={isLoading}
                    actions={cardActions}
                    onCreate={handleCreate}
                />
            </FilterRailLayout>
        </PageLayout>
    )
}
