import {runHeaderAtomFamily} from "@agenta/entities/evaluationRun"
import {useAtomValue} from "jotai"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useDeveloperPageFrame, useDetailHeaderTop} from "../developer/developerPageFrame"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"
import {pageColumn} from "../page-layout/pageFrame"

import {RunDetailsBody} from "./RunDetailsBody"
import {RunDetailsHeader} from "./RunDetailsHeader"
import {useRunDetailsView} from "./useRunDetailsView"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useBindWorkspaceMembers} from "@/features/members/useBindWorkspaceMembers"

/**
 * One evaluation run: its title with the run menu, a Stop or Resume action for a live run, the
 * run chips with Compare, and its tabs. Opening the page only reads the run; nothing is written.
 */
export const RunDetailsScreen = ({
    workspaceId,
    projectId,
    runId,
}: {
    workspaceId: string
    projectId: string
    runId: string
}) => {
    const PAGE_FRAME = useDeveloperPageFrame()
    const headerTop = useDetailHeaderTop()
    useBindWorkspaceMembers()
    useBindProjectContext(projectId)
    const header = useAtomValue(runHeaderAtomFamily(runId))
    // The scenario table keeps the developer width; the other tabs sit in the list column (LAYOUT-02).
    const {view} = useRunDetailsView()
    const column = view === "scenarios" ? "" : pageColumn("lg")

    return (
        <>
            <PageTitle title={header?.name ?? "Evaluation"} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 ${headerTop} ${PAGE_FRAME}`}
                        >
                            <div className={column}>
                                <RunDetailsHeader
                                    projectId={projectId}
                                    runId={runId}
                                    nav={
                                        <NavDrawer
                                            workspaceId={workspaceId}
                                            projectId={projectId}
                                        />
                                    }
                                />
                            </div>
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        <div className={column}>
                            <RunDetailsBody projectId={projectId} runId={runId} />
                        </div>
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
